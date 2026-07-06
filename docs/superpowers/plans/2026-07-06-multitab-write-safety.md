# Multi-tab Write Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silent data loss when two tabs share one origin — surface dropped (non-quota) writes, and freeze a tab whose world was imported/deleted in another tab.

**Architecture:** Two independent pieces. (1) Widen `storageError.ts` so an `unhandledrejection` carrying a Dexie "dropped write" error name raises a generic notice (quota stays its specialized case). (2) A React-free `tabSync.ts` `BroadcastChannel` module: `importAll` and `deleteLore` broadcast a `world-changed` message; every other tab bound to that world renders a non-dismissable reload overlay. Tabs compare against `activeLoreId` — the lore id captured at db-bind time in `schema.ts`, because a switch in another tab mutates shared `localStorage`.

**Tech Stack:** TypeScript (strict), React, Dexie/IndexedDB, Vitest + happy-dom + @testing-library/react, `BroadcastChannel`.

## Global Constraints

- TS `strict`; the full CI gate is `npm run lint && npm run build && npm run test:run` — all three must pass before "done".
- New public `db/` API must be reachable from the `'../db'` barrel. `schema.ts` is re-exported via `export * from './schema'` (barrel line 25), so a new `export const` there is auto-exported — no barrel edit needed.
- Tests: Vitest, `environment: 'happy-dom'`, setup `./src/setup-tests.ts`. `.test.tsx` uses `@testing-library/react` with `afterEach(cleanup)`.
- `@tauri-apps/*` APIs and `<a download>` may only appear in `src/platform.ts` (lint-enforced) — not relevant here, but do not introduce either.
- No new dependencies. `BroadcastChannel` is a built-in Web API; feature-detect it (`typeof BroadcastChannel === 'undefined'`) so non-supporting targets and tests degrade to a no-op.

---

### Task 1: Widen `storageError.ts` to surface dropped writes

**Files:**
- Modify: `src/storageError.ts`
- Test: `src/storageError.test.ts` (extend)

**Interfaces:**
- Consumes: existing `isQuotaError`, `subscribeStorageError`, `clearStorageError`, `reportStorageError`.
- Produces: `GENERIC_MESSAGE: string`; `isDroppedWriteError(err: unknown): boolean`. `reportStorageError` now also raises `GENERIC_MESSAGE` for dropped-write errors.

- [ ] **Step 1: Write the failing tests**

Append to `src/storageError.test.ts` (inside the file, after the existing `describe` blocks):

```ts
describe('isDroppedWriteError', () => {
  it('detects the allowlisted Dexie/IDB error names', () => {
    for (const name of [
      'DatabaseClosedError', 'AbortError', 'InvalidStateError',
      'TransactionInactiveError', 'UnknownError',
    ]) {
      expect(isDroppedWriteError({ name })).toBe(true)
    }
  })

  it('recurses into a Dexie-nested inner cause', () => {
    expect(isDroppedWriteError({ name: 'AbortError', inner: { name: 'DatabaseClosedError' } })).toBe(true)
  })

  it('excludes ConstraintError and unrelated errors', () => {
    expect(isDroppedWriteError({ name: 'ConstraintError' })).toBe(false)
    expect(isDroppedWriteError(new Error('boom'))).toBe(false)
    expect(isDroppedWriteError({ name: 'QuotaExceededError' })).toBe(false)
    expect(isDroppedWriteError(null)).toBe(false)
  })
})

describe('reportStorageError — dropped writes', () => {
  it('raises the generic notice for an allowlisted dropped-write error', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'DatabaseClosedError' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatch(/may not have been saved/i)
    off()
  })

  it('prefers the quota message when the error is a quota error', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'QuotaExceededError' })
    expect(cb.mock.calls[0][0]).toMatch(/out of storage space/i)
    off()
  })

  it('still ignores a ConstraintError (logic bug, not lost data)', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'ConstraintError' })
    expect(cb).not.toHaveBeenCalled()
    off()
  })
})
```

