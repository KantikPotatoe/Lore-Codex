# Multi-tab write safety (Issue 185 / Audit C4) — Design

**Status:** approved for planning
**Issue:** #185 — Silent non-quota write failures + no multi-tab guard
**Date:** 2026-07-06

## Problem

Nearly every mutation in Lore Codex is fire-and-forget from an event handler. The
only safety net (`installStorageErrorListener` → `reportStorageError`) deliberately
ignores anything that is not a quota error, so a `DatabaseClosedError` /
`AbortError` rejection vanishes into the console while the user keeps typing.

Two IndexedDB tabs on one origin is the trigger, and nothing in the app prevents or
detects it.

## Blast radius (verified live, 2026-07-06)

Measured with a throwaway `blast-radius-test` IndexedDB (real data untouched); the
cross-tab semantics observed are generic to IndexedDB.

**Scenario 1 — Import (`importAll` = `clear()` + `bulkAdd`, same schema version): silent.**
- No `versionchange` / `blocked` event fires — the DB version does not change.
- The other tab's still-open connection *instantly* reads the imported rows; its
  world is swapped underneath it with zero signal.
- The other tab's mid-edit write **succeeds** and grafts onto the imported dataset.
  The real corruption vector: that tab's UI still holds stale in-memory objects from
  the *old* world, and its next autosave writes them into the imported world →
  cross-world contamination. Nothing throws; nothing reaches the storage layer.
- **Only a `BroadcastChannel` can detect this.** The `unhandledrejection` listener is
  powerless here.

**Scenario 2 — Delete / switch (`Dexie.delete` → `deleteDatabase`): a `versionchange` fires** (`oldVersion:1 → newVersion:null`).
- `schema.ts` does not override Dexie's default `versionchange` handler, so Dexie
  closes the connection. After close, the other tab's fire-and-forget writes reject
  with `DatabaseClosedError`.
- That rejection reaches `unhandledrejection` → `reportStorageError` → **currently
  ignored** (not a quota error). This is the gap Piece 1 closes.
- Until the other tab closes, the delete is `blocked`; with Dexie auto-closing it
  proceeds, leaving that tab writing into a vanishing DB.

**Conclusion:** the two remedies are complementary and both required. Piece 1
surfaces the delete/switch `DatabaseClosedError`; Piece 2 (`BroadcastChannel`) is the
only thing that catches the silent import case and gives a uniform "reload" UX.

## Piece 1 — surface dropped writes (`src/storageError.ts`)

Widen the reporter with a **conservative** name allowlist so a dropped write raises a
generic notice, quota staying the specialized case.

- Add `GENERIC_MESSAGE`:
  > "Some recent changes may not have been saved. Download a backup to be safe, then reload."
- Add `isDroppedWriteError(err)`: true when the error `name` (recursing into `.inner`
  like `isQuotaError`) is one of:
  `DatabaseClosedError`, `AbortError`, `InvalidStateError`,
  `TransactionInactiveError`, `UnknownError`.
  **Excludes** `ConstraintError` — it signals a logic bug (e.g. the bootstrap
  duplicate-key path), not lost user data, and would false-positive.
- `reportStorageError(err)` order: quota → `QUOTA_MESSAGE`; else dropped-write →
  `GENERIC_MESSAGE`; else ignore. Quota wins when both could match (more specific).
- `StorageErrorBanner` already renders whatever `active` message the bus holds — no
  component change. Its "Download a backup" action fits the generic case too.

## Piece 2 — cross-tab freeze (`BroadcastChannel`)

### New module `src/tabSync.ts` (React-free, mirrors `storageError.ts`)

- Channel name: `'lore-tab-sync'` (per-origin `BroadcastChannel`).
- Message shape: `{ type: 'world-changed', loreId: string, reason: 'import' | 'delete' }`.
- `broadcastWorldChange(loreId, reason)` — posts the message. No-op when
  `BroadcastChannel` is undefined (feature-detected; keeps tests/older targets safe).
- `matchesBoundLore(msg, boundLoreId)` — **pure**, unit-testable predicate: true when
  `msg.type === 'world-changed' && msg.loreId === boundLoreId`. Keeps the filtering
  logic testable without a live channel.
- `installTabSyncListener(boundLoreId)` — idempotent; opens the channel and, on a
  matching message, drives a bus state (subscribe/emit like `subscribeStorageError`)
  carrying the `reason`.
- `subscribeTabSync(cb)` / `useTabSync()` React binding returning `{ reason | null }`.

### DB-bound id capture (`src/db/schema.ts`)

`db = new LoreDB(dbNameFor(currentLoreId()))` binds at module load. A switch in
another tab mutates shared `localStorage`, so `currentLoreId()` no longer reflects
what *this* tab's db bound to. Capture it once:

```ts
export const activeLoreId = currentLoreId()
export const db = new LoreDB(dbNameFor(activeLoreId))
```

Re-export `activeLoreId` from the `db` barrel (`src/db/index.ts`) — `barrel.test.ts`
requires new public API to be re-exported.

### Broadcast points (before the destructive op)

- `importAll(json)` in `src/db/backup.ts` → `broadcastWorldChange(activeLoreId, 'import')`.
  (`importAll` always targets the active db.)
- `deleteLore(id)` in `src/lores.ts` → `broadcastWorldChange(id, 'delete')` before
  `Dexie.delete`.
- **Not** `importBackupInto` (migration wizard imports into a non-active world — no
  other tab is bound to it). **Not** `switchLore` (does not touch other worlds' data).

### Receiving side

- App startup effect calls `installTabSyncListener(activeLoreId)` next to
  `installStorageErrorListener()`.
- New `src/components/TabSyncOverlay.tsx` mounted at App root subscribes via
  `useTabSync()` and, when a `reason` is set, renders a **non-dismissable** full-screen
  overlay (`role="alertdialog"`) with a single **Reload** button:
  - `'import'` → "This world was replaced by an import in another tab." → plain
    `window.location.reload()` (show the new data).
  - `'delete'` → "This world was deleted in another tab." → `window.location.hash = '#/'`
    then `window.location.reload()` (world gone → land on the selector, always safe).

## Testing

- **`src/storageError.test.ts`** (extend): allowlist matrix — quota error → quota
  message; each allowlisted name → generic message; `ConstraintError` and an arbitrary
  error → ignored (`active` stays null); `.inner`-nested allowlisted name → generic.
- **`src/tabSync.test.ts`** (new): `matchesBoundLore` truth table (matching id,
  non-matching id, wrong `type`); bus subscribe/emit replays current state to late
  subscribers; `broadcastWorldChange` is a safe no-op when `BroadcastChannel` is
  absent.
- **Live verification:** rebuild, re-run the two-tab experiment against the app —
  import in tab B, confirm the overlay freezes tab A; delete a world in tab B, confirm
  the overlay + reload-to-selector.
- CI gate: `npm run lint && npm run build && npm run test:run` all green.

## Out of scope (noted)

The `switchLore` same-tab last-keystroke race (reload fires immediately after
`setCurrentLore`) is listed only as "Related" in the audit, not part of the C4
remedy. Left for a separate issue.
