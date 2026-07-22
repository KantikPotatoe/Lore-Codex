# Mirror Staleness Ceiling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force a world-mirror write through the quiet window once changes have gone unmirrored for 10 minutes, so an author typing continuously is still mirrored instead of never (#233).

**Architecture:** One new constant and one new optional arg on the pure `shouldMirror` policy function; one new module variable in `worldMirrorSync.ts` that anchors the ceiling at session start until the first real write lands. No change to the quiet window, the interval floor, the poll cadence, the change probe, or the close-time flush.

**Tech Stack:** TypeScript (strict), Vitest + happy-dom + fake-indexeddb, Dexie.

Spec: `docs/superpowers/specs/2026-07-22-mirror-staleness-ceiling-design.md`
Issue: [#233](https://github.com/KantikPotatoe/Lore-Codex/issues/233)

## Global Constraints

- Branch is `fix/233-mirror-staleness-ceiling`, already created off `origin/main`. Do not branch again.
- `MIRROR_MAX_STALE_MS = 10 * 60_000` — exact value, do not tune.
- `sessionStartAt` defaults to `now` so the ceiling is **inert** when omitted. Omitting the anchor must never be able to cause a write.
- The interval floor (`now - lastMirrorAt >= floorMs`) is evaluated on **every** path, including the stale path. `MIRROR_MAX_STALE_MS >= MIRROR_FLOOR_MS` must remain a tuning choice, never a correctness dependency.
- Every existing test in `src/worldMirror.test.ts`, `src/worldMirrorSync.test.ts` and `src/worldMirrorSync.realdb.test.ts` must still pass unmodified. The change is purely additive to the policy; if an existing test breaks, the implementation is wrong, not the test.
- Do not touch `MIRROR_QUIET_MS`, `MIRROR_FLOOR_MS`, `MIRROR_POLL_MS`, `mirrorChangeTime`, or `flushWorldMirror`.
- Full verification before claiming done: `npm run lint && npm run build && npm run test:run`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/worldMirror.ts` | Modify | Pure cadence policy. Gains `MIRROR_MAX_STALE_MS` and the ceiling branch in `shouldMirror`. |
| `src/worldMirror.test.ts` | Modify | Policy table. Gains a `#233` describe block. |
| `src/worldMirrorSync.ts` | Modify | Module state between policy and seam. Gains `sessionStartAt`. |
| `src/worldMirrorSync.realdb.test.ts` | Modify | Real-DB harness. Gains the #233 regression test. |
| `CLAUDE.md` | Modify | Stops describing the gap as open. |
| `docs/superpowers/specs/2026-07-21-world-mirror-design.md` | Modify | "Exit criterion" states the new bound. |

---

### Task 1: The staleness ceiling in the pure policy

**Files:**
- Modify: `src/worldMirror.ts:1-65`
- Test: `src/worldMirror.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `MIRROR_MAX_STALE_MS: number` (exported const) and the extended signature
  `shouldMirror(args: { lastChangeAt: number; lastMirrorAt: number; now: number; sessionStartAt?: number; quietMs?: number; floorMs?: number; maxStaleMs?: number }): boolean`.
  Task 2 calls it with `sessionStartAt`.

**Background the implementer needs:** `shouldMirror` decides whether the active world's `.lore` mirror should be rewritten right now. Today it refuses while the user is still editing (`now - lastChangeAt < quietMs`, 30s). Because `PageRoute` commits page content 500ms after a keystroke, a steady typist slides `lastChangeAt` forward on every 30s poll and that check never passes — so no mirror write fires for the entire session. The fix is a ceiling that overrides the quiet window (never the floor) once changes have been pending too long.

- [ ] **Step 1: Write the failing tests**

Add to `src/worldMirror.test.ts`. First extend the existing import on line 2 to pull in the new constant:

```ts
import {
  shouldMirror, isValidLoreId, MIRROR_QUIET_MS, MIRROR_FLOOR_MS, MIRROR_MAX_STALE_MS,
} from './worldMirror'
```

Then append this block after the existing `describe('shouldMirror', ...)` block and before `describe('isValidLoreId', ...)`:

```ts
// #233. The quiet window is unreachable for an author typing steadily:
// PageRoute commits content after CONTENT_WRITE_DELAY_MS (500ms), so
// lastChangeAt slides forward faster than MIRROR_QUIET_MS (30s) can elapse and
// no write ever fires. The ceiling is what bounds that.
describe('shouldMirror staleness ceiling', () => {
  // One poll tick of a steady typist: content committed 500ms ago.
  const typing = { now: NOW, lastChangeAt: NOW - 500 }

  it('forces a write through the quiet window once the ceiling elapses', () => {
    expect(shouldMirror({
      ...typing,
      lastMirrorAt: NOW - MIRROR_MAX_STALE_MS - 1,
    })).toBe(true)
  })

  it('still waits while the ceiling has not elapsed', () => {
    expect(shouldMirror({
      ...typing,
      lastMirrorAt: NOW - MIRROR_MAX_STALE_MS + 1000,
    })).toBe(false)
  })

  it('anchors on sessionStartAt when nothing has been mirrored this page-life', () => {
    // lastMirrorAt is 0 on every page-life (worldMirrorSync module state,
    // deliberately not persisted). A ceiling measured from it alone would be
    // true on the first poll of every launch and force a multi-megabyte
    // export 30 seconds in, mid-burst — exactly what the quiet window exists
    // to prevent.
    expect(shouldMirror({
      ...typing, lastMirrorAt: 0, sessionStartAt: NOW - 1000,
    })).toBe(false)
    expect(shouldMirror({
      ...typing, lastMirrorAt: 0, sessionStartAt: NOW - MIRROR_MAX_STALE_MS - 1,
    })).toBe(true)
  })

  it('is inert when sessionStartAt is omitted', () => {
    // Default sessionStartAt = now, so now - now = 0 never reaches the
    // ceiling. Omitting the anchor degrades to the old behaviour; it can
    // never manufacture a write.
    expect(shouldMirror({ ...typing, lastMirrorAt: 0 })).toBe(false)
  })

  it('does not override the already-mirrored check', () => {
    // The disk copy is current. However old it is, the ceiling must not
    // manufacture a redundant multi-megabyte export of an unchanged world.
    expect(shouldMirror({
      now: NOW,
      lastChangeAt: NOW - MIRROR_MAX_STALE_MS - 5000,
      lastMirrorAt: NOW - MIRROR_MAX_STALE_MS - 5000,
    })).toBe(false)
  })

  it('does not override the interval floor', () => {
    // Contrived: floor raised above the ceiling. Proves the floor is
    // evaluated on the stale path too, so maxStaleMs >= floorMs stays a
    // tuning choice and a future tweak to either constant cannot silently
    // reintroduce thrash.
    expect(shouldMirror({
      ...typing,
      lastMirrorAt: NOW - MIRROR_MAX_STALE_MS - 1,
      floorMs: MIRROR_MAX_STALE_MS * 2,
    })).toBe(false)
  })

  it('honours a caller-supplied ceiling', () => {
    expect(shouldMirror({
      ...typing, lastMirrorAt: NOW - 2000, maxStaleMs: 1000, floorMs: 10,
    })).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/worldMirror.test.ts`

Expected: the file fails to typecheck/import — `MIRROR_MAX_STALE_MS` is not exported from `./worldMirror`. If Vitest reports the import error rather than individual assertion failures, that is the expected failure for this step.

- [ ] **Step 3: Add the constant**

In `src/worldMirror.ts`, directly after the `MIRROR_FLOOR_MS` block (line 12) and before `MIRROR_POLL_MS`:

```ts
/** Staleness ceiling: how long changes may go unmirrored before a write is
 *  forced through the quiet window. Without it the quiet window is
 *  unreachable for a steady typist — `PageRoute` commits content after 500ms,
 *  so `lastChangeAt` slides forward faster than `MIRROR_QUIET_MS` elapses and
 *  no write fires for the whole session, making an unclean loss cost the
 *  entire editing burst (#233). Bounds that loss at this value plus one poll.
 *  Ten minutes rather than fifteen because `MIRROR_FLOOR_MS` already permits a
 *  write every five during bursty editing, so a forced write every ten asks
 *  nothing of the system it doesn't already do on a normal day. */
export const MIRROR_MAX_STALE_MS = 10 * 60_000
```

- [ ] **Step 4: Run the tests again**

Run: `npm run test:run -- src/worldMirror.test.ts`

Expected: the import error is gone. `forces a write through the quiet window once the ceiling elapses`, `anchors on sessionStartAt…` (second assertion) and `honours a caller-supplied ceiling` now FAIL with `expected false to be true` — the constant exists but nothing consumes it. The other new tests pass vacuously. This is the real red state.

- [ ] **Step 5: Implement the ceiling**

Replace the whole of `shouldMirror` in `src/worldMirror.ts` (currently lines 29-65, doc comment included) with:

```ts
/** Whether the active world's mirror should be rewritten now.
 *
 *  There is deliberately no dirty flag: `lastChangeAt` comes from the
 *  caller's change probe (`worldMirrorSync.ts`'s `mirrorChangeTime`, which
 *  combines `latestChangeTime()`'s six indexed reads with row counts for the
 *  tables that have neither — see its doc for exactly what that can and can't
 *  see), so no future edit path needs a hook of its own to mark the world
 *  dirty. Non-finite and future timestamps count as due — the same guard
 *  `updater.ts`'s `shouldCheck` carries, and for the same reason: a corrupted
 *  or rolled-back clock must never disable durability silently and
 *  indefinitely.
 *
 *  Three windows, in order of precedence. The **quiet window** holds a write
 *  back while editing is in flight; the **staleness ceiling** overrides it
 *  once changes have been pending for `maxStaleMs`, because otherwise a
 *  steady typist never reaches a quiet moment at all (#233); the **interval
 *  floor** is evaluated on every path, ceiling included, so it always holds.
 *  That last point is deliberate: it keeps `maxStaleMs >= floorMs` a tuning
 *  choice rather than a correctness dependency.
 *
 *  `sessionStartAt` is what the ceiling measures from until the first write of
 *  the page-life lands. `lastMirrorAt` is module state in `worldMirrorSync.ts`
 *  that starts at 0 every page-life, so a ceiling measured from it alone would
 *  be true on the first poll of every launch — forcing a multi-megabyte export
 *  30 seconds into a session, mid-burst, which is precisely what the quiet
 *  window exists to prevent. It defaults to `now`, which makes the ceiling
 *  inert: a caller that omits it degrades to the pre-#233 behaviour and can
 *  never trigger a spurious write. */
export function shouldMirror(args: {
  lastChangeAt: number
  lastMirrorAt: number
  now: number
  sessionStartAt?: number
  quietMs?: number
  floorMs?: number
  maxStaleMs?: number
}): boolean {
  const {
    lastChangeAt,
    lastMirrorAt,
    now,
    sessionStartAt = now,
    quietMs = MIRROR_QUIET_MS,
    floorMs = MIRROR_FLOOR_MS,
    maxStaleMs = MIRROR_MAX_STALE_MS,
  } = args

  // A world with no recorded change at all has nothing to mirror. Checked
  // before the finite guards so an untouched world stays silent — and before
  // the ceiling, so an old session can't force a write of an empty world.
  if (lastChangeAt === 0) return false

  if (
    !Number.isFinite(lastChangeAt) ||
    !Number.isFinite(lastMirrorAt) ||
    !Number.isFinite(sessionStartAt)
  ) return true
  if (lastChangeAt > now || lastMirrorAt > now || sessionStartAt > now) return true

  // Checked before the ceiling: the disk copy is already current, so however
  // stale the clock says it is, there is nothing new to write.
  if (lastChangeAt <= lastMirrorAt) return false // already mirrored

  const staleSince = lastMirrorAt > 0 ? lastMirrorAt : sessionStartAt
  const stale = now - staleSince >= maxStaleMs

  if (!stale && now - lastChangeAt < quietMs) return false // still editing
  return now - lastMirrorAt >= floorMs
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:run -- src/worldMirror.test.ts`

Expected: PASS — all 9 pre-existing `shouldMirror` cases plus all 7 new ceiling cases plus `isValidLoreId`. If any pre-existing case fails, stop: the guard order is wrong, not the test.

- [ ] **Step 7: Commit**

```bash
git add src/worldMirror.ts src/worldMirror.test.ts
git commit -m "fix: add a staleness ceiling to the mirror cadence policy (#233)

The quiet window is unreachable for an author typing steadily: PageRoute
commits content after 500ms, so lastChangeAt slides forward faster than
MIRROR_QUIET_MS elapses and no mirror write fires for the whole session.

The ceiling overrides the quiet window only. The interval floor is still
evaluated on every path, so maxStaleMs >= floorMs stays a tuning choice
rather than a correctness dependency.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Anchor the ceiling at session start

**Files:**
- Modify: `src/worldMirrorSync.ts:26-29` (state), `:191-201` (test reset), `:233-239` (`maybeMirrorWorld`)
- Test: `src/worldMirrorSync.realdb.test.ts`

**Interfaces:**
- Consumes: `shouldMirror({ ..., sessionStartAt })` and `MIRROR_MAX_STALE_MS` from Task 1.
- Produces: no new exports. `resetWorldMirrorStateForTests()` keeps its existing `(): void` signature and additionally clears the new anchor.

**Background the implementer needs:** This test must be written in `worldMirrorSync.realdb.test.ts`, the harness that drives a **real** Dexie DB and mocks only `src/platform.ts`. Issue #233 carries this forward from the #174 postmortem: two Criticals reached review on that branch because every mirror test mocked `./db` wholesale, and reverting a real guard still passed the whole mocked suite. Do not add this test to `worldMirrorSync.test.ts`.

- [ ] **Step 1: Write the failing test**

In `src/worldMirrorSync.realdb.test.ts`, add a new import directly below the existing `import { registry } from './registryDb'` line (the file does not import from `./worldMirror` today):

```ts
import { MIRROR_MAX_STALE_MS, MIRROR_POLL_MS } from './worldMirror'
```

Then append this block at the end of the file:

```ts
// #233. Reproduces the reported bug against real data: an author typing
// continuously slides the change probe forward past every poll, so the quiet
// window never elapses and — before the ceiling — nothing was ever mirrored
// for the whole session. The assertion that matters most is the zero-before:
// without it this would only prove that writes happen eventually.
describe('a long unbroken writing session is still mirrored (#233)', () => {
  const PAGE_ID = 'p-233'

  beforeEach(async () => {
    vi.clearAllMocks()
    resetWorldMirrorStateForTests()
    vi.mocked(writeWorldMirror).mockResolvedValue(true)

    // write()'s entry guard refuses a world the registry doesn't know, so the
    // world under test must be registered or nothing would write regardless.
    await registry.lores.clear()
    await registry.lores.add({
      id: activeLoreId, name: 'Aethel', banner: null, createdAt: 1, updatedAt: 1,
    })

    await Promise.all(db.tables.map((t) => t.clear()))
  })

  /** One poll tick of a steady typist: PageRoute committed page content 500ms
   *  ago (CONTENT_WRITE_DELAY_MS), which is what makes the 30s quiet window
   *  unreachable. Writes a real row so the real latestChangeTime() reads it. */
  async function typeThenPoll(now: number): Promise<void> {
    await db.pages.put({
      id: PAGE_ID,
      title: 'Aethelred',
      titleLc: 'aethelred',
      category: 'Character',
      content: '<p>drafting</p>',
      summary: '',
      tags: [],
      createdAt: now - 60 * 60_000,
      updatedAt: now - 500,
    })
    await maybeMirrorWorld(now)
  }

  it('writes nothing until the ceiling, then exactly once, then respects the floor', async () => {
    const start = Date.now()

    // Nine minutes of unbroken typing at the real 30s poll cadence.
    for (let t = 0; t < 9 * 60_000; t += MIRROR_POLL_MS) {
      await typeThenPoll(start + t)
    }
    // The pre-#233 behaviour, and the whole bug: the quiet window has not
    // elapsed once, so nothing has reached disk.
    expect(writeWorldMirror).not.toHaveBeenCalled()

    // The ceiling elapses. This is the write that #233 says never happens.
    await typeThenPoll(start + MIRROR_MAX_STALE_MS)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)

    // And the floor still applies afterwards: the next tick must not write.
    await typeThenPoll(start + MIRROR_MAX_STALE_MS + MIRROR_POLL_MS)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/worldMirrorSync.realdb.test.ts`

Expected: FAIL on `expect(writeWorldMirror).toHaveBeenCalledTimes(1)` with `expected "spy" to be called 1 times, but got 0 times`. Without the anchor wired through, `shouldMirror`'s `sessionStartAt` defaults to `now`, the ceiling is inert, and the quiet window blocks every tick — which is precisely the bug.

- [ ] **Step 3: Add the session anchor**

In `src/worldMirrorSync.ts`, immediately after the `lastMirrorAt` declaration (line 29):

```ts
// When this page-life first evaluated the cadence policy. The staleness
// ceiling measures from here until the first real write lands, because
// `lastMirrorAt` above starts at 0: a ceiling measured from it alone is true
// on the first poll of every launch, which would force a multi-megabyte
// export 30 seconds into every session, mid-burst. Stamped lazily rather than
// at module load — a module-level Date.now() is an import side effect, and
// lazy stamping keeps the value resettable between test cases.
let sessionStartAt = 0
```

- [ ] **Step 4: Stamp it and pass it to the policy**

Replace `maybeMirrorWorld` in `src/worldMirrorSync.ts` (lines 233-239) with:

```ts
/** Mirror the active world if the cadence policy says it is due. */
export async function maybeMirrorWorld(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  // Stamped here, not in flushWorldMirror: flush bypasses the cadence policy
  // entirely, so it has no anchor to establish.
  if (sessionStartAt === 0) sessionStartAt = now
  const lastChangeAt = await mirrorChangeTime(now)
  if (!shouldMirror({ lastChangeAt, lastMirrorAt, now, sessionStartAt })) return
  return run(now)
}
```

- [ ] **Step 5: Reset it between test cases**

In `resetWorldMirrorStateForTests()` (line ~192), add the new variable to the reset list, directly after `lastMirrorAt = 0`:

```ts
/** Test-only: reset module state between cases. */
export function resetWorldMirrorStateForTests(): void {
  lastMirrorAt = 0
  sessionStartAt = 0
  suspendDepth = 0
  suspendEpoch = 0
  inFlight = null
  lastKnownCounts = null
  countedChangeAt = 0
  lastSuccessAt = null
  lastError = null
}
```

This is not optional bookkeeping: the real-DB harness resets between every case, and a leaked `sessionStartAt` would make the ceiling fire or not fire based on test ordering.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test:run -- src/worldMirrorSync.realdb.test.ts src/worldMirrorSync.test.ts src/worldMirror.test.ts`

Expected: PASS, all three files. The pre-existing suites must be untouched and green.

- [ ] **Step 7: Commit**

```bash
git add src/worldMirrorSync.ts src/worldMirrorSync.realdb.test.ts
git commit -m "fix: anchor the mirror staleness ceiling at session start (#233)

lastMirrorAt starts at 0 every page-life, so a ceiling measured from it
alone is true on the first poll of every launch and would force a
multi-megabyte export 30s in, mid-burst. The anchor moves to lastMirrorAt
as soon as a real write lands.

Regression test drives the real-DB harness, per the #174 postmortem: a
continuously-typing session gets zero writes before the ceiling and
exactly one after.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Correct the docs that describe the gap as open

**Files:**
- Modify: `CLAUDE.md:216-230`
- Modify: `docs/superpowers/specs/2026-07-21-world-mirror-design.md:281-305`

**Interfaces:**
- Consumes: the behaviour delivered by Tasks 1 and 2. Nothing else consumes this task.
- Produces: nothing in code.

**Background the implementer needs:** Both documents currently state as fact that a steady typist is never mirrored. Leaving that in place after the fix is worse than never having written it, because the next reader will design around a constraint that no longer exists. The #174 spec's "Exit criterion" section has understated this bound twice already, so the correction should state the new bound plainly and not editorialise further.

- [ ] **Step 1: Update the CLAUDE.md cadence paragraph**

In `CLAUDE.md`, replace lines 216-219 (from `**Cadence.**` through `` `shouldCheck` carries). ``) with:

```markdown
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
dependency.
```

- [ ] **Step 2: Remove the stale claim later in the same paragraph**

In `CLAUDE.md`, replace lines 226-228 — the sentences reading `` Worse, the quiet window means a steady typist slides `lastChangeAt` forward on every poll and gets **no write at all** for the whole session (#233). `flushWorldMirror()` on close is the `` — so that the `Worse, …(#233).` sentence is deleted entirely and the surrounding text reads:

```markdown
`maps`/`calendars` notice an add but not an edit. `flushWorldMirror()` on close
is the deliberate backstop for all of it — unconditional, writing whenever the
world has any content.
```

The probe's own blind spots (in-place edits to the nine counted tables, `maps`/`calendars` add-vs-edit) are unchanged and must stay described exactly as they are — only the `#233` sentence goes.

- [ ] **Step 3: Rewrite the #174 spec's exit criterion**

In `docs/superpowers/specs/2026-07-21-world-mirror-design.md`, replace the entire `## Exit criterion` section (lines 281-305, up to but not including `## Out of scope`) with:

```markdown
## Exit criterion

An unclean loss (crash, power cut, force-kill) costs at most
`MIRROR_MAX_STALE_MS` plus one poll interval — **~10.5 minutes**.

As originally shipped this section was wrong twice, first as "one quiet-window"
(~30s) and then as "roughly 5.5 minutes". Both assumed a bursty editor who
pauses. The real bound was unbounded: `shouldMirror` returned false while
`now - lastChangeAt < MIRROR_QUIET_MS`, and `PageRoute` writes content after
500ms, so an author typing steadily slid `lastChangeAt` forward on every poll
and no mirror write fired for the whole session.

#233 closed that with a staleness ceiling — a forced write once changes have
gone unmirrored for `MIRROR_MAX_STALE_MS` (10 min), overriding the quiet window
but not the interval floor. See
`docs/superpowers/specs/2026-07-22-mirror-staleness-ceiling-design.md`.

`flushWorldMirror` on a clean close remains unconditional, so a *clean* quit
still loses nothing, and the next launch offers every mirrored world back from
disk regardless.
```

- [ ] **Step 4: Verify the whole project**

Run: `npm run lint && npm run build && npm run test:run`

Expected: lint clean, `tsc -b` + `vite build` succeed, full Vitest suite passes. Do not proceed to commit on any failure.

- [ ] **Step 5: Confirm no stale claim survives**

Run: `git grep -n "no write at all" -- CLAUDE.md docs/`

Expected: no output. Any hit is a doc still describing the fixed bug as live.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-07-21-world-mirror-design.md
git commit -m "docs: the mirror cadence gap is closed, stop describing it as open (#233)

Both documents stated as fact that a steady typist is never mirrored.
The #174 spec's exit criterion has understated this bound twice; it now
states the real one (~10.5 min) and points at the ceiling's own spec.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Done criteria

- `npm run lint && npm run build && npm run test:run` all pass.
- `src/worldMirror.test.ts` covers: ceiling fires, ceiling waits, session anchor both directions, inert default, does-not-override-already-mirrored, does-not-override-floor, caller-supplied ceiling.
- `src/worldMirrorSync.realdb.test.ts` proves zero writes before the ceiling and exactly one after, against a real DB.
- No document claims a continuous session goes unmirrored.
- PR opened against `main` with a **`version:patch`** label (bug fix), closing #233.
