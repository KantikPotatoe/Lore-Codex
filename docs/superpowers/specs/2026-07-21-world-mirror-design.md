# Per-world `.lore` mirror on disk — design

Issue: [#174](https://github.com/KantikPotatoe/Lore-Codex/issues/174) · Date: 2026-07-21

Desktop transition **Phase 2** (`docs/desktop-transition-investigation.md` §5.3, §9).

## Problem

Every world lives only in IndexedDB inside the WebView2 profile. That store is
browser-managed, invisible to the user, and evictable. The only durable copy
today is one the user must remember to make: a manual "Back up now" download,
plus `backupOnExit()`'s weekday-rotating copy in `$APPDATA/backups` if the
desktop shell is closed cleanly.

So the failure that loses years of irreplaceable work — profile wiped, webview
runtime reset, storage evicted under pressure — is survivable only by a user
who was already diligent. Every other feature in the backlog is an improvement;
this one is the difference between the app being trustworthy and not.

## Decision

Each world auto-mirrors to `<app-data>/worlds/<loreId>.lore`, written
atomically on a lazy cadence and flushed on window close. On a launch that
finds an empty registry, the lore selector offers to restore the worlds it
finds named in `registry.json`.

The mirror is a **safety net first** — it lives in `$APPDATA` and the user need
never think about it — with the file layout deliberately shaped so that
exposing the folder (reveal-in-explorer, relocation to a synced directory)
is a later additive step rather than a redesign.

Shell-only. Every new seam function returns `false`/`null` in the browser, where
no filesystem exists to mirror to; the web build's behaviour is unchanged.

## The file is a backup, not a new format

`.lore` content is **exactly the `exportAll()` JSON payload**, byte for byte.

This is the load-bearing decision of the whole design. Because the payload is
already a backup:

- `parseBackup()` validates and restores it with no new import machinery, and
  its `MIGRATIONS` ladder means a mirror written by any past version still
  opens.
- The existing `importLoreFromBackup(name, json)` path — built for the Phase 1
  migration wizard — *is* the recovery path.
- A user can rename `.lore` → `.json` and import it into the web build, or into
  another machine's copy. The file is not a lock-in artifact.

Inventing a mirror-specific container would have bought nothing and cost a
second format to version, validate, sanitize, and migrate forever.

### Payload includes images

`exportAll()` inlines gallery images, map images, and banners as data URLs, so
a mirror write may be tens of megabytes. The text-only `exportSnapshot()`
(#183) was considered and rejected: restoring from it would silently return a
world with every map and image gone, which is not a safety net for a visual
worldbuilding app. Write cost is managed by the cadence instead (below), not by
making the restore lossy.

## File layout

```
<app-data>/
  worlds/
    registry.json        # [{ id, name, banner?, mirroredAt, appVersion }]
    <loreId>.lore        # the exportAll() payload, verbatim
    trash/
      <loreId>-<stamp>.lore
  backups/               # unchanged: exit-<Weekday>.json, pre-import copies
```

Each `registry.json` entry carries `mirroredAt` and `appVersion` so the restore
panel can say *how fresh* each recoverable world is — "last mirrored 2 hours
ago" is the difference between a confident click and a nervous one. They are
displayed, not merely recorded.

`registry.json` naming the world files is what lets recovery work with **one
read of a known path instead of a directory listing**. That keeps the shell out
of `fs:allow-read-dir`, a permission this codebase has deliberately avoided —
`backupOnExit()`'s weekday-slot filename scheme exists precisely so pruning
never needs to enumerate a directory.

A deleted world's mirror is **moved to `trash/`, never unlinked**. Cheap
insurance the browser could never offer, and `trash/` is not consulted by
recovery, so a deletion stays deleted.

## Components

### `src/platform.ts` — seam additions

Still the only module permitted to import `@tauri-apps/*`. All of these resolve
`false`/`null` in the browser:

| Function | Behaviour |
|---|---|
| `writeWorldMirror(loreId, json)` | Write `<loreId>.lore.tmp`, then rename over `<loreId>.lore` |
| `readWorldMirror(loreId)` | Read a named world file, `null` if absent |
| `writeRegistryMirror(json)` / `readRegistryMirror()` | Same for `registry.json` |
| `trashWorldMirror(loreId)` | Rename into `trash/<loreId>-<stamp>.lore` |

The write is **temp-then-rename** so a crash, a full disk, or a kill mid-write
can never leave a truncated file where a good mirror used to be. The rename is
the commit point.

One thing to verify early in implementation: renaming *over an existing file*
must actually succeed. Rust's `std::fs::rename` replaces the destination on
Windows, so this should hold through `plugin-fs` — but if it does not, the
fallback needs `fs:allow-remove`, which would widen the permission set. Confirm
before building on the assumption.

`loreId` reaches the filesystem as a filename, so it is validated against a
conservative pattern (`[A-Za-z0-9_-]+`) at the seam and rejected otherwise —
ids come from `uid()` or the literal `'default'` today, but a value that
reaches `writeTextFile` is not the place to assume that holds.

Permission delta to confirm during implementation: `fs:allow-rename` plus
`$APPDATA` read, added to `src-tauri/capabilities/default.json`. No
`fs:allow-read-dir`, no `fs:allow-remove`, no new Rust dependencies.

Granting `fs:allow-rename` incidentally settles a known issue recorded in
`App.tsx`'s close-handler comment: `backupOnExit()` can currently be truncated
by the 5s timeout racing `win.destroy()`, and the comment explains that the
temp-then-rename fix was refused because it needed exactly this permission for
a secondary safety net. Once the permission exists for the mirror, moving
`writeAppData` to the same atomic idiom becomes a small follow-up — noted here,
not done in this issue.

### `src/worldMirror.ts` — cadence (new)

The policy is a **pure function**, in the shape `updater.ts`'s `shouldCheck`
and `backup.ts`'s `shouldBackupOnExit` already established:

```ts
shouldMirror({ lastChangeAt, lastMirrorAt, now, quietMs, floorMs }): boolean
```

True when there is a change newer than the last mirror, the last change is at
least `quietMs` old (an idle window, so writes land between editing bursts
rather than during them), and at least `floorMs` has passed since the last
write (so a long editing session cannot rewrite tens of megabytes every half
minute). Defaults: ~30s quiet, ~5min floor — tunable constants, not settings;
there is no user-facing knob for this.

Guard the same non-finite/clock-rollback cases `shouldCheck` learned to guard:
a `NaN` or future timestamp must count as due, never as "wait forever".

**There is no dirty flag.** `lastChangeAt` comes from `latestChangeTime()`
(`backup.ts`), which already reads a boundary row per table through its sort
index — six cheap reads covering pages, maps, events, calendars, images and
scenes. A single interval in the shell re-evaluates the policy; that catches
map-only, timeline-only and manuscript-only sessions, which a flag hung off
`maybeTakeSnapshot()`'s call sites would silently miss (it fires only on page
saves, from `PageRoute`). The absence of per-call-site instrumentation is the
point: no future edit path can forget to mark the world dirty.

`lastMirrorAt` is module state, not persisted. A fresh launch therefore mirrors
once shortly after start if anything changed since the file was written — which
is the desired behaviour, not a cost worth engineering away.

The impure wrapper keeps `maybeTakeSnapshot()`'s in-flight promise that
coalesces overlapping calls. A flush is wired into the existing
`onCloseRequested` handler alongside `backupOnExit()`, inside the same 5s
timeout race so a slow mirror write cannot wedge the window shut; the flush
ignores the quiet and floor windows, since there is no later opportunity.

Every world write also refreshes `registry.json`, so the two never disagree
about which worlds exist.

### `src/worldRecovery.ts` — recovery (new)

Pure:

```ts
plannedRecovery(diskRegistry, knownLores): RecoverableWorld[]
```

— the worlds named on disk that the registry DB does not know about.

`LoreSelectorRoute` renders a panel only when that list is non-empty:
*"3 worlds found on disk — Restore"*. Confirming runs each file through
`parseBackup` → `importLoreFromBackup(name, json)`, the path the Phase 1
migration wizard already uses. **Nothing is written without a click** — a
silent auto-restore would have the app commit a large, irreversible write on a
guess, and could resurrect a world the user deliberately deleted.

## What deliberately does not change

**`BackupBanner` stays exactly as it is.** The investigation doc floated
retiring or repurposing it once a mirror exists; that would be wrong. The
mirror lives in `$APPDATA` — it has not left the machine, and it dies with the
disk it sits on. Stamping `LAST_BACKUP_KEY` or silencing the reminder would
tell the user their data is safe off-device when it is not. This is the same
reasoning already written into `backupOnExit()`, which pointedly does not stamp
that key either; the two should stay consistent.

**`backupOnExit()` stays.** Its weekday rotation is a week of *history*; the
mirror is *currency*. A bad edit propagated into the mirror is recoverable from
a weekday slot; an evicted profile is recoverable from the mirror. They cover
different failures and are not redundant.

**The data layer is untouched.** Dexie, the ~77 `useLiveQuery` sites, and the
repository seam see no change. The mirror reads through `exportAll()` like any
other backup consumer.

## The mid-import hazard

`importAll()` is `clear()` followed by `bulkAdd`. A mirror write that lands
between those two would capture a half-empty world and rename it over a
perfectly good mirror — turning the durability feature into a data-loss
mechanism at the exact moment the user is restoring.

`restoreSnapshot()` (Settings' snapshot-restore branch) carries the identical
clear-and-repopulate shape — `restoreSnapshotInto()` clears ten of the active
DB's tables and bulk-adds into them — and is wrapped for the same reason. A
mirror write landing mid-restore is exactly as destructive as one landing
mid-import; the two call sites are treated symmetrically rather than only
naming `importAll`.

Mirroring is therefore **suppressed for the duration of any import or
snapshot restore**, via an explicit guard in `worldMirror.ts` that
`importAll`/`importBackupInto` and `restoreSnapshot` raise and lower. This
gets a dedicated test: a mirror write attempted mid-import (or mid-restore)
must be dropped, not queued and flushed afterwards against the intermediate
state.

**Correction (#174 task 3, I-B):** this section originally claimed the lore
selector's `importLoreFromBackup` needed no such guard, on the premise that it
always imports into a *newly registered, not-yet-active* world's DB, never the
active one. Id reuse on the recovery path (`restoreWorld` passing the disk
entry's own id, so a recovered world keeps its identity instead of being
re-registered under a fresh uuid) invalidated that premise: restoring a world
whose id matches the currently-bound `db` — e.g. `'default'` after an eviction
that also reset `currentLoreId()` back to `'default'` — targets the *active*
database. `importBackupInto` is the same clear()-then-bulkAdd transaction
described above, so a mirror write landing mid-restore is exactly the hazard
this section exists to prevent. `restoreWorld` now wraps its call to
`importLoreFromBackup` in `withMirroringSuspended`, the same guard
`SettingsRoute`'s import/restore-snapshot branches use. A stale safety
rationale is worse than none — this correction is left in place next to the
original claim, rather than silently editing it away, so a future reader who
remembers the old claim finds the correction instead of nothing.

## Active world only

`db` binds to `dbNameFor(currentLoreId())` at module load, so a running app can
read only the world currently open. "Auto-mirrored per-world" therefore means
precisely: **the active world's mirror is kept fresh; the others are as fresh
as you last left them.** That is sufficient — a world you are not in is a world
you are not editing — but it is a property worth stating rather than
discovering.

**Correction (#174 task r3):** this section originally claimed "the close
flush runs before that reload, so switching worlds leaves a current mirror
behind." That is false, and was never true. `switchLore()` calls
`window.location.reload()` directly — a client-side navigation, not a window
close — and does not call `flushWorldMirror()` anywhere in its path. Tauri's
`CloseRequested` event, which is what actually triggers the close flush in
`App.tsx`, does not fire on a same-window reload. So a world switched away
from mid-quiet-window (before the poll's floor/quiet timers next allow a
write) leaves its mirror exactly as stale as it was at the last successful
poll — not "current". This is a known gap, not a designed guarantee; see the
Deferred list in `2026-07-22-world-mirror-fixes-2.md` ("`switchLore` does not
flush, so a world visited for under one poll interval is never mirrored on
that visit").

## Testing

| Area | Test |
|---|---|
| `shouldMirror` | Table of `{lastChangeAt, lastMirrorAt, now}` → expected, including `NaN`/future timestamps |
| `plannedRecovery` | Disk/registry set differences; trashed worlds never offered |
| Seam | Mocked `@tauri-apps/plugin-fs`: asserts `.tmp` write *precedes* rename; browser returns `false` |
| `loreId` validation | Traversal-shaped and empty ids rejected before reaching the fs |
| Mid-import guard | Write attempted while the guard is raised is dropped, not deferred |
| Recovery UI | `LoreSelectorRoute` with a stubbed disk registry: panel appears, restore calls the import path, absent registry renders nothing |

No changes to the fake-indexeddb foundation; no new test environment.

## Exit criterion

An unclean loss (crash, power cut, force-kill) costs **the floor window plus
the length of the current unbroken editing burst**, and the second term is
unbounded.

`MIRROR_FLOOR_MS` (5 min) is the minimum gap between writes, and
`MIRROR_QUIET_MS` (30s) of quiet must elapse before a write is attempted at
all. That quiet window is the sharp edge: `shouldMirror` returns false while
`now - lastChangeAt < MIRROR_QUIET_MS`, and `PageRoute` writes content after
500ms, so an author typing steadily slides `lastChangeAt` forward on every
poll and **no mirror write fires for the whole session**. Forty-five minutes
of unbroken drafting, then a power cut, loses forty-five minutes — not 5.5.

This section has now understated the bound twice: first as "one quiet-window"
(~30s), then as "roughly 5.5 minutes". Both assumed a bursty editor who pauses.

`flushWorldMirror` on a clean close is what actually bounds a long session, and
it is unconditional for that reason. A *clean* quit therefore loses nothing.
The next launch offers every mirrored world back from disk regardless.

Closing the gap for unclean losses would mean a hard ceiling — force a write
when `lastMirrorAt` is old enough, regardless of quiet — which is deliberately
**not** done here: it is new cadence logic, and this feature has twice shipped
a Critical introduced by a late fix. Tracked as a follow-up instead.

## Out of scope

- Assets as separate files (Phase 3a, #118's real blocker)
- Records to SQLite (Phase 3b)
- Relocating the worlds folder to a user-chosen or synced directory — the
  layout supports it; the UI for it is a later increment
- Snapshots to disk
