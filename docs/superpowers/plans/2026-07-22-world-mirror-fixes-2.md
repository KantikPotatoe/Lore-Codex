# World Mirror — Fix Round 2 (#174)

> Second addendum. The first fix round (`9fd88f7..5a88e82`) killed Criticals C1-C3
> but **introduced a new Critical**. The whole-branch review returned do-not-merge
> a second time. Seven required items, plus the testing-shape gap that let both
> rounds through.

## The testing gap — read this before writing any test

Every existing mirror test mocks `./db` wholesale with hand-supplied counts. So **no test ever exercises the mirror against a real, freshly-seeded, empty world** — which is exactly the state the new Critical lives in. Both do-not-merge rounds were caused by logic that was correct against its fixtures and wrong against reality.

Tests for this round must construct real state with `fake-indexeddb` (already the project's test foundation) — seed a genuine empty `LoreDB`, run `seedTemplates`/`seedDefaultCalendar` against it, and drive the real mirror path. A test that asserts on a mock cannot catch this class of bug, and adding more of them is worse than useless because it looks like coverage.

## Global Constraints

- `@tauri-apps/*` only in `src/platform.ts`. Dexie `db` singleton only in `src/db/**` plus the `eslint.config.js` infra allowlist. **Never** `'no-restricted-imports': 'off'`.
- Do not change `latestChangeTime()`, `BackupBanner`, `backupOnExit`, or `LAST_BACKUP_KEY` stamping.
- `src/index.css` is px, not rem (`cssUnits.test.ts`). Existing tokens only.
- TypeScript `strict`; `setState`-in-effect is a lint error.
- `npm run lint && npm run build && npm run test:run` must pass.
- Every behavioural fix proved by mutation: break it, watch its test fail, restore, leave `git status --short` clean.

---

## Task 1 — CRITICAL: never mirror a world the registry doesn't know

**Files:** `src/worldMirrorSync.ts`, plus a new real-DB test file.

**The failure, exactly.** Single-world default install, desktop shell. Storage is evicted, taking `localStorage`. On relaunch `activeLoreId` is `'default'` and `db` binds to the empty `lore-app`. `App.tsx` seeds templates and a default calendar into it — the calendar's `createdAt` and the templates' count both register as change. The mirror loop starts unconditionally, including while the user is sitting on the selector route reading the recovery panel. At the first poll past the quiet window (`lastMirrorAt` is 0, so the 5-minute floor is trivially satisfied), or immediately on close now that the flush is unconditional, `writeWorldMirror('default', <seeded-empty export>)` renames over `worlds/default.lore`. `stampRegistryMirrored` then refreshes the entry's `mirroredAt`.

The panel reads the index once at mount and never refreshes, so it keeps advertising the pre-clobber timestamp. Restore then succeeds and returns an empty world. **A durability feature reporting success while handing back nothing is strictly worse than no feature.**

- [ ] **Step 1: Write the real-DB failing test first.** Using `fake-indexeddb`, construct the actual post-eviction state: an empty `LoreDB` for `'default'`, an empty registry, `seedTemplates()` and `seedDefaultCalendar()` applied. Drive `maybeMirrorWorld()` and `flushWorldMirror()`. Assert `writeWorldMirror` is **not** called for either. Do not mock `./db`.

- [ ] **Step 2: Confirm it fails** against current `main`-of-branch code — it must, on both paths. If it passes, the test is not reproducing the Critical; say so and stop.

- [ ] **Step 3: Implement the guard.** In `write()`, refuse when `activeLoreId` is absent from the registry DB. The invariant is *the mirror only ever writes for a world the app knows it has*, and it closes the poll path and the close path together. Prefer this over route-level suppression: it states the precondition rather than patching one caller.

- [ ] **Step 4:** Confirm the test passes; mutate the guard away and confirm it fails again. Full gate, commit.

---

## Task 2 — Index integrity: unreadable ≠ absent, serialize the writers, version the file

**Files:** `src/platform.ts`, `src/lores.ts`, `src/worldIndex.ts`, `src/worldRecovery.ts`, `src/worldMirrorSync.ts`, tests.

- [ ] **Step 1 (C1 residual, Important): distinguish "unreadable" from "absent".** `readRegistryMirror()` collapses every failure to `null` — missing file, permission denied, Windows sharing violation, IO error — and `syncRegistryMirror` then treats a failed read as "disk is empty" and writes the union of nothing with nothing. That is byte-identical damage to the original C1, via a different trigger, and it is reachable on exactly the machine that just evicted its storage. Make the seam report the difference, and make `syncRegistryMirror` **refuse to write** when the read failed. A shrinking write must never follow a read error.

- [ ] **Step 2 (I-C, Important): serialize the three `registry.json` writers.** `syncRegistryMirror`, `dropFromRegistryMirror` and `stampRegistryMirrored` are independent read-modify-write sequences with awaits between read and write, and `atomicAppDataWrite` gives all three the **same** `registry.json.tmp` path. Two failure modes: a lost update (a delete's drop undone by an in-flight stamp, permanently resurrecting an entry whose file is in `trash/`), and two overlapping `writeTextFile` calls to the shared tmp path whose first `rename` then commits partial bytes — defeating the atomicity the entire design rests on. All three swallow their own errors, so both are silent. Serialize them through a single in-module promise chain; a unique tmp path per write is a reasonable belt-and-braces addition.

- [ ] **Step 3 (format, Important — must land before any release): version `registry.json`.** It is currently a bare array with no envelope. `parseDiskRegistry` returns `[]` for anything that is not an array, so a future `{version, worlds}` shape would be read as empty by an older build and then **overwritten** — and the auto-updater makes downgrade a live scenario. Add the envelope now, while nothing is shipped. `parseDiskRegistry` must accept both the bare array (anything already written during development) and the envelope, and must return "unreadable" rather than "empty" for a *newer* version it does not understand — the same distinction as Step 1.

- [ ] **Step 4:** Mutation-prove each of the three. Full gate, commit.

---

## Task 3 — The restore path

**Files:** `src/lores.ts`, `src/routes/LoreSelectorRoute.tsx`, `src/App.tsx`, `docs/superpowers/specs/2026-07-21-world-mirror-design.md`, tests.

- [ ] **Step 1 (I-A, Important): a failed restore must not delete the pointer to a surviving file.** `importLoreFromBackup`'s rollback calls `dropFromRegistryMirror(id)`. That was written for the case where `registerLore` *created* the entry — but on the recovery path the entry pre-existed and points at a real, good `.lore`. So an import that throws (`QuotaExceededError` is exactly what a just-evicted machine is prone to) leaves the file on disk with nothing able to find it again. Drop only when this call created the entry; otherwise leave it, or capture and restore it.

- [ ] **Step 2 (I-B, Important): suspend mirroring across a restore, and fix the spec.** Id reuse changed the premise: restoring `'default'` now targets `lore-app`, which **is** the active database, and `importBackupInto` is a clear-then-bulkAdd transaction. `withMirroringSuspended` is currently used only in `SettingsRoute`. Wrap `restoreWorld`'s import.

  Then correct `docs/superpowers/specs/2026-07-21-world-mirror-design.md` — its "mid-import hazard" section still asserts the selector's import "needs no such guard: it imports into a newly registered, not-yet-active world's DB, never the active one." That is now false, and a stale safety rationale is worse than none.

- [ ] **Step 3 (I-E, Important): a failed mirror must not disable the exit backup.** The close handler now awaits `flushWorldMirror()` first, unguarded. `write()` rethrows after recording health; `onCloseRequested` swallows it so the window still closes — but `getAppSettings`/`shouldBackupOnExit`/`backupOnExit` below never run. A persistent disk-full or permission failure takes out **both** safety nets while Settings reports only one. Catch it, and keep the mirror first.

- [ ] **Step 4:** Mutation-prove each. Full gate, commit.

---

## Deferred (agreed)

- **I-D** Nothing can remove a disk-only entry whose file is gone, so it is offered forever with a Restore that always fails. Minimum future fix: drop the entry when `readWorldMirror` returns `null` or `parseBackup` throws.
- Probe cost: 6 indexed reads + 9 `count()` calls every 30s, including idle and on the selector route. Consider skipping when `document.hidden`.
- `switchLore` does not flush, so a world visited for under one poll interval is never mirrored on that visit.
- The recovery panel is not live — `diskWorlds` is read once at mount.
- `latestChangeTime()`'s blind spot still under-reports for `BackupBanner`/`backupOnExit`.
- Restored worlds lose their banner (it lives in the registry DB, outside `exportAll()`).

## Still required before merge

`docs/world-mirror-manual-verification.md` must be run. Checks 8 and 9 would have caught both do-not-merge rounds in minutes.
