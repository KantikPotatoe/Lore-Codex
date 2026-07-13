# Settings Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship #173 — an app-level settings store plus four new options (open last world, spellcheck + language, backup on exit, default backup folder) and a settings-row layout that fixes the "margin" complaint.

**Architecture:** Device-level prefs get their own store (`appMeta` table on the `lore-registry` DB) so they can't leak into a world's backup and survive deleting a world; per-world `LoreSettings` is untouched. The two desktop-only options go through the existing `src/platform.ts` seam and add **no new filesystem permissions**: exit-backups are written to `$APPDATA/backups` (already allowed), and the remembered folder only pre-fills the Save dialog.

**Tech Stack:** React 19 + TypeScript (strict), Dexie + dexie-react-hooks (`useLiveQuery`), Tiptap, Vitest + happy-dom + fake-indexeddb, Tauri v2.

**Spec:** `docs/superpowers/specs/2026-07-13-settings-rework-design.md`

## Global Constraints

- **Branch:** `feat/173-settings-rework` (already exists, spec committed). PR label: **`version:minor`**.
- **TypeScript `strict`.** Run `npm run lint`, `npm run build`, `npm run test:run` before claiming done — CI runs all three.
- **Platform seam:** no `@tauri-apps/*` import and no `<a download>` outside `src/platform.ts` (lint-enforced via `no-restricted-imports`).
- **No host `alert()`/`confirm()`** — use `ConfirmDialog`.
- **Defaults must reproduce today's behaviour**, so an absent settings row is a no-op.
- **Dexie store version bumps** on the registry DB must declare the new store in a *new* `version()` block; never edit `version(1)`.
- `db.meta` (per-world) is NOT where these prefs go. They go in the registry DB.

---

### Task 1: The app-level settings store

Extracts the registry Dexie DB into its own module so `appSettings` can use it without importing `lores.ts` (whose module is wholly mocked in `LoreSelectorRoute.test.tsx` — importing `registry` from there would hand `appSettings` an `undefined` DB under test).

**Files:**
- Create: `src/registryDb.ts`
- Create: `src/appSettings.ts`
- Create: `src/appSettings.test.ts`
- Modify: `src/lores.ts:1-21` (import `registry`/`Lore` from the new module, re-export `Lore`; delete the local class)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `registry` (Dexie instance, tables `lores`, `appMeta`), `type AppMeta = { key: string; value: unknown }`, `type Lore` — all from `src/registryDb.ts`
  - `AppSettings`, `DEFAULT_APP_SETTINGS`, `APP_SETTINGS_KEY`, `SPELLCHECK_LANGS`, `getAppSettings(): Promise<AppSettings>`, `updateAppSettings(patch: Partial<AppSettings>): Promise<void>` — all from `src/appSettings.ts`

- [ ] **Step 1: Write the failing test**

Create `src/appSettings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { registry } from './registryDb'
import {
  getAppSettings,
  updateAppSettings,
  DEFAULT_APP_SETTINGS,
  APP_SETTINGS_KEY,
} from './appSettings'

describe('appSettings', () => {
  beforeEach(async () => {
    await registry.appMeta.clear()
  })

  it('returns defaults when no row exists', async () => {
    expect(await getAppSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('defaults reproduce today’s behaviour', () => {
    // An absent row must be a no-op: the picker still shows, the editor still
    // spellchecks (contenteditable does by default), nothing writes on exit.
    expect(DEFAULT_APP_SETTINGS).toEqual({
      openLastWorld: false,
      spellcheck: true,
      spellcheckLang: '',
      backupOnExit: false,
      defaultBackupDir: null,
    })
  })

  it('merges a stored partial over defaults', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { openLastWorld: true } })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(true)
    expect(a.spellcheck).toBe(true) // untouched default
  })

  it('round-trips an update', async () => {
    await updateAppSettings({ backupOnExit: true })
    expect((await getAppSettings()).backupOnExit).toBe(true)
  })

  it('keeps unrelated fields when patching one', async () => {
    await updateAppSettings({ openLastWorld: true })
    await updateAppSettings({ spellcheckLang: 'fr' })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(true)
    expect(a.spellcheckLang).toBe('fr')
  })

  it('falls back to the default for a wrong-typed stored value', async () => {
    // A hand-edited DB (or a future bug) must not propagate junk into the app.
    await registry.appMeta.put({
      key: APP_SETTINGS_KEY,
      value: { openLastWorld: 'yes', spellcheck: 1, defaultBackupDir: 42 },
    })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(false)
    expect(a.spellcheck).toBe(true)
    expect(a.defaultBackupDir).toBe(null)
  })

  it('rejects an unknown spellcheck language', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: 'klingon' } })
    expect((await getAppSettings()).spellcheckLang).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/appSettings.test.ts`
Expected: FAIL — cannot resolve `./registryDb` / `./appSettings`.

- [ ] **Step 3: Create `src/registryDb.ts`**

