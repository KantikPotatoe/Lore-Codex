# Mirror staleness ceiling — design

Issue: [#233](https://github.com/KantikPotatoe/Lore-Codex/issues/233) · Date: 2026-07-22

Follow-up to [#174](https://github.com/KantikPotatoe/Lore-Codex/issues/174)
(`docs/superpowers/specs/2026-07-21-world-mirror-design.md`), closing the gap
that spec's "Exit criterion" section documents as knowingly left open.

## Problem

`shouldMirror` (`src/worldMirror.ts`) returns false while
`now - lastChangeAt < MIRROR_QUIET_MS` (30s). The quiet window exists so a
mirror write lands *between* editing bursts rather than inside one — a full
`exportAll()` inlines every image as a data URL and can run to tens of
megabytes.

But `PageRoute` commits content after `CONTENT_WRITE_DELAY_MS` (500ms). An
author typing steadily slides `lastChangeAt` forward faster than the 30-second
quiet window can ever elapse, so **no mirror write fires for the entire
session**.

- **Clean quit costs nothing.** `flushWorldMirror` is unconditional on window
  close, which is the only thing bounding a long session today.
- **An unclean loss** (crash, power cut, force-kill, OS update reboot) costs
  the whole burst. Forty-five minutes of unbroken drafting loses forty-five
  minutes.

The person most exposed is the one doing the most valuable thing with the app:
writing continuously for a long stretch.

## Decision

A hard staleness ceiling in `shouldMirror`: once changes have gone unmirrored
for `MIRROR_MAX_STALE_MS` (**10 minutes**), force a write **regardless of the
quiet window**. The interval floor still applies, so the ceiling cannot cause
thrash.

Worst-case unclean loss becomes `MIRROR_MAX_STALE_MS` plus one poll interval —
**~10.5 minutes**, bounded, instead of "the length of the current unbroken
editing burst", unbounded.

10 minutes rather than the 15 the issue floats as the upper end: `MIRROR_FLOOR_MS`
already permits a write every 5 minutes during bursty editing, so a forced
write every 10 asks nothing of the system it does not already do on a normal
day, and halves the exposure.

### The anchor problem

The issue proposes the ceiling as `now - lastMirrorAt >= MIRROR_MAX_STALE_MS`.
Taken literally that is wrong, and the failure is on every launch rather than
in a corner.

`lastMirrorAt` is module state in `worldMirrorSync.ts`, initialised to `0` and
deliberately **not persisted** — a fresh page-life starts at zero by design. So
`now - lastMirrorAt` is the full Unix epoch on the first evaluation of every
session, the ceiling is unconditionally true, and the first poll 30 seconds
after launch forces a multi-megabyte export mid-burst. That is precisely the
behaviour the quiet window exists to prevent, promoted from "possible" to
"every single launch".

The ceiling therefore anchors on a session start time when nothing has been
written yet this page-life:

```ts
const staleSince = lastMirrorAt > 0 ? lastMirrorAt : sessionStartAt
```

The first forced write of a session lands ~10 minutes in, not 30 seconds in.
After any real write, `lastMirrorAt` takes over and the anchor is never
consulted again.

Two alternatives were considered and rejected:

- **Apply the ceiling only when `lastMirrorAt > 0`.** Simplest possible change,
  no new parameter — and it does not fix the reported bug. A user who launches
  and types continuously never gets a first write, so `lastMirrorAt` stays `0`,
  so the ceiling never engages. This is the exact scenario in #233.
- **Track the oldest unmirrored change.** Semantically the tightest — it
  measures the actual age of work at risk — but it adds mutable state to the
  module whose state bugs produced two Criticals during #174, to buy precision
  in a case that barely exists: a world with pending changes and no write yet
  this session gets mirrored on the first poll anyway (settled change, floor
  vacuously passed), which resets the anchor to `lastMirrorAt`.

## Design

### `src/worldMirror.ts` — pure

New exported constant:

```ts
export const MIRROR_MAX_STALE_MS = 10 * 60_000
```

`shouldMirror` gains two optional args, `sessionStartAt` and `maxStaleMs`.
`sessionStartAt` defaults to `now`, which makes the **anchor path** inert when a
caller omits it: `now - now = 0`, never `>= maxStaleMs`. That inertness holds
only before the first write of a page-life — `staleSince` falls back to
`sessionStartAt` solely while `lastMirrorAt === 0`; once a write has landed
this session, `staleSince` reads `lastMirrorAt` directly and the ceiling
engages whether or not `sessionStartAt` was supplied. So omitting the anchor
can only degrade to today's behaviour *before that first write*, never cause a
spurious mid-burst write in that window. Given this module's history, the safe
direction is the default.

Guard order, and why each position is load-bearing:

1. `lastChangeAt === 0` → `false` stays **first**. A world that has never
   changed stays silent no matter how old the session is.
2. The non-finite and future-timestamp guards gain `sessionStartAt`, so a
   corrupt or rolled-back clock fails toward writing — the principle already
   written into this function and into `updater.ts`'s `shouldCheck`.
3. `lastChangeAt <= lastMirrorAt` → `false` stays **before** the ceiling.
   Nothing changed since the last mirror means there is nothing to write; the
   ceiling must not manufacture a redundant multi-megabyte export of a world
   that is already current on disk.
4. Then the ceiling:

```ts
const staleSince = lastMirrorAt > 0 ? lastMirrorAt : sessionStartAt
const stale = now - staleSince >= maxStaleMs

if (!stale && now - lastChangeAt < quietMs) return false // still editing
return now - lastMirrorAt >= floorMs
```

The ceiling overrides **the quiet window only**. The floor is still evaluated
on every path, so no invariant between `MIRROR_MAX_STALE_MS` and
`MIRROR_FLOOR_MS` has to hold for the code to be safe. `10 >= 5` is a tuning
choice, not a correctness dependency — which matters because a future tuning
change to either constant must not be able to reintroduce thrash silently.

### `src/worldMirrorSync.ts` — state

One new module variable beside `lastMirrorAt`, lazy-stamped on the first policy
evaluation of the page-life:

```ts
let sessionStartAt = 0

export async function maybeMirrorWorld(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  if (sessionStartAt === 0) sessionStartAt = now
  const lastChangeAt = await mirrorChangeTime(now)
  if (!shouldMirror({ lastChangeAt, lastMirrorAt, now, sessionStartAt })) return
  return run(now)
}
```

Stamped inside `maybeMirrorWorld` rather than at module load: module-load
`Date.now()` is an import side effect, and lazy stamping keeps the value
resettable between test cases.

`flushWorldMirror` does **not** stamp it — flush bypasses the cadence policy
entirely, so it has no anchor to establish.

`resetWorldMirrorStateForTests()` resets it to `0`. This is not optional
bookkeeping: the real-DB harness resets between every case, and a leaked
`sessionStartAt` from a previous case would make the ceiling fire or not fire
based on test ordering.

## Testing

Per the note #233 carries forward from the #174 postmortem: prove this against
the **real-DB harness** (`src/worldMirrorSync.realdb.test.ts`, which mocks only
`platform.ts`), not the mocked suite. On that branch, reverting the
suspension-epoch guard still passed every mocked test — the fixtures could not
represent the failure.

**`src/worldMirror.test.ts`** — extend the existing policy table:

- the ceiling forces a write through an unsettled `lastChangeAt`
- the ceiling anchors on `sessionStartAt` when `lastMirrorAt === 0`
- the ceiling does **not** override "already mirrored"
- the ceiling does **not** override the floor
- omitting `sessionStartAt` leaves today's behaviour unchanged

**`src/worldMirrorSync.realdb.test.ts`** — the regression test that reproduces
#233 against a real seeded world: with change continuously sliding forward past
every poll (as a 500ms `CONTENT_WRITE_DELAY_MS` typist produces), assert
**zero** `writeWorldMirror` calls before the ceiling elapses and exactly one
after. The zero-before assertion is what makes it a regression test rather than
an assertion that writes happen eventually.

## Documentation

Three places currently describe this gap as open and must be corrected in the
same change:

- `CLAUDE.md`, world-mirror section — "a steady typist slides `lastChangeAt`
  forward on every poll and gets **no write at all** for the whole session
  (#233)".
- `docs/superpowers/specs/2026-07-21-world-mirror-design.md` § "Exit criterion"
  — states the bound as unbounded and explains why the ceiling was deferred.
  That section has understated the bound twice already; the correction should
  say what the bound now is and stop there.
- The `shouldMirror` doc comment.

## Out of scope

- `MIRROR_QUIET_MS`, `MIRROR_FLOOR_MS`, `MIRROR_POLL_MS` — unchanged.
- `mirrorChangeTime`'s documented blind spots (in-place edits to the nine
  counted tables; `maps`/`calendars` edit-vs-add). `flushWorldMirror` remains
  the deliberate backstop for those.
- Persisting `lastMirrorAt` across page-lives.
- Anything touching `flushWorldMirror`'s unconditional close-time write.
