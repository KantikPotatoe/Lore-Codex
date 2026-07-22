import { describe, it, expect } from 'vitest'
import {
  shouldMirror, isValidLoreId, MIRROR_QUIET_MS, MIRROR_FLOOR_MS, MIRROR_MAX_STALE_MS,
} from './worldMirror'

const NOW = 1_000_000_000
// A change old enough to have left the quiet window, and a mirror old enough
// to have cleared the floor — the baseline "yes, write it" case.
const base = {
  now: NOW,
  lastChangeAt: NOW - MIRROR_QUIET_MS - 1,
  lastMirrorAt: NOW - MIRROR_FLOOR_MS - 1,
}

describe('shouldMirror', () => {
  it('writes when a change is settled and the floor has passed', () => {
    expect(shouldMirror(base)).toBe(true)
  })

  it('does not write when nothing changed since the last mirror', () => {
    expect(shouldMirror({ ...base, lastChangeAt: base.lastMirrorAt })).toBe(false)
    expect(shouldMirror({ ...base, lastChangeAt: base.lastMirrorAt - 1 })).toBe(false)
  })

  it('waits while the user is still editing', () => {
    expect(shouldMirror({ ...base, lastChangeAt: NOW - 1 })).toBe(false)
  })

  it('waits until the interval floor has passed since the last write', () => {
    // Deliberately not spread from `base`: the change must be NEWER than the
    // last mirror (or the "already mirrored" branch short-circuits) and settled
    // (or the quiet window does), leaving the floor as the only thing that can
    // block the write.
    expect(shouldMirror({
      now: NOW,
      lastMirrorAt: NOW - 60_000,
      lastChangeAt: NOW - 40_000,
    })).toBe(false)
  })

  it('writes on the very first evaluation of a session', () => {
    // lastMirrorAt = 0: nothing written yet this page-life.
    expect(shouldMirror({ ...base, lastMirrorAt: 0 })).toBe(true)
  })

  it('treats a nothing-ever-changed world as not due', () => {
    expect(shouldMirror({ now: NOW, lastChangeAt: 0, lastMirrorAt: 0 })).toBe(false)
  })

  // Mirrors the guards updater.ts's shouldCheck learned: a corrupt or
  // rolled-back clock must fail toward writing, never toward silence.
  it('treats non-finite timestamps as due', () => {
    // lastMirrorAt is inside the floor window here, so without the finite guard
    // this would return false — the assertion can only pass because of it.
    expect(shouldMirror({ ...base, lastChangeAt: NaN, lastMirrorAt: NOW - 1000 })).toBe(true)
    expect(shouldMirror({ ...base, lastMirrorAt: NaN })).toBe(true)
    // lastMirrorAt: 0 (first poll of the session) makes staleSince fall back to
    // sessionStartAt, and lastChangeAt is inside the quiet window, so without
    // the sessionStartAt finite guard this would fall through to "still
    // editing" and return false.
    expect(shouldMirror({
      now: NOW, lastChangeAt: NOW - 500, lastMirrorAt: 0, sessionStartAt: NaN,
    })).toBe(true)
  })

  it('treats future timestamps as due', () => {
    expect(shouldMirror({ ...base, lastChangeAt: NOW + 5000 })).toBe(true)
    expect(shouldMirror({ ...base, lastMirrorAt: NOW + 5000 })).toBe(true)
    // Same shape as above: lastMirrorAt: 0 hands the ceiling to sessionStartAt,
    // and lastChangeAt is inside the quiet window, so without the
    // sessionStartAt future guard this would fall through to "still editing"
    // and return false.
    expect(shouldMirror({
      now: NOW, lastChangeAt: NOW - 500, lastMirrorAt: 0, sessionStartAt: NOW + 5000,
    })).toBe(true)
  })

  it('honours caller-supplied windows', () => {
    expect(shouldMirror({ ...base, lastChangeAt: NOW - 50, quietMs: 10, floorMs: 10 })).toBe(true)
  })
})

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
    // Load-bearing beyond its own name: per review, this is the only
    // assertion on the branch that catches `staleSince` always equalling
    // `sessionStartAt` (i.e. never handing over to `lastMirrorAt` after the
    // first write) — the real-DB regression test and four of the other new
    // unit cases here still pass under that mutation. Do not delete this as
    // redundant with the other ceiling cases.
    expect(shouldMirror({
      ...typing, lastMirrorAt: NOW - 2000, maxStaleMs: 1000, floorMs: 10,
    })).toBe(true)
  })
})

describe('isValidLoreId', () => {
  it('accepts the ids the app actually mints', () => {
    expect(isValidLoreId('default')).toBe(true)
    expect(isValidLoreId('0f8fad5b-d9cb-469f-a165-70867728950e')).toBe(true)
  })

  it('rejects anything that could escape the worlds folder', () => {
    for (const bad of ['', '.', '..', '../etc', 'a/b', 'a\\b', 'a.lore', 'a b']) {
      expect(isValidLoreId(bad)).toBe(false)
    }
  })
})