```ts
import Dexie, { type Table } from 'dexie'

/** A world in the registry. */
export interface Lore {
  id: string
  name: string
  banner: string | null // data URL, or null
  createdAt: number
  updatedAt: number
}

/** Device-level key/value rows (app settings). Mirrors the per-world `meta`
 *  store's shape, but lives in the registry DB — so these rows are structurally
 *  incapable of travelling inside a world's backup, and they survive deleting
 *  the world you were in. */
export interface AppMeta {
  key: string
  value: unknown
}

class LoreRegistryDB extends Dexie {
  lores!: Table<Lore, string>
  appMeta!: Table<AppMeta, string>
  constructor() {
    super('lore-registry')
    this.version(1).stores({ lores: 'id, createdAt' })
    this.version(2).stores({ appMeta: 'key' })
  }
}

export const registry = new LoreRegistryDB()
```

- [ ] **Step 4: Create `src/appSettings.ts`**

```ts
import { registry } from './registryDb'

/** Device-level, app-wide preferences — distinct from the per-world
 *  `LoreSettings` in `settings.ts`, which lives in that world's `meta` row and
 *  travels inside its backups. Nothing here is a property of a world:
 *  "open the last world" is *about* worlds, and the rest describe this machine. */
export interface AppSettings {
  /** Skip the world picker on launch and reopen the last world. */
  openLastWorld: boolean
  /** Spellcheck the editor. Default true = the contenteditable default. */
  spellcheck: boolean
  /** BCP-47 tag for the spellcheck dictionary; '' = let the OS decide. */
  spellcheckLang: string
  /** Desktop only: write a backup to the app data folder when closing. */
  backupOnExit: boolean
  /** Desktop only: the folder the Save dialog opens in. null = none picked. */
  defaultBackupDir: string | null
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  openLastWorld: false,
  spellcheck: true,
  spellcheckLang: '',
  backupOnExit: false,
  defaultBackupDir: null,
}

export const APP_SETTINGS_KEY = 'app-settings'

/** The dictionary comes from the browser/OS — the installed set is not exposed
 *  to web content, so this list is curated, not enumerated. An uninstalled
 *  language simply falls back to the OS default. */
export const SPELLCHECK_LANGS: { id: string; label: string }[] = [
  { id: '', label: 'System default' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'de', label: 'Deutsch' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
  { id: 'nl', label: 'Nederlands' },
  { id: 'pl', label: 'Polski' },
  { id: 'ru', label: 'Русский' },
]

/** Validate on read, not just on write: a hand-edited DB (or a future bug)
 *  must not propagate a wrong-typed value into the app. Anything unexpected
 *  falls back to its default — the same discipline as `settings.ts`. */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await registry.appMeta.get(APP_SETTINGS_KEY)
  const stored = (row?.value ?? {}) as Partial<Record<keyof AppSettings, unknown>>
  const out: AppSettings = { ...DEFAULT_APP_SETTINGS }

  if (typeof stored.openLastWorld === 'boolean') out.openLastWorld = stored.openLastWorld
  if (typeof stored.spellcheck === 'boolean') out.spellcheck = stored.spellcheck
  if (typeof stored.backupOnExit === 'boolean') out.backupOnExit = stored.backupOnExit
  if (typeof stored.spellcheckLang === 'string' &&
      SPELLCHECK_LANGS.some((l) => l.id === stored.spellcheckLang)) {
    out.spellcheckLang = stored.spellcheckLang
  }
  if (typeof stored.defaultBackupDir === 'string' || stored.defaultBackupDir === null) {
    out.defaultBackupDir = stored.defaultBackupDir
  }
  return out
}

/** Read-modify-write the single settings row. One row, one write — no
 *  partial-field races between rapid toggles. */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const next = { ...(await getAppSettings()), ...patch }
  await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: next })
}
```

- [ ] **Step 5: Point `lores.ts` at the extracted DB**

In `src/lores.ts`, replace the Dexie import, the `Lore` interface, the `LoreRegistryDB` class and the `registry` export (lines 1-21) with:

```ts
import Dexie from 'dexie'
import { CURRENT_LORE_KEY, currentLoreId, dbNameFor } from './loreId'
import { broadcastWorldChange } from './tabSync'
import { registry, type Lore } from './registryDb'

// The registry DB now lives in registryDb.ts so `appSettings.ts` can reach it
// without importing this module (whose world-CRUD is mocked wholesale in
// LoreSelectorRoute.test.tsx). Re-exported so every existing call site keeps
// importing `registry` / `Lore` from './lores'.
export { registry }
export type { Lore }
```

`Dexie` is still used by `importLoreFromBackup`/`deleteLore` (`Dexie.delete`), so keep the default import. Leave the rest of the file untouched.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/appSettings.test.ts src/lores.test.ts src/routes/LoreSelectorRoute.test.tsx`
Expected: PASS — new store works, and the existing lores/selector suites are unbroken by the extraction.

- [ ] **Step 7: Commit**

```bash
git add src/registryDb.ts src/appSettings.ts src/appSettings.test.ts src/lores.ts
git commit -m "feat: app-level settings store on the lore registry (#173)"
```

---

### Task 2: Open the last world on launch

**Files:**
- Modify: `src/appSettings.ts` (append `shouldOpenLastWorld`)
- Modify: `src/appSettings.test.ts` (append the truth table)
- Modify: `src/routes/LoreSelectorRoute.tsx` (redirect on startup)
- Modify: `src/routes/LoreSelectorRoute.test.tsx` (mock `../appSettings`)

**Interfaces:**
- Consumes: `getAppSettings`, `AppSettings` (Task 1).
- Produces: `shouldOpenLastWorld(args: { openLastWorld: boolean; storedLoreId: string | null; knownIds: string[]; startupHandled: boolean }): boolean`

- [ ] **Step 1: Write the failing test**

Append to `src/appSettings.test.ts`:

```ts
import { shouldOpenLastWorld } from './appSettings'

