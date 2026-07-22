# World Mirror — Critical Fix Plan (#174)

> Addendum to `2026-07-21-world-mirror.md`, written after the whole-branch review
> returned **do not merge**. Tasks 1-9 of the original plan are complete and
> committed (`5a1e589..418f9be`); this plan fixes what that branch got wrong.

**Goal:** Make the primary scenario — edit, storage evicted, relaunch, restore — actually work, and settle the on-disk format before any user has a `registry.json`.

**Why these are not ordinary bugs:** C1 and C2 are errors in the *design*, not the implementation. Each component is correct alone; they combine badly. No per-task review could have caught them, and the fixes change behaviour the spec asserted.

## Global Constraints

- `@tauri-apps/*` may be imported ONLY in `src/platform.ts`. The Dexie `db` singleton only inside `src/db/**` plus the named infra allowlist in `eslint.config.js`. **Never** write `'no-restricted-imports': 'off'`.
- No host `alert()`/`confirm()` — use `ConfirmDialog`.
- TypeScript `strict`. `setState`-in-effect is a lint error. `react-hooks/purity` forbids literal `Date.now()` in render.
- `src/index.css` uses **px, not rem** (`cssUnits.test.ts` enforces it). Only existing tokens: `--panel`, `--panel-2`, `--border`, `--ink`, `--ink-dim`, `--ink-faint`, `--accent`, `--danger`, `--radius`, `--display`.
- `BackupBanner`, `backupOnExit`, and `LAST_BACKUP_KEY` stamping stay unchanged.
- `npm run lint && npm run build && npm run test:run` must pass before any task is done.
- Every behavioural fix must be proved by mutation: break the fix, watch the new test fail, revert.

---

## Task 1: The index must merge, never replace (C1 + C3)

**Files:** Create `src/worldIndex.ts`, `src/worldIndex.test.ts` · Modify `src/lores.ts`, `src/worldMirrorSync.ts`, `src/worldRecovery.ts`

**The bug.** `syncRegistryMirror()` builds `registry.json` from `listLores()` and writes it as a full replacement, and `App.tsx` runs it on every launch. On the eviction launch the registry DB is empty, so the index is overwritten with `[]`, erasing the only pointers to the `.lore` files on disk. Recovery never enumerates the directory, so that data becomes permanently unreachable. The same fires on partial restore.

**Second bug, same file.** `mirroredAt` is stamped `Date.now()` for every world at index-write time, though only the active world is ever mirrored. Worlds with no `.lore` on disk are advertised as "mirrored just now"; restore then fails on them. This is a false durability claim at the decision point and **cannot be corrected after users have an index on disk**.

- [ ] **Step 1: Pure merge logic, tests first.** New `src/worldIndex.ts`:

```ts
export interface WorldIndexEntry {
  id: string
  name: string
  /** When this world's .lore was last written, or null if never (this install). */
  mirroredAt: number | null
  appVersion: string | null
}

/**
 * Reconcile the on-disk index with the registry DB.
 *
 * A UNION, never a replacement. The registry DB is the volatile store this
 * whole feature exists to survive; rebuilding the index from it means an
 * eviction erases the pointers to the very files that survived. Entries known
 * only to disk are therefore KEPT, and dropped only by an explicit delete.
 *
 * `mirroredAt` is carried from the on-disk entry — never invented here. Only a
 * real mirror write may stamp it (see markWorldMirrored).
 */
export function mergeWorldIndex(args: {
  onDisk: WorldIndexEntry[]
  known: { id: string; name: string }[]
  appVersion: string
}): WorldIndexEntry[]

/** Set one world's mirroredAt, inserting the entry if absent. */
export function markWorldMirrored(
  index: WorldIndexEntry[], id: string, name: string, at: number, appVersion: string,
): WorldIndexEntry[]

/** Drop one world entirely — the only way an entry leaves the index. */
export function dropWorldFromIndex(index: WorldIndexEntry[], id: string): WorldIndexEntry[]
```

Required test cases: a registry-only world enters with `mirroredAt: null`; a disk-only world **survives a merge against an empty registry** (the eviction case — this is the test that pins C1); a world in both keeps its disk `mirroredAt` and takes the registry's `name` (renames must propagate); `markWorldMirrored` sets only its own entry; `dropWorldFromIndex` removes only the named id; duplicate ids on disk collapse to one entry.