Add `isDroppedWriteError` to the import block at the top of the test file:

```ts
import {
  isQuotaError,
  isDroppedWriteError,
  reportStorageError,
  subscribeStorageError,
  clearStorageError,
} from './storageError'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/storageError.test.ts`
Expected: FAIL — `isDroppedWriteError is not a function` / generic-message assertions unmet.

- [ ] **Step 3: Implement in `src/storageError.ts`**

Add the message constant next to `QUOTA_MESSAGE` (after line 24):

```ts
const GENERIC_MESSAGE =
  'Some recent changes may not have been saved (another tab may have changed this world). ' +
  'Download a backup to be safe, then reload.'

// Dexie/IndexedDB error names that mean a write was dropped or the connection
// vanished — the realistic multi-tab case is DatabaseClosedError after Dexie
// auto-closes on another tab's delete. ConstraintError is deliberately absent:
// it signals a logic bug (e.g. the bootstrap duplicate-key path), not lost data.
const DROPPED_WRITE_NAMES = new Set([
  'DatabaseClosedError', 'AbortError', 'InvalidStateError',
  'TransactionInactiveError', 'UnknownError',
])
```

Add the detector after `isQuotaError` (after line 40):

```ts
/** True when an error (recursing into Dexie's nested `.inner`) names a dropped
 *  write / closed-DB failure. Quota is handled separately by isQuotaError. */
export function isDroppedWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; inner?: unknown }
  if (typeof e.name === 'string' && DROPPED_WRITE_NAMES.has(e.name)) return true
  if (e.inner && e.inner !== err) return isDroppedWriteError(e.inner)
  return false
}
```

Replace the body of `reportStorageError` (lines 53-57) with quota-first ordering:

```ts
export function reportStorageError(err: unknown): void {
  let message: string | null = null
  if (isQuotaError(err)) message = QUOTA_MESSAGE
  else if (isDroppedWriteError(err)) message = GENERIC_MESSAGE
  if (!message) return
  active = message
  listeners.forEach((cb) => cb(active))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/storageError.test.ts`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add src/storageError.ts src/storageError.test.ts
git commit -m "feat: surface dropped (non-quota) writes in storageError (#185)"
```

---

### Task 2: `tabSync.ts` — cross-tab world-change bus

**Files:**
- Create: `src/tabSync.ts`
- Test: `src/tabSync.test.ts` (create)

**Interfaces:**
- Produces:
  - `type WorldChangeReason = 'import' | 'delete'`
  - `interface WorldChangeMessage { type: 'world-changed'; loreId: string; reason: WorldChangeReason }`
  - `matchesBoundLore(msg: unknown, boundLoreId: string): msg is WorldChangeMessage`
  - `handleIncoming(data: unknown, boundLoreId: string): void` (applies a received message to the bus; exposed so the message-handling path is deterministically testable without a live channel)
  - `subscribeTabSync(cb: (reason: WorldChangeReason | null) => void): () => void`
  - `broadcastWorldChange(loreId: string, reason: WorldChangeReason): void`
  - `installTabSyncListener(boundLoreId: string): void`
  - `clearTabSync(): void` (test/reset helper — resets active state)
  - `useTabSync(): { reason: WorldChangeReason | null }`

- [ ] **Step 1: Write the failing tests**

Create `src/tabSync.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  matchesBoundLore,
  handleIncoming,
  subscribeTabSync,
  broadcastWorldChange,
  clearTabSync,
} from './tabSync'

afterEach(() => clearTabSync())

describe('matchesBoundLore', () => {
  it('matches a world-changed message for the bound lore', () => {
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')).toBe(true)
  })
  it('rejects a message for a different lore', () => {
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w2', reason: 'delete' }, 'w1')).toBe(false)
  })
  it('rejects a wrong type, a bad reason, and non-objects', () => {
    expect(matchesBoundLore({ type: 'other', loreId: 'w1', reason: 'import' }, 'w1')).toBe(false)
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w1', reason: 'nope' }, 'w1')).toBe(false)
    expect(matchesBoundLore(null, 'w1')).toBe(false)
    expect(matchesBoundLore('world-changed', 'w1')).toBe(false)
  })
})