describe('shouldOpenLastWorld', () => {
  const base = { openLastWorld: true, storedLoreId: 'w1', knownIds: ['w1', 'w2'], startupHandled: false }

  it('opens the remembered world when the pref is on', () => {
    expect(shouldOpenLastWorld(base)).toBe(true)
  })

  it('does nothing when the pref is off', () => {
    expect(shouldOpenLastWorld({ ...base, openLastWorld: false })).toBe(false)
  })

  it('does not redirect twice in one page life', () => {
    // Otherwise "switch world" from the sidebar would bounce straight back to
    // the world the user just left, making the picker unreachable.
    expect(shouldOpenLastWorld({ ...base, startupHandled: true })).toBe(false)
  })

  it('shows the picker when no world is remembered', () => {
    // deleteLore() removes CURRENT_LORE_KEY, so this is the just-deleted case:
    // land on the picker rather than silently opening 'default'.
    expect(shouldOpenLastWorld({ ...base, storedLoreId: null })).toBe(false)
  })

  it('shows the picker when the remembered world is gone', () => {
    expect(shouldOpenLastWorld({ ...base, knownIds: ['w2'] })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/appSettings.test.ts`
Expected: FAIL — `shouldOpenLastWorld` is not exported.

- [ ] **Step 3: Implement `shouldOpenLastWorld`**

Append to `src/appSettings.ts`:

```ts
/** Decide whether launching should skip the picker and reopen the last world.
 *  Pure, so every guard is testable:
 *   - `startupHandled` — only ever redirect once per page life, or "switch
 *     world" would bounce straight back and the picker would be unreachable.
 *   - `storedLoreId === null` — `deleteLore()` clears CURRENT_LORE_KEY, so the
 *     just-deleted case must land on the picker, not silently open 'default'.
 *   - `knownIds` — never redirect into a world that no longer exists. */
export function shouldOpenLastWorld(args: {
  openLastWorld: boolean
  storedLoreId: string | null
  knownIds: string[]
  startupHandled: boolean
}): boolean {
  const { openLastWorld, storedLoreId, knownIds, startupHandled } = args
  if (!openLastWorld || startupHandled) return false
  if (storedLoreId === null) return false
  return knownIds.includes(storedLoreId)
}
```

- [ ] **Step 4: Wire it into `LoreSelectorRoute`**

In `src/routes/LoreSelectorRoute.tsx`:

Add to the imports (`Navigate` joins whatever `react-router-dom` names are already imported):

```tsx
import { Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getAppSettings, shouldOpenLastWorld } from '../appSettings'
import { CURRENT_LORE_KEY } from '../loreId'
```

Above the component (module scope):

```tsx
// Only the first arrival at "/" in a page's life may auto-redirect. switchLore()
// and deleteLore() both reload the page, so this resets exactly when it should.
let startupHandled = false
```

Inside `LoreSelectorRoute`, immediately after the existing `const lores = useLiveQuery(listLores, []) ?? []` line, replace that line with:

```tsx
  const loresRaw = useLiveQuery(listLores, [])
  const lores = loresRaw ?? []
  const appSettings = useLiveQuery(() => getAppSettings(), [])

  const autoOpen =
    loresRaw !== undefined &&
    appSettings !== undefined &&
    shouldOpenLastWorld({
      openLastWorld: appSettings.openLastWorld,
      storedLoreId: localStorage.getItem(CURRENT_LORE_KEY),
      knownIds: loresRaw.map((l) => l.id),
      startupHandled,
    })

  useEffect(() => {
    // Set in an effect, never during render — mutating module state while
    // rendering violates react-hooks/purity (and would misfire under StrictMode).
    startupHandled = true
  }, [])

  // Still loading: render nothing rather than flashing the picker for a frame
  // before redirecting away from it.
  if (loresRaw === undefined || appSettings === undefined) return null
  if (autoOpen) return <Navigate to="/home" replace />
```

If `useEffect` is not already imported from `react` in this file, add it.

- [ ] **Step 5: Keep the selector test honest**

`LoreSelectorRoute.test.tsx` mocks `../lores` wholesale, so `getAppSettings` must be mocked too or the route reads a real DB in a suite that has none. Add alongside the existing `vi.mock` calls:

```tsx
vi.mock('../appSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../appSettings')>()),
  getAppSettings: vi.fn(async () => ({
    openLastWorld: false, // the picker's own suite must always see the picker
    spellcheck: true,
    spellcheckLang: '',
    backupOnExit: false,
    defaultBackupDir: null,
  })),
}))
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/appSettings.test.ts src/routes/LoreSelectorRoute.test.tsx`
Expected: PASS — the truth table is green and the picker suite still renders the picker.

- [ ] **Step 7: Commit**

```bash
git add src/appSettings.ts src/appSettings.test.ts src/routes/LoreSelectorRoute.tsx src/routes/LoreSelectorRoute.test.tsx
git commit -m "feat: optionally reopen the last world on launch (#173)"
```

---

### Task 3: Spellcheck + language in the editor

`SceneEditor` renders `LoreEditor`, so both the wiki editor and the manuscript editor are fixed by changing `LoreEditor` alone.

The attributes are synced imperatively rather than through `useEditor`'s deps array: re-creating the editor on a settings change would rebuild it from the last *saved* `content` prop and could drop in-flight edits.

**Files:**
- Modify: `src/components/LoreEditor.tsx:142-168` (after the `useEditor` call)
- Create: `src/components/LoreEditor.test.tsx`

**Interfaces:**
- Consumes: `getAppSettings`, `DEFAULT_APP_SETTINGS` (Task 1).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Create `src/components/LoreEditor.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { registry } from '../registryDb'
import { APP_SETTINGS_KEY } from '../appSettings'
import LoreEditor from './LoreEditor'

afterEach(cleanup)
beforeEach(async () => { await registry.appMeta.clear() })

function renderEditor() {
  return render(
    <MemoryRouter>
      <LoreEditor content="<p>hello</p>" editable onChange={() => {}} />
    </MemoryRouter>,
  )
}

describe('LoreEditor spellcheck', () => {
  it('spellchecks by default', async () => {
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('spellcheck')).toBe('true')
    })
  })

  it('turns spellcheck off when the app setting is off', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheck: false } })
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('spellcheck')).toBe('false')
    })
  })

  it('sets the dictionary language when one is chosen', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: 'fr' } })
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('lang')).toBe('fr')
    })
  })

  it('leaves the language to the OS when set to system default', async () => {
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })
    expect(container.querySelector('.ProseMirror')?.hasAttribute('lang')).toBe(false)
  })
})
```

If `LoreEditor`'s required props differ from `content` / `editable` / `onChange`, read its props interface (around `src/components/LoreEditor.tsx:80-95`) and pass exactly what it requires — do not change the component's props to suit the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/LoreEditor.test.tsx`
Expected: FAIL — the `.ProseMirror` element has no `spellcheck="false"` / `lang` handling.

