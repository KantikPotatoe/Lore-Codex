---
paths:
  - src/worldMirror*.ts
  - src/worldIndex.ts
  - src/worldRecovery.ts
---

# World mirror — `src/worldMirror.ts` + `worldMirrorSync.ts` + `worldIndex.ts` + `worldRecovery.ts`

Desktop only. Each world auto-mirrors to `<app-data>/worlds/<loreId>.lore` —
the `exportAll()` JSON **verbatim**, so `parseBackup`'s validation and
`MIGRATIONS` ladder restore it and no second format needs versioning. Written
**temp-then-rename** (`fs:allow-rename`), so a crash or the close-handler
timeout can never leave a truncated file where a good mirror was.

**Cadence.** `worldMirror.ts` is pure (`shouldMirror`: a quiet window so writes
fall between editing bursts, an interval floor so a long session doesn't
rewrite tens of MB every 30s, a **staleness ceiling** that overrides the quiet
window after 10 min, and the non-finite/future-timestamp guards `shouldCheck`
carries). The ceiling exists because the quiet window is otherwise unreachable
for a steady typist — `PageRoute` commits content after 500ms, so
`lastChangeAt` slides forward faster than 30s can elapse and no write fired for
the whole session (#233). It measures from a **session-start anchor** until the
first write of the page-life lands, not from `lastMirrorAt` alone: that starts
at 0 every page-life, so a ceiling measured from it is true on the *first* poll
of every launch and would force a multi-MB export mid-burst. The floor is
evaluated on every path including the stale one, which keeps
`MIRROR_MAX_STALE_MS >= MIRROR_FLOOR_MS` a tuning choice, not a correctness
dependency. **There is no dirty flag** — `worldMirrorSync.ts` polls
a mirror-specific `mirrorChangeTime()`, *not* `latestChangeTime()` (that sees
only 6 of the 15 tables `exportAll()` writes, and `BackupBanner`/`backupOnExit`
depend on exactly that shape, so it stays as-is). `mirrorChangeTime()` combines
those six indexed reads with a `count()` on each of the other eleven, so an add
or delete registers even with no timestamp to read. It is **not** complete: an
in-place edit to a row on those eleven is invisible between polls, and
`maps`/`calendars` notice an add but not an edit. `flushWorldMirror()` on close
is the deliberate backstop for all of it — unconditional, writing whenever the
world has any content. `lastMirrorAt` is module state, not persisted. The poll
loop (`startMirrorLoop`) is **gated on `isTauri()`**, not left to the seam's
browser no-op: a mirror attempt calls `exportAll()` *before* reaching the seam,
and the no-op never advances `lastMirrorAt`, so an ungated loop would
re-serialize the whole database every 30s for the life of a browser session and
discard it.

**The load-bearing guard: `write()` refuses when `activeLoreId` has no row in
the registry DB.** Without it, the recovery launch is a data-loss mechanism —
`App.tsx` seeds templates and a calendar into the freshly-evicted (empty) DB,
and the loop then renames *that* over the good `.lore` within 30s while the
panel still advertises the pre-clobber timestamp. Stated as a precondition in
`write()` rather than at a caller so poll and close-flush are covered together.

**Suspension is epoch-based, not just depth.** `write()` captures
`suspendEpoch` before `exportAll()` and re-checks it after, because a
suspension raised *and released* during an in-flight export would otherwise let
the stale payload commit. Attempts are dropped, never queued — a deferred write
fires against the state it was meant to avoid. Suspension wraps `importAll()`
and `restoreSnapshot()` in `SettingsRoute` (both are `clear()` + `bulkAdd` over
the active DB) **and `restoreWorld` in `LoreSelectorRoute`**: restore reuses the
world's original id, so it targets the *active* DB — the older comment claiming
the selector needs no guard was invalidated by that change.

**The index is a union, never a replace** (`worldIndex.ts`, pure:
`mergeWorldIndex`/`markWorldMirrored`/`dropWorldFromIndex`). Rebuilding
`registry.json` from the registry DB — the volatile store this feature exists
to survive — meant an eviction erased the pointers to the files that survived.
Entries leave only via an explicit drop (`deleteLore`, or a rollback that
created the entry). `mirroredAt` is stamped **only by a real write**; `null`
means no file exists, and `plannedRecovery` excludes those. The file carries a
`{version, worlds}` envelope: legacy bare arrays migrate forward, and a
*newer* version reads as unreadable so an older build can't flatten it.
`readRegistryMirror()` distinguishes **absent from unreadable**
(`fs:allow-exists`) and every writer refuses on unreadable — a shrinking write
must never follow a failed read. All three writers serialize through
`withRegistryMirrorLock`; unlocked, a drop racing a stamp resurrects a deleted
entry and two writers share one tmp path. `registry.json` existing at all is
what keeps `fs:allow-read-dir` ungranted.

**Recovery.** `bootstrapDefaultLore()` declines to seed when the registry is
empty *and* the disk index names a world with a real `mirroredAt` — that
combination means the store was lost, not a first run. Without it, a wiped
profile (which takes `localStorage`, so `lore-bootstrapped` is unset) re-seeds
`default` and `plannedRecovery` filters the single-world user out of their own
recovery. `App.tsx` chains `bootstrapDefaultLore().then(syncRegistryMirror)` so
the read precedes the write. `LoreSelectorRoute` offers matching worlds;
**nothing is written without a click**, and worlds with `mirroredAt: null` are
listed separately as lost-with-no-copy rather than hidden. Deleting a world
trashes its `.lore` to `worlds/trash/` *before* re-indexing.

**Observability is part of the feature.** Settings shows the mirror's path,
last successful write, last error, and whether the index is readable — because
a mirror that has never once succeeded is otherwise indistinguishable from one
working perfectly until recovery day.

**`BackupBanner` and `backupOnExit` both stay.** The mirror lives in `$APPDATA`
— it has not left the machine, so it must not stamp `LAST_BACKUP_KEY` or
silence the backup reminder, the same reasoning already written into
`backupOnExit`. The weekday-rotating exit backup is a week of *history*; the
mirror is *currency*. The mirror flushes **first** on close (it is atomic;
`backupOnExit`'s write is not) and its rejection is caught, so a failing mirror
can't take the exit backup down with it.

**Testing note.** Mirror logic must be proved against the real-DB harness
(`worldMirrorSync.realdb.test.ts`, which mocks only `platform.ts`). Two
Criticals reached review because every mirror test mocked `./db` wholesale and
the fixtures could not represent the failure; when the real harness was added,
19 of 28 existing tests broke — they had never seeded a registry row.