- [ ] **Step 2: Rewrite `syncRegistryMirror` to read-merge-write.** It must `readRegistryMirror()` → `parseDiskRegistry` → `mergeWorldIndex` → `writeRegistryMirror`. Keep it best-effort (swallowing its own failures) and keep the existing call sites. `deleteLore` must use `dropWorldFromIndex` so a deletion still removes the entry.

- [ ] **Step 3: Stamp `mirroredAt` at a real write.** In `src/worldMirrorSync.ts`, after `writeWorldMirror` returns `true`, update the index for that world via `markWorldMirrored`. This is what the spec claimed already happened and did not.

- [ ] **Step 4: Never offer a world with no mirror.** In `src/worldRecovery.ts`, `plannedRecovery` must exclude entries whose `mirroredAt` is `null` — there is no file to restore from, and offering one produces a failed restore. Add a test.

- [ ] **Step 5: Prove C1 is fixed by mutation.** Revert `syncRegistryMirror` to a replace, confirm the disk-only-world merge test fails, revert. Report both runs.

- [ ] **Step 6:** Full gate, commit.

---

## Task 2: Recovery must survive the self-seeding registry (C2)

**Files:** Modify `src/lores.ts`, `src/App.tsx` (or wherever bootstrap is wired) · Tests alongside

**The bug.** Deleting the WebView2 profile takes `localStorage` with it, so `BOOTSTRAPPED_KEY` is unset, `doBootstrapDefaultLore()` re-adds `{ id: 'default' }`, and `plannedRecovery`'s id set-difference filters `default.lore` out as "already known". The single-world user — the default install — is never offered their data back. Note the asymmetry: a *partial* wipe (IndexedDB gone, `localStorage` intact) recovers correctly; the *complete* wipe fails silently.

- [ ] **Step 1: Make bootstrap recovery-aware.** `bootstrapDefaultLore()` must not seed a default world when the registry is empty **and** the on-disk index names recoverable worlds — that combination means "this install lost its store", not "first run". Leave every other path unchanged: in the browser `readRegistryMirror()` returns `null`, so behaviour there is identical to today.

Keep the existing in-flight promise guard (the App start effect double-invokes under StrictMode) and the `BOOTSTRAPPED_KEY` semantics for the genuine first run.

- [ ] **Step 2: Close the startup race.** The reviewer noted `doBootstrapDefaultLore` and the startup `syncRegistryMirror` effect race on a fresh install. With bootstrap now *reading* the index, ordering matters for correctness, not just tidiness: the reconciliation must not run until bootstrap has decided. Sequence them explicitly rather than relying on effect ordering.

- [ ] **Step 3: Tests.** The eviction case end to end: empty registry + `lore-bootstrapped` absent + an index naming `default` with a real `mirroredAt` ⇒ no default world is seeded **and** `default` is offered for recovery. Plus the genuine first run (no index) still seeds exactly as before, and the browser path is unchanged.

- [ ] **Step 4: Prove by mutation.** Remove the recovery-aware guard, confirm the eviction test fails, revert. Report both runs.

- [ ] **Step 5:** Full gate, commit.

---

## Task 3: Mirror-write correctness (I1, I2, I3)

**Files:** Modify `src/worldMirrorSync.ts`, `src/backup.ts` (or a new module) · Tests alongside

- [ ] **Step 1: I1 — use the bound world, not the live one.** `write()` calls `currentLoreId()`, a live `localStorage` read, but `exportAll()` reads the db bound to `activeLoreId` at module load. `deleteLore` on the active world does `Dexie.delete(...)` → `localStorage.removeItem(...)` → **then** reloads; a poll landing in that window exports the deleted (empty) DB and commits it over `default.lore`, destroying a good mirror with an empty payload. Use `activeLoreId` (already exported from `./db` and imported by `App.tsx`). Add a test pinning that the mirror targets the bound world even when `currentLoreId()` has moved.

- [ ] **Step 2: I2 — widen change detection.** `latestChangeTime()` sees 6 of the 15 tables `exportAll()` writes; `pins`, `regions`, `templates`, `docLinks`, `books`, `chapters`, `plotlines`, `beats` and `meta` are invisible, and `maps` is keyed on `createdAt` so *editing* a map never advances it. A pin-only, plotline-only or settings-only session produces no mirror write and no close flush.