- [ ] **Step 3: Implement**

In `src/components/LoreEditor.tsx`, add to the imports:

```tsx
import { getAppSettings, DEFAULT_APP_SETTINGS } from '../appSettings'
```

(`useLiveQuery` and `useEffect` are already imported in this file.)

Directly after the `const editor = useEditor({ ... })` call (which ends at line 168), add:

```tsx
  // Spellcheck is an app-level (device) preference, so both this editor and the
  // manuscript SceneEditor — which renders LoreEditor — follow it.
  const appSettings = useLiveQuery(() => getAppSettings(), [])
  const spellcheck = appSettings?.spellcheck ?? DEFAULT_APP_SETTINGS.spellcheck
  const spellcheckLang = appSettings?.spellcheckLang ?? DEFAULT_APP_SETTINGS.spellcheckLang

  useEffect(() => {
    if (!editor) return
    // Set on the live DOM rather than through useEditor's deps: re-creating the
    // editor would rebuild it from the last *saved* `content` and could drop
    // in-flight edits just because a checkbox moved.
    const dom = editor.view.dom
    dom.setAttribute('spellcheck', String(spellcheck))
    // No lang attribute = the browser/OS picks the dictionary, which is what
    // "System default" means. An installed dictionary is required either way.
    if (spellcheckLang) dom.setAttribute('lang', spellcheckLang)
    else dom.removeAttribute('lang')
  }, [editor, spellcheck, spellcheckLang])
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/LoreEditor.test.tsx src/components/manuscript/SceneEditor.test.tsx`
Expected: PASS — spellcheck honoured, and the manuscript editor that reuses it still renders.

- [ ] **Step 5: Commit**

```bash
git add src/components/LoreEditor.tsx src/components/LoreEditor.test.tsx
git commit -m "feat: spellcheck + dictionary language for the editor (#173)"
```

---

### Task 4: Extend the platform seam (directory picker, close hook, default save dir)