describe('handleIncoming → bus', () => {
  it('freezes and notifies subscribers on a matching message', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')
    expect(cb).toHaveBeenCalledWith('import')
    off()
  })

  it('replays the active reason to a late subscriber', () => {
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'delete' }, 'w1')
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    expect(cb).toHaveBeenCalledWith('delete')
    off()
  })

  it('ignores a message targeting a different lore', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'other', reason: 'import' }, 'w1')
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('clearTabSync notifies subscribers with null', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')
    cb.mockClear()
    clearTabSync()
    expect(cb).toHaveBeenCalledWith(null)
    off()
  })
})

describe('broadcastWorldChange', () => {
  // This test runs before any channel is created (no prior test calls broadcast
  // or install), so the deleted-global path is genuinely exercised.
  it('is a safe no-op when BroadcastChannel is unavailable', () => {
    const saved = globalThis.BroadcastChannel
    // @ts-expect-error — deliberately remove for the no-support path
    delete globalThis.BroadcastChannel
    try {
      expect(() => broadcastWorldChange('w1', 'import')).not.toThrow()
    } finally {
      globalThis.BroadcastChannel = saved
    }
  })

  it('does not throw when BroadcastChannel exists', () => {
    expect(() => broadcastWorldChange('w1', 'delete')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/tabSync.test.ts`
Expected: FAIL — module `./tabSync` not found.

- [ ] **Step 3: Implement `src/tabSync.ts`**

```ts
// src/tabSync.ts
// Cross-tab world-change guard. IndexedDB is origin-shared, so a second tab
// can import (clear + bulkAdd) or delete the world this tab is editing. Import
// is completely silent to other tabs (no versionchange fires — same DB version),
// so the storageError listener can't catch it; a BroadcastChannel is the only
// signal. On a matching message this tab freezes into a reload overlay.
//
// React-free (except the hook at the bottom, mirroring storageError.ts) so it
// can be imported from the data layer without pulling React into it.

import { useEffect, useState } from 'react'

export type WorldChangeReason = 'import' | 'delete'

export interface WorldChangeMessage {
  type: 'world-changed'
  loreId: string
  reason: WorldChangeReason
}

const CHANNEL_NAME = 'lore-tab-sync'

type Listener = (reason: WorldChangeReason | null) => void
const listeners = new Set<Listener>()
let active: WorldChangeReason | null = null

/** Pure predicate: is `msg` a world-change for the lore this tab bound to? */
export function matchesBoundLore(msg: unknown, boundLoreId: string): msg is WorldChangeMessage {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Partial<WorldChangeMessage>
  return (
    m.type === 'world-changed' &&
    m.loreId === boundLoreId &&
    (m.reason === 'import' || m.reason === 'delete')
  )
}

/** Subscribe to the freeze state. Replays the current reason to late subscribers
 *  so an overlay mounted after the message still shows. Returns an unsubscribe. */
export function subscribeTabSync(cb: Listener): () => void {
  listeners.add(cb)
  if (active) cb(active)
  return () => { listeners.delete(cb) }
}

function raise(reason: WorldChangeReason): void {
  active = reason
  listeners.forEach((cb) => cb(active))
}

/** Apply a received channel message to the bus: freeze this tab when the message
 *  targets the lore it bound to. Exposed (rather than inlined in the listener) so
 *  the message-handling path is deterministically testable without a live channel. */
export function handleIncoming(data: unknown, boundLoreId: string): void {
  if (matchesBoundLore(data, boundLoreId)) raise(data.reason)
}

/** Reset the active freeze state (used by tests). */
export function clearTabSync(): void {
  active = null
  listeners.forEach((cb) => cb(null))
}

let channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

/** Tell other tabs that `loreId` was imported/deleted. No-op without support.
 *  BroadcastChannel does NOT deliver to the sending tab, so the acting tab is
 *  never frozen by its own message. */
export function broadcastWorldChange(loreId: string, reason: WorldChangeReason): void {
  const ch = getChannel()
  if (!ch) return
  const msg: WorldChangeMessage = { type: 'world-changed', loreId, reason }
  ch.postMessage(msg)
}

let installed = false
/** Listen for other tabs' world changes and freeze this tab when one targets the
 *  lore it bound to at load. Idempotent; no-op without BroadcastChannel support. */
export function installTabSyncListener(boundLoreId: string): void {
  if (installed) return
  const ch = getChannel()
  if (!ch) return
  installed = true
  ch.addEventListener('message', (ev: MessageEvent) => handleIncoming(ev.data, boundLoreId))
}

/** React binding: the current freeze reason (or null). */
export function useTabSync(): { reason: WorldChangeReason | null } {
  const [reason, setReason] = useState<WorldChangeReason | null>(null)
  useEffect(() => subscribeTabSync(setReason), [])
  return { reason }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/tabSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tabSync.ts src/tabSync.test.ts
git commit -m "feat: tabSync BroadcastChannel bus for cross-tab world changes (#185)"
```

---

### Task 3: Capture `activeLoreId` and wire broadcast into `importAll` + `deleteLore`

**Files:**
- Modify: `src/db/schema.ts:326` (capture bound id)
- Modify: `src/db/backup.ts:418-420` (`importAll`)
- Modify: `src/lores.ts:102-104` (`deleteLore`)
- Test: `src/db/backup.tabSync.test.ts` (create) and extend `src/tabSync` usage assertions there

**Interfaces:**
- Consumes: `broadcastWorldChange` (Task 2), `activeLoreId` (new export below).
- Produces: `export const activeLoreId: string` from `schema.ts` (auto-re-exported by the barrel).

- [ ] **Step 1: Write the failing test**

Create `src/db/backup.tabSync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Assert the destructive ops announce themselves to other tabs. We mock tabSync
// so the test observes the broadcast call without needing a real channel.
vi.mock('../tabSync', () => ({
  broadcastWorldChange: vi.fn(),
}))

import { broadcastWorldChange } from '../tabSync'
import { importAll } from '../db'
import { activeLoreId } from '../db'

beforeEach(() => {
  vi.mocked(broadcastWorldChange).mockClear()
})

describe('importAll broadcasts a world change', () => {
  it('announces an import for the active lore', async () => {
    await importAll(JSON.stringify({ pages: [] }))
    expect(broadcastWorldChange).toHaveBeenCalledWith(activeLoreId, 'import')
  })
})
```

Create `src/lores.tabSync.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./tabSync', () => ({ broadcastWorldChange: vi.fn() }))

import { broadcastWorldChange } from './tabSync'
import { deleteLore, registerLore } from './lores'

beforeEach(() => vi.mocked(broadcastWorldChange).mockClear())

describe('deleteLore broadcasts a world change', () => {
  it('announces a delete for the removed lore id', async () => {
    const id = await registerLore('Doomed World')
    await deleteLore(id)
    expect(broadcastWorldChange).toHaveBeenCalledWith(id, 'delete')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/db/backup.tabSync.test.ts src/lores.tabSync.test.ts`
Expected: FAIL — `activeLoreId` undefined (import error) and `broadcastWorldChange` never called.

- [ ] **Step 3a: Capture the bound id in `src/db/schema.ts`**

Replace line 326:

```ts
export const db = new LoreDB(dbNameFor(currentLoreId()))
```

with:

```ts
// The lore id this tab's db bound to, captured at load. A switch in another tab
// mutates shared localStorage, so currentLoreId() can drift from what db points
// at — cross-tab comparisons must use this snapshot, not a live read.
export const activeLoreId = currentLoreId()
export const db = new LoreDB(dbNameFor(activeLoreId))
```

- [ ] **Step 3b: Broadcast in `importAll` (`src/db/backup.ts`)**

Extend the existing `./schema` import on line 1 to pull in `activeLoreId`:

```ts
import { db, now, activeLoreId, type LoreDB } from './schema'
```

Add the tabSync import just below it:

```ts
import { broadcastWorldChange } from '../tabSync'
```

Replace `importAll` (lines 418-420):

```ts
export async function importAll(json: string): Promise<void> {
  // Warn other tabs before we clear+repopulate the active world under them.
  broadcastWorldChange(activeLoreId, 'import')
  await importBackupInto(db, json)
```

- [ ] **Step 3c: Broadcast in `deleteLore` (`src/lores.ts`)**

Add the import near the top of `src/lores.ts`:

```ts
import { broadcastWorldChange } from './tabSync'
```

In `deleteLore` (line 102), add the broadcast as the first statement of the body, before `Dexie.delete` at line 104:

```ts
export async function deleteLore(id: string): Promise<void> {
  broadcastWorldChange(id, 'delete') // freeze other tabs viewing this world
  const isActive = id === currentLoreId()
  await Dexie.delete(dbNameFor(id))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/db/backup.tabSync.test.ts src/lores.tabSync.test.ts`
Expected: PASS.

Then confirm no regression in the touched suites:
Run: `npm run test:run -- src/db/backup.test.ts src/db/barrel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/backup.ts src/lores.ts src/db/backup.tabSync.test.ts src/lores.tabSync.test.ts
git commit -m "feat: broadcast world change on importAll/deleteLore (#185)"
```

---

### Task 4: `TabSyncOverlay` component + App wiring

**Files:**
- Create: `src/components/TabSyncOverlay.tsx`
- Modify: `src/index.css` (append overlay styles)
- Modify: `src/App.tsx` (install listener + mount overlay in both return branches)
- Test: `src/components/TabSyncOverlay.test.tsx` (create)

**Interfaces:**
- Consumes: `useTabSync`, `subscribeTabSync`/internal `raise` via a received message; `installTabSyncListener`, `activeLoreId`.
- Produces: default-exported `TabSyncOverlay` React component.

- [ ] **Step 1: Write the failing test**

Create `src/components/TabSyncOverlay.test.tsx`. It drives the overlay deterministically through `handleIncoming` (the same path the channel listener runs), wrapped in `act` so React flushes the bus-driven state update — no reliance on channel timing.

```tsx
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import TabSyncOverlay from './TabSyncOverlay'
import { handleIncoming, clearTabSync } from '../tabSync'

afterEach(() => { cleanup(); clearTabSync() })

describe('TabSyncOverlay', () => {
  it('renders nothing when no world change has occurred', () => {
    render(<TabSyncOverlay />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('freezes with a reload prompt when another tab imports the bound world', () => {
    render(<TabSyncOverlay />)
    act(() => handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/replaced by an import/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/TabSyncOverlay.test.tsx`
Expected: FAIL — module `./TabSyncOverlay` not found.

- [ ] **Step 3a: Implement `src/components/TabSyncOverlay.tsx`**

```tsx
import { useTabSync } from '../tabSync'

// A non-dismissable, app-wide overlay shown when another tab imported or deleted
// the world this tab is editing (#185). Once the world was swapped/removed under
// us, any further edit lands in the wrong dataset or a vanishing DB — so the only
// safe action is a reload. Delete lands on the selector (this world is gone).
const COPY: Record<'import' | 'delete', string> = {
  import: 'This world was replaced by an import in another tab.',
  delete: 'This world was deleted in another tab.',
}

export default function TabSyncOverlay() {
  const { reason } = useTabSync()
  if (!reason) return null

  function reload() {
    if (reason === 'delete') window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <div className="tab-sync-overlay" role="alertdialog" aria-modal="true">
      <div className="tab-sync-dialog">
        <span className="tab-sync-icon" aria-hidden="true">⚠</span>
        <p className="tab-sync-msg">{COPY[reason]} Reload to continue.</p>
        <button className="tab-sync-btn" onClick={reload}>Reload</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3b: Append overlay styles to `src/index.css`**

Add at the end of the file (reuses the same tokens as `.modal-overlay`/`.modal-dialog`, but a higher z-index and no click-to-dismiss):

```css
.tab-sync-overlay {
  position: fixed; inset: 0; z-index: 2000;
  background: rgba(0, 0, 0, 0.72);
  display: flex; align-items: center; justify-content: center; padding: 16px;
  animation: fade-in var(--dur-2) var(--ease-out);
}
.tab-sync-dialog {
  background: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  max-width: 420px; width: 100%; padding: 24px; text-align: center;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
.tab-sync-icon { font-size: 28px; display: block; margin-bottom: 10px; }
.tab-sync-msg { line-height: 1.5; margin-bottom: 18px; }
.tab-sync-btn {
  background: linear-gradient(180deg, var(--accent-soft), var(--accent)); color: #2a210b;
  border: none; border-radius: 7px; padding: 8px 20px; font-weight: 600; font-size: 14px;
  cursor: pointer;
}
.tab-sync-btn:hover { filter: brightness(1.07); }
```

- [ ] **Step 3c: Wire into `src/App.tsx`**

Add imports near the top (with the other component/module imports):

```ts
import TabSyncOverlay from './components/TabSyncOverlay'
import { installTabSyncListener } from './tabSync'
import { activeLoreId } from './db'
```

In the startup effect (currently lines 52-61), add the install call next to `installStorageErrorListener()`:

```ts
  useEffect(() => {
    installStorageErrorListener() // surface IndexedDB quota/eviction write failures
    installTabSyncListener(activeLoreId) // freeze on another tab's import/delete of this world
    bootstrapDefaultLore()
```

Mount the overlay in BOTH return branches, right after each `<StorageErrorBanner />`:

In the `/` branch (currently lines 76-80):

```tsx
      <>
        <StorageErrorBanner />
        <TabSyncOverlay />
        <LoreSelectorRoute />
      </>
```

In the shell branch (currently line 86):

```tsx
    <div className="app-shell">
      <StorageErrorBanner />
      <TabSyncOverlay />
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/components/TabSyncOverlay.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/TabSyncOverlay.tsx src/index.css src/App.tsx src/components/TabSyncOverlay.test.tsx
git commit -m "feat: TabSyncOverlay reload guard + App wiring (#185)"
```

---

### Task 5: Full CI gate + live two-tab verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full CI gate**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass, zero lint errors, clean tsc build, all tests green.

If lint flags an unused/`no-restricted-imports` issue, fix it and re-run. Do not add `@tauri-apps/*` or `<a download>` anywhere outside `src/platform.ts`.

- [ ] **Step 2: Live verification — import case**

Start the dev server: `npm run dev` (port 5174). Open two tabs at `http://localhost:5174/`, both on the same world (e.g. `/home`). In tab B, go to Settings → Import and restore any valid backup. Expected: tab A shows the non-dismissable overlay ("replaced by an import…"); clicking **Reload** reloads tab A and it shows the imported data. Tab B (the actor) is NOT frozen.

- [ ] **Step 3: Live verification — delete case**

With two tabs on the same world, in tab B go to `/` (selector) and delete the current world. Expected: tab A shows the overlay ("deleted in another tab…"); **Reload** lands tab A on the selector (`#/`), not a broken page.

- [ ] **Step 4: Record the outcome and commit any doc note**

If behavior matches, the feature is verified. If a case misbehaves (e.g. overlay does not appear on import), debug with `superpowers:systematic-debugging` before claiming done — confirm the `BroadcastChannel` message is posted (DevTools → Application → check console) and that `activeLoreId` in the receiving tab equals the broadcast `loreId`.

No commit needed unless a fix was made in Steps 1-3 (commit those with a `fix:` message referencing #185).

---

## Notes for PR

- Add a version label when opening the PR: **`version:minor`** (new user-facing feature). No label ⇒ patch.
- PR title/body should reference issue #185 and note both pieces (dropped-write surfacing + cross-tab freeze) and that the blast radius was verified live (see the design spec).
