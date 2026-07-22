import { describe, it, expect } from 'vitest'
import { shouldMirror, isValidLoreId, MIRROR_QUIET_MS, MIRROR_FLOOR_MS } from './worldMirror'

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
  })

  it('treats future timestamps as due', () => {
    expect(shouldMirror({ ...base, lastChangeAt: NOW + 5000 })).toBe(true)
    expect(shouldMirror({ ...base, lastMirrorAt: NOW + 5000 })).toBe(true)
  })

  it('honours caller-supplied windows', () => {
    expect(shouldMirror({ ...base, lastChangeAt: NOW - 50, quietMs: 10, floorMs: 10 })).toBe(true)
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