Add a mirror-specific change probe (do **not** change `latestChangeTime`, which `BackupBanner` and `backupOnExit` depend on — note that blind spot as a follow-up instead). Investigate which tables carry an `updatedAt` index; combine indexed timestamp reads where available with `count()` elsewhere, so adds and deletes register even on tables without timestamps. Keep it cheap — it runs every 30s. Document honestly in the code what it can and cannot detect.

- [ ] **Step 3: I2 safety net — make the close flush unconditional.** Whatever the probe misses, closing the window must still capture the session. `flushWorldMirror` currently early-returns when `lastChangeAt <= lastMirrorAt`; on close, write if the world has any content at all. Correct the CLAUDE.md sentence claiming `latestChangeTime()` "sees every table" — it does not, and that false claim is now enshrined in the repo's primary orientation doc.

- [ ] **Step 4: I3 — re-check suspension after the export.** `maybeMirrorWorld` checks `suspendDepth` once at entry, then awaits the probe and `exportAll()` (seconds on a large world) before writing. A poll that began before the user confirmed an import sails straight through the guard. Worse, `exportAll()` is 15 independent `toArray()` calls rather than one transaction, so it can itself straddle `importAll`'s `clear()`/`bulkAdd`. Re-check `suspendDepth` in `write()` after `exportAll()` and immediately before `writeWorldMirror`, and have `withMirroringSuspended` await any `inFlight` write before running its callback. Add a test where suspension begins *during* the export.

- [ ] **Step 5: Prove each by mutation** (revert each fix, watch its test fail, restore). Report every run.

- [ ] **Step 6:** Full gate, commit.

---

## Task 4: Make the mirror observable, and flush it first (I4, I5)

**Files:** Modify `src/worldMirrorSync.ts`, `src/routes/SettingsRoute.tsx`, `src/App.tsx`, `src/index.css` · Tests alongside

- [ ] **Step 1: I5 — flush the mirror before `backupOnExit`.** Both do a full `exportAll()` of a world that may be tens of MB, sequentially, inside one 5s budget — and the mirror, which runs second, is the one that gets cut. The mechanism with first claim is the weaker one: `backupOnExit`'s write is non-atomic and truncatable by its own comment, while the mirror is atomic and is the actual durability net. Reorder so the mirror flushes first. Keep both inside the timeout race.

- [ ] **Step 2: I4 — record mirror health.** `startMirrorLoop` does `void maybeMirrorWorld()`; a rejected write becomes an unhandled rejection, and `installStorageErrorListener` only recognises quota and dropped-write shapes — a Tauri fs error (permission, disk full, forbidden path) matches neither and is dropped silently. Combined with `syncRegistryMirror` and `trashWorldMirror` swallowing everything, **a mirror that has never once succeeded is indistinguishable from one working perfectly** until recovery day.

Track last successful mirror time and last error in `worldMirrorSync`, expose them through a small accessor, and make the loop capture rejections rather than dropping them.

- [ ] **Step 3: Surface it in Settings.** A "World file" line in the desktop-only area: where the file lives, when it was last written (`timeAgo`), and the last error if any, styled as a problem (`--danger`) rather than buried. This is not polish — for a feature whose only job is trustworthiness after everything else has failed, one honest status readout is load-bearing.

- [ ] **Step 4: Tests** for the ordering change, for an error being recorded rather than swallowed, and for the Settings line rendering both the healthy and failed states.

- [ ] **Step 5:** Full gate, commit.

---

## Deferred to follow-up issues (agreed, not forgotten)

- **M4** Restore mints a new UUID, so the original `.lore` is orphaned forever — `worlds/` and `worlds/trash/` grow unbounded in multi-MB units with no pruning path that avoids `read-dir`.
- **M5** Banners live in the registry DB, outside `exportAll()`'s payload, so a restored world silently loses its banner.
- **M6** The capability description overstates its precision: `fs:allow-appdata-write-recursive` bundles `write-all`, which already permitted `rename` on `$APPDATA`. Correct the CLAUDE.md wording.
- **M7** `assertSafeLoreId` throws in the browser instead of honouring the seam's `false`/`null` contract.
- **M2/M3** No unsafe-id test for `trashWorldMirror`; its blanket `catch` stays until Task 4 gives errors somewhere to go.
- `latestChangeTime()`'s blind spot affects `BackupBanner` and `backupOnExit` too — the backup reminder under-reports for the same nine tables.

## Still required before merge

`docs/world-mirror-manual-verification.md` must actually be run. Checks **8** (evict and recover) and **9** (upgrade path) are the ones that would have caught C1, C2 and C3 in ten minutes.
