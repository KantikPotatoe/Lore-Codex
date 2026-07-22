import { describe, it, expect, beforeEach, vi } from 'vitest'

// #174 Critical, round 2: every existing worldMirrorSync test mocks './db'
// wholesale with hand-supplied counts, which is exactly why two review rounds
// missed this bug — the logic was correct against its fixtures and wrong
// against reality. This file drives the mirror against a REAL, freshly-seeded,
// empty LoreDB (fake-indexeddb, this project's existing test foundation — see
// src/db/templates.test.ts) and a REAL, empty registry DB. Only the shell seam
// (src/platform.ts) is mocked, per the brief.
//
// See docs/superpowers/plans/2026-07-22-world-mirror-fixes-2.md, Task 1.

vi.mock('./platform', () => ({
  writeWorldMirror: vi.fn(async () => true),
  readRegistryMirror: vi.fn(async () => ({ status: 'absent' })),
  writeRegistryMirror: vi.fn(async () => true),
  withRegistryMirrorLock: (fn: () => Promise<unknown>) => fn(),
  WORLDS_DIR: 'worlds',
}))

import { writeWorldMirror } from './platform'
import { db, activeLoreId, seedTemplates, seedDefaultCalendar } from './db'
import { registry } from './registryDb'
import {
  maybeMirrorWorld,
  flushWorldMirror,
  resetWorldMirrorStateForTests,
} from './worldMirrorSync'

describe('post-eviction relaunch must not mirror the seeded-empty default world', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetWorldMirrorStateForTests()
    vi.mocked(writeWorldMirror).mockResolvedValue(true)

    // The real post-eviction state: storage (incl. localStorage) was evicted,
    // so currentLoreId() falls back to 'default' — and since db.ts's module-
    // level `activeLoreId`/`db` bind from currentLoreId() at import time
    // against this test file's fresh, key-less happy-dom localStorage, this
    // really is that same value, not a stand-in for it.
    expect(activeLoreId).toBe('default')

    // bootstrapDefaultLore() correctly declines to seed a registry entry for
    // an unevicted-but-unknown world, so the registry genuinely knows nothing.
    await registry.lores.clear()

    // Isolate from any other test's writes to this file's shared fake db.
    await Promise.all(db.tables.map((t) => t.clear()))

    // The exact startup sequence App.tsx runs on every launch, against the
    // exact empty DB left behind by eviction.
    await seedTemplates()
    await seedDefaultCalendar()
  })

  it('maybeMirrorWorld (poll path) does not write the seeded-empty world', async () => {
    // An epoch-scale "now": trivially clears the quiet window and the floor
    // (lastMirrorAt is 0 this page-life), exactly as the brief describes —
    // this is not a contrived clock, it's what a real setInterval poll looks
    // like relative to a seed that just happened at Date.now().
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000
    await maybeMirrorWorld(farFuture)
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })

  it('flushWorldMirror (close path) does not write the seeded-empty world either', async () => {
    await flushWorldMirror(Date.now())
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })
})