**Files:**
- Modify: `src/platform.ts:32-59` (`saveFile` gains an options arg), append `pickDirectory` + `onCloseRequested`
- Modify: `src-tauri/capabilities/default.json` (add `core:window:allow-destroy`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `saveFile(data: Blob | string, suggestedName: string, opts?: { defaultDir?: string | null }): Promise<boolean>` — additive, existing 2-arg call sites are unchanged
  - `pickDirectory(): Promise<string | null>` — `null` in the browser and on cancel
  - `onCloseRequested(handler: () => Promise<void>): Promise<() => void>` — resolves an unsubscribe fn; a no-op in the browser

- [ ] **Step 1: Give `saveFile` a default directory**

In `src/platform.ts`, change the `saveFile` signature and its Tauri branch:

```ts
export async function saveFile(
  data: Blob | string,
  suggestedName: string,
  opts?: { defaultDir?: string | null },
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    // A remembered folder only *pre-fills* the dialog — it grants no write
    // access on its own (Tauri scopes fs writes to paths picked in the current
    // session's dialog), and the user still confirms the path.
    const dir = opts?.defaultDir?.replace(/[\\/]+$/, '')
    const path = await save({ defaultPath: dir ? `${dir}/${suggestedName}` : suggestedName })
    if (!path) return false
    ...unchanged...
```

Leave the browser branch alone — a download always lands in the browser's own download folder, and `opts` is simply ignored there.

- [ ] **Step 2: Append `pickDirectory` and `onCloseRequested`**

Append to `src/platform.ts`:

```ts
/**
 * Let the user pick a folder. Shell-only: resolves `null` in the browser (no
 * directory picker exists there) and on cancel.
 *
 * The returned path is a *hint for the Save dialog*, not a grant: writing to it
 * silently in a later session would fail, because Tauri only scopes fs writes to
 * paths picked in the current session's dialog. See
 * `src-tauri/capabilities/default.json`.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ directory: true, multiple: false })
  return typeof path === 'string' ? path : null
}

/**
 * Run `handler` when the user closes the desktop window, then close it.
 * Resolves an unsubscribe function; a no-op in the browser, where an async
 * export cannot be awaited on unload (and nothing is lost anyway — IndexedDB
 * persists), so no equivalent is offered.
 *
 * The close is deliberately wrapped: a failing handler must never wedge the
 * window shut. Whatever happens, the window is destroyed.
 */
export async function onCloseRequested(handler: () => Promise<void>): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  const unlisten = await win.onCloseRequested(async (event) => {
    event.preventDefault() // we need to await the handler before the window goes
    try {
      await handler()
    } catch {
      // A failed exit-backup is not a reason to trap the user in the app.
    }
    unlisten()
    await win.destroy()
  })
  return unlisten
}
```

- [ ] **Step 3: Grant the one permission this needs**

`onCloseRequested` calls `destroy()`, which `core:default` does not cover. In `src-tauri/capabilities/default.json`, add `"core:window:allow-destroy"` to `permissions`, and extend the `description` so the file keeps explaining itself:

```json
  "description": "Main-window permissions, deliberately minimal. Everything here backs src/platform.ts (the only module allowed to call shell APIs): saveFile = Save-As dialog + write to the picked path; openTextFile = Open dialog + read of the picked path (the dialog plugin adds picked paths to the fs scope at runtime, so no static path scope is granted for either); pickDirectory = Open dialog in directory mode, whose result only pre-fills the Save dialog — it is NOT a write grant; writeAppData = pre-import safety copies and exit-backups under $APPDATA/backups; onCloseRequested = intercept the window close to finish an exit-backup, which needs window:destroy to then actually close it.",
```

and:

```json
    "core:window:allow-destroy",
```

**No new fs scope is added.** Exit-backups go to `$APPDATA`, already covered by `fs:allow-appdata-write-recursive`.

- [ ] **Step 4: Verify nothing regressed**

Run: `npm run lint && npx vitest run src/routes/SettingsRoute.test.tsx src/routes/LoreSelectorRoute.test.tsx`
Expected: PASS — `saveFile`'s third arg is optional, so every existing call site still typechecks.

If a Rust toolchain is available, also run `cd src-tauri && cargo check` (this is what `.github/workflows/desktop.yml` runs on PRs touching `src-tauri/**`; `build.rs` validates the capability ACL, so a typo'd permission name fails here rather than at release).

- [ ] **Step 5: Commit**

```bash
git add src/platform.ts src-tauri/capabilities/default.json
git commit -m "feat: platform seam gains pickDirectory + onCloseRequested (#173)"
```

---

### Task 5: Back up on exit

**Files:**
- Modify: `src/backup.ts` (append `shouldBackupOnExit` + `backupOnExit`; `downloadBackup` honours the default dir)
- Create: `src/backup.exit.test.ts`
- Modify: `src/App.tsx` (register the close hook on start)

**Interfaces:**
- Consumes: `onCloseRequested`, `writeAppData`, `saveFile(…, opts)` (Task 4); `getAppSettings` (Task 1).
- Produces: `shouldBackupOnExit(enabled: boolean, lastBackup: number | null, latestChange: number): boolean`, `backupOnExit(): Promise<boolean>`

- [ ] **Step 1: Write the failing test**

Create `src/backup.exit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldBackupOnExit } from './backup'

describe('shouldBackupOnExit', () => {
  it('does nothing when the setting is off', () => {
    expect(shouldBackupOnExit(false, null, 500)).toBe(false)
  })

  it('backs up when enabled and there are unbacked changes', () => {
    expect(shouldBackupOnExit(true, 100, 500)).toBe(true)
  })

  it('skips the write when everything is already backed up', () => {
    // Closing the app ten times in a row must not litter ten identical files.
    expect(shouldBackupOnExit(true, 500, 100)).toBe(false)
  })

  it('skips an empty world', () => {
    expect(shouldBackupOnExit(true, null, 0)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/backup.exit.test.ts`
Expected: FAIL — `shouldBackupOnExit` is not exported from `./backup`.

- [ ] **Step 3: Implement in `src/backup.ts`**

Add `getAppSettings` to the imports:

```ts
import { getAppSettings } from './appSettings'
```

Change `downloadBackup` so the Save dialog opens in the user's chosen folder:

```ts
export async function downloadBackup(): Promise<void> {
  const json = await exportAll()
  const { defaultBackupDir } = await getAppSettings()
  const saved = await saveFile(json, `lore-backup-${backupStamp()}.json`, { defaultDir: defaultBackupDir })
  if (saved) await setMeta(LAST_BACKUP_KEY, Date.now())
}
```

Append the exit-backup pair:

```ts
/** Whether closing the app should write an exit-backup. Pure, so the policy is
 *  testable without a window: enabled, and something actually changed since the
 *  last backup — closing ten times in a row must not litter ten identical files. */
export function shouldBackupOnExit(
  enabled: boolean,
  lastBackup: number | null,
  latestChange: number,
): boolean {
  return enabled && hasUnbackedUpChanges(lastBackup, latestChange)
}

/**
 * Write a backup to the app's data folder as the desktop app closes.
 *
 * Deliberately does NOT stamp LAST_BACKUP_KEY. An $APPDATA copy is a safety net,
 * not a backup that has left the machine — silencing the "back up your world"
 * banner here would tell the user their data is safe off-disk when it isn't.
 * (This is also why the chosen backup folder isn't written to: a folder picked
 * in an earlier session carries no write permission — see platform.ts.)
 *
 * Returns false in the browser, where writeAppData is a no-op.
 */
export async function backupOnExit(): Promise<boolean> {
  const json = await exportAll()
  return writeAppData(`backups/exit-${backupStamp()}.json`, json)
}
```

- [ ] **Step 4: Register the hook in `src/App.tsx`**

Add to the imports:

```tsx
import { onCloseRequested } from './platform'
import { latestChangeTime, shouldBackupOnExit, backupOnExit, LAST_BACKUP_KEY } from './backup'
import { getAppSettings } from './appSettings'
import { getMeta } from './db'
```

(Some of these may already be imported — merge, don't duplicate.)

Add this effect alongside the existing start-up effects in the `App` component:

```tsx
  // Desktop only: finish a backup before the window closes. Everything is read
  // *inside* the handler, at exit time — a value captured now would be stale by
  // the time the user actually quits.
  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    onCloseRequested(async () => {
      const { backupOnExit: enabled } = await getAppSettings()
      const lastBackup = (await getMeta<number>(LAST_BACKUP_KEY)) ?? null
      if (shouldBackupOnExit(enabled, lastBackup, await latestChangeTime())) {
        await backupOnExit()
      }
    }).then((off) => {
      if (cancelled) off()
      else dispose = off
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])
```

Note the local rename in the destructure (`backupOnExit: enabled`) — the setting and the function share a name.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/backup.exit.test.ts && npm run test:run`
Expected: PASS, whole suite green (`onCloseRequested` is a no-op in the test environment, so `App` is unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/backup.ts src/backup.exit.test.ts src/App.tsx
git commit -m "feat: write a backup to app data when the desktop app closes (#173)"
```

---

### Task 6: The Settings page — rows, sections, new controls

Fixes #173's "margin": the 880px column is already centred (measured: 34.5px symmetric gutters in a 959px content area), but every control hugs the left edge of its 800px card — a 120px input beside ~600px of dead space. A `1fr auto` row grid closes that gap and gives each option's description a home.

**Files:**
- Modify: `src/index.css:2379-2389` (the `.settings-field` rules) and `:747` (the stale `.settings-field-check` flex rule)
- Modify: `src/routes/SettingsRoute.tsx` (sections + the four new controls)
- Modify: `src/routes/SettingsRoute.test.tsx`

**Interfaces:**
- Consumes: `getAppSettings`, `updateAppSettings`, `SPELLCHECK_LANGS`, `AppSettings`, `DEFAULT_APP_SETTINGS` (Task 1); `pickDirectory`, `isTauri` (Task 4).
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Append to `src/routes/SettingsRoute.test.tsx`. The existing `vi.mock('../platform', …)` factory must gain `pickDirectory` (it mocks the module wholesale, so any new import from it is `undefined` otherwise):

```tsx
vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  writeAppData: vi.fn(async () => false),
  saveFile: vi.fn(async () => true),
  pickDirectory: vi.fn(async () => null),
  isTauri: () => false, // the suite runs as the browser build
}))
```

and add, importing `registry` from `../registryDb` and `getAppSettings` from `../appSettings`:

```tsx
describe('SettingsRoute app-level options', () => {
  beforeEach(async () => { await registry.appMeta.clear() })

  it('toggles "open the last world on launch"', async () => {
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    const box = await screen.findByLabelText(/open the last world/i)
    expect((box as HTMLInputElement).checked).toBe(false) // today's behaviour
    fireEvent.click(box)
    await waitFor(async () => {
      expect((await getAppSettings()).openLastWorld).toBe(true)
    })
  })

  it('picks a spellcheck language', async () => {
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    const select = await screen.findByLabelText(/spellcheck language/i)
    fireEvent.change(select, { target: { value: 'fr' } })
    await waitFor(async () => {
      expect((await getAppSettings()).spellcheckLang).toBe('fr')
    })
  })

  it('disables the desktop-only options in the browser', async () => {
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    const exit = await screen.findByLabelText(/back up when I close/i)
    expect((exit as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText(/desktop app only/i).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/SettingsRoute.test.tsx`
Expected: FAIL — no such labels on the page.

- [ ] **Step 3: Rebuild the row styles**

In `src/index.css`, replace the `.settings-field` block (lines ~2379-2389) with:

```css
/* A settings row: label (+ description) on the left, control hard right.
   Before this, every control hugged the left edge of an 800px card — a 120px
   input marooned beside ~600px of dead space (#173). */
.settings-field {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  column-gap: 24px;
  row-gap: 4px;
  padding: 14px 0;
  border-top: 1px solid var(--border);
  font-size: 13px;
  color: var(--ink-dim);
}
.settings-field:first-of-type { border-top: 0; padding-top: 4px; }
.settings-label { grid-column: 1; grid-row: 1; color: var(--ink); }
.settings-field input,
.settings-field select,
.settings-field .mini-btn { grid-column: 2; grid-row: 1; justify-self: end; }
.settings-field input[type='number'] { width: 96px; }
.settings-field input[type='checkbox'] { width: auto; }
.settings-field select { min-width: 180px; }
.settings-field input,
.settings-field select {
  background: var(--bg-2);
  border: 1px solid var(--border);
  color: var(--ink);
  border-radius: 6px;
  padding: 6px 8px;
}
/* The description lives under the label, never under the control. */
.settings-hint {
  grid-column: 1;
  grid-row: 2;
  font-size: 12px;
  color: var(--ink-dim);
  opacity: 0.85;
  max-width: 60ch;
}
.settings-field.is-disabled { opacity: 0.55; }
```

Delete the now-dead `.settings-field-check` rules at line ~747 and ~2388-2389 — a checkbox is just a control in column 2 now, so the flex override is obsolete. Delete the `.settings-controls` rule if one exists; the three snapshot inputs become three rows.

- [ ] **Step 4: Rebuild the page**

In `src/routes/SettingsRoute.tsx`:

Add the imports:

```tsx
import { getAppSettings, updateAppSettings, DEFAULT_APP_SETTINGS, SPELLCHECK_LANGS, type AppSettings } from '../appSettings'
import { openTextFile, isTauri, pickDirectory } from '../platform'
```

Add app-settings state next to the existing per-world `draft` block:

```tsx
  // App-level (device) prefs live in the registry DB, not this world's meta —
  // they are not properties of a world and must not travel in its backups.
  const app = useLiveQuery(() => getAppSettings(), [])
  const a = app ?? DEFAULT_APP_SETTINGS
  const desktop = isTauri()
  function setApp(patch: Partial<AppSettings>) {
    updateAppSettings(patch) // useLiveQuery re-reads; no local mirror to drift
  }
```

Then restructure the JSX. Each `<label className="settings-field">` is one row: `.settings-label`, its control, and a `.settings-hint`. Add a **General** section above Auto-snapshots and an **Editor** section that absorbs the old "Linking" section:

```tsx
      {/* General */}
      <section className="settings-section">
        <h2>General</h2>
        <label className="settings-field">
          <span className="settings-label">Open the last world on launch</span>
          <input
            type="checkbox"
            checked={a.openLastWorld}
            onChange={(e) => setApp({ openLastWorld: e.target.checked })}
          />
          <span className="settings-hint">
            Skip the world picker and go straight back to whichever world you were last in.
          </span>
        </label>
      </section>

      {/* Editor */}
      <section className="settings-section">
        <h2>Editor</h2>
        <label className="settings-field">
          <span className="settings-label">Check spelling as I write</span>
          <input
            type="checkbox"
            checked={a.spellcheck}
            onChange={(e) => setApp({ spellcheck: e.target.checked })}
          />
          <span className="settings-hint">
            Underlines misspelled words in the page and manuscript editors.
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-label">Spellcheck language</span>
          <select
            value={a.spellcheckLang}
            onChange={(e) => setApp({ spellcheckLang: e.target.value })}
          >
            {SPELLCHECK_LANGS.map((l) => (
              <option key={l.id || 'system'} value={l.id}>{l.label}</option>
            ))}
          </select>
          <span className="settings-hint">
            The dictionary comes from your browser or operating system — a language you
            haven't installed there quietly falls back to the system default.
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-label">Auto-link page titles in body text</span>
          <input
            type="checkbox"
            checked={s.autolinkEnabled}
            onChange={(e) => setField({ autolinkEnabled: e.target.checked })}
          />
          <span className="settings-hint">
            Links the first mention of another page's title in each page's body. Your own
            [[links]] always take precedence.
          </span>
        </label>
      </section>
```

Delete the old `{/* Linking */}` section entirely (it now lives in Editor). Convert the three Auto-snapshots inputs and the "Warn me to back up" input from bare `.settings-field` labels into the same three-part row shape (`.settings-label` + input + `.settings-hint`), dropping the `.settings-controls` wrapper. Suggested hints, one line each: "A snapshot is taken once this many pages have changed." · "…or once this long has passed with at least one change." · "Older snapshots are pruned beyond this count." · "A banner nags you once this many days pass without a backup."

Add the two desktop rows at the end of the **Backup & data** section, before the `backup-tip` block:

```tsx
        <label className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Back up when I close the app</span>
          <input
            type="checkbox"
            disabled={!desktop}
            checked={a.backupOnExit}
            onChange={(e) => setApp({ backupOnExit: e.target.checked })}
          />
          <span className="settings-hint">
            {desktop
              ? 'Writes a copy into the app’s data folder on exit, if anything changed. It’s a safety net, not an off-machine backup — it doesn’t clear the reminder above.'
              : 'Desktop app only. A browser can’t finish saving a file while the tab is closing.'}
          </span>
        </label>

        <div className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Default backup folder</span>
          <button
            className="mini-btn"
            disabled={!desktop}
            onClick={async () => {
              const dir = await pickDirectory()
              if (dir) setApp({ defaultBackupDir: dir })
            }}
          >
            {a.defaultBackupDir ? 'Change…' : 'Choose…'}
          </button>
          <span className="settings-hint">
            {desktop
              ? a.defaultBackupDir
                ? `“Back up now” opens here: ${a.defaultBackupDir}`
                : 'Pick a cloud-synced folder and “Back up now” will open there — one click instead of navigating every time.'
              : 'Desktop app only. Browsers always save to their own downloads folder.'}
          </span>
        </div>
```

Note this last one is a `<div>`, not a `<label>` — a label wrapping a button would swallow the click.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/routes/SettingsRoute.test.tsx`
Expected: PASS — including the pre-existing tests in that file, which must still find their sections.

- [ ] **Step 6: Look at it**

Run `npm run dev` (port 5174 — if it's taken, a server is already running; use it) and open `http://localhost:5174/#/settings`. Confirm: rows are label-left / control-right with no dead zone; the two desktop rows are visibly disabled with a "Desktop app only" note; toggling "open the last world", reloading, and landing on `/` goes straight to `/home`; unticking spellcheck removes the red underlines in a page editor.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/routes/SettingsRoute.tsx src/routes/SettingsRoute.test.tsx
git commit -m "feat: settings rows + General/Editor sections + desktop options (#173)"
```

---

### Task 7: Document, verify, ship

**Files:**
- Modify: `CLAUDE.md` (the architecture map)

- [ ] **Step 1: Update the architecture map**

`CLAUDE.md` currently documents settings only as per-world. In the **Multiple worlds** section, note that `registryDb.ts` owns the `lore-registry` DB (`lores` + `appMeta`, v2) and that `appSettings.ts` holds device-level prefs — `openLastWorld`, `spellcheck`/`spellcheckLang`, `backupOnExit`, `defaultBackupDir` — which deliberately live outside per-world `meta` so they never travel in a backup. In the **Desktop shell** section, add `pickDirectory()` and `onCloseRequested()` to the list of seam functions, and record that exit-backups land in `$APPDATA/backups` because a folder picked in an earlier session carries no write scope.

- [ ] **Step 2: Full verification**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass. Do not proceed on a failure — fix it.

- [ ] **Step 3: Commit and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: record the app-level settings store and the new seam fns (#173)"
git push -u origin feat/173-settings-rework
gh pr create --title "feat: Settings rework — app-level prefs, spellcheck, exit backup (#173)" --label version:minor --body "..."
```

The PR body must state: what shipped; that **theme is out of scope** and why (one committed visual identity, its own issue if wanted); and that exit-backups go to `$APPDATA` rather than the chosen folder because granting a persistent write scope to an arbitrary folder (`tauri-plugin-persisted-scope` or a static `$HOME/**` scope) was rejected as too broad.

**`version:minor` label is required** — `.github/workflows/version-bump.yml` reads it, and an unlabelled PR silently ships as a patch.

- [ ] **Step 4: Answer the issue**

Comment on #173 that theme was descoped, with the reasoning, so the decision is recorded where the request lives.

---

## Self-Review

**Spec coverage:** app-level store (T1) · open last world (T2) · spellcheck + language (T3) · default folder + close hook seam (T4) · backup on exit (T5) · layout fix + IA + desktop-only rows (T6) · docs/theme-descope (T7). Every spec section maps to a task.

**Type consistency:** `getAppSettings`/`updateAppSettings`/`shouldOpenLastWorld`/`SPELLCHECK_LANGS`/`DEFAULT_APP_SETTINGS` are named identically wherever they appear; `saveFile`'s third parameter is `opts?: { defaultDir?: string | null }` in both its definition (T4) and its caller (T5); `registry.appMeta` is used consistently across T1/T3/T6 tests.

**Known sharp edges, flagged for the implementer:**
- `LoreSelectorRoute.test.tsx` and `SettingsRoute.test.tsx` both `vi.mock` whole modules — a new import from a mocked module is `undefined` unless the factory is extended (T2 Step 5, T6 Step 1).
- The setting `backupOnExit` and the function `backupOnExit` collide by name in `App.tsx`; the destructure renames it (T5 Step 4).
