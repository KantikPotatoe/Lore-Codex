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

// Real './db' throughout — everything is passed through via importOriginal
// except exportAll, wrapped in a vi.fn() that still calls straight through to
// the real implementation by default. This is NOT the wholesale, hand-supplied
// fixture the file-level comment above warns against: db, registry, counts,
// seedTemplates — all real. The one function wrapped exists only so item 1's
// test below can hold a REAL exportAll() call pending (gate its resolution)
// to create a genuine, observable async gap for the suspend/release race to
// land in, the same way worldMirrorSync.test.ts's own exportAll-gating does
// for its (fixture-mocked) I3 test — just against real data here instead.
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>()
  return { ...actual, exportAll: vi.fn(actual.exportAll) }
})

// Same treatment for latestChangeTime (real implementation by default,
// gateable per-test) — needed to reproduce item 1's actual reachable
// ordering: the suspend/release cycle must run to completion during the GAP
// between maybeMirrorWorld's entry guard and run() actually being called
// (i.e. before write() sets `inFlight`), because withMirroringSuspended
// itself blocks on `inFlight` once it exists — see its doc comment. That is
// exactly the window the pre-existing (fixture) I3 test's first case uses;
// this test additionally releases the suspended fn WHILE exportAll() is
// still pending, rather than after, which is what makes the depth-only
// check wrongly pass while the epoch check correctly still catches it.
vi.mock('./backup', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./backup')>()
  return { ...actual, latestChangeTime: vi.fn(actual.latestChangeTime) }
})

import { writeWorldMirror } from './platform'
import { db, activeLoreId, seedTemplates, seedDefaultCalendar, exportAll } from './db'
import { latestChangeTime } from './backup'
import { registry } from './registryDb'
import { MIRROR_MAX_STALE_MS, MIRROR_POLL_MS } from './worldMirror'
import {
  maybeMirrorWorld,
  flushWorldMirror,
  withMirroringSuspended,
  resetWorldMirrorStateForTests,
} from './worldMirrorSync'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

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

// #174 task r3, item 1. The suspension guard used to be a bare `suspendDepth
// > 0` recheck after exportAll() resolves — which misses the case where a
// suspension is raised AND fully released entirely while the export is still
// in flight: by the time the recheck runs, suspendDepth is back at 0, and the
// stale export commits anyway. This drives the real mirror against a real,
// registered world (not the post-eviction "registry doesn't know this world"
// case above, which the entry guard alone already blocks) so the only thing
// standing between the export and disk is the suspension recheck itself.
describe('write() must drop an export that straddled a suspension, even one that fully lifted before the recheck (#174 task r3, item 1)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetWorldMirrorStateForTests()
    vi.mocked(writeWorldMirror).mockResolvedValue(true)

    // Unlike the post-eviction suite above, this world IS known to the
    // registry — the entry guard in write() must pass here, so the recheck
    // under test is the only thing left to catch the stale export.
    await registry.lores.clear()
    await registry.lores.add({
      id: activeLoreId, name: 'Aethel', banner: null, createdAt: 1, updatedAt: 1,
    })

    await Promise.all(db.tables.map((t) => t.clear()))
    await seedTemplates() // real, non-empty content — hasMirrorableContent() must read true
  })

  it('never reaches disk when a suspension is raised and released entirely during exportAll()', async () => {
    // Epoch-scale "now", exactly like the post-eviction suite above: trivially
    // clears the quiet window and the floor (lastMirrorAt is 0 this page-life)
    // once the probe reports a real, recent lastChangeAt below.
    const farFuture = Date.now() + 365 * 24 * 60 * 60 * 1000

    // Block the probe so maybeMirrorWorld is caught between its entry guard
    // (suspendDepth checked, still 0) and ever calling run() — i.e. before
    // `inFlight` exists, so withMirroringSuspended's own await-inFlight guard
    // (see its doc comment) does not intercept the suspend call below. This
    // is the exact same gap the pre-existing fixture I3 test's first case
    // uses; the difference here is WHEN the suspended fn is released.
    const probeGate = deferred<number>()
    vi.mocked(latestChangeTime).mockReturnValueOnce(probeGate.promise)

    // Also hold the real exportAll() call pending, independently, so there is
    // a real, observable window between write() starting the export and it
    // resolving — the window the release below must land inside.
    const exportGate = deferred<string>()
    vi.mocked(exportAll).mockReturnValueOnce(exportGate.promise)

    const poll = maybeMirrorWorld(farFuture)
    await vi.waitFor(() => expect(latestChangeTime).toHaveBeenCalledTimes(1))
    expect(exportAll).not.toHaveBeenCalled()

    // Suspension begins now — inFlight is still null, so it takes effect
    // immediately, before the poll has even decided to export. Its own fn
    // stays pending on its own gate (importGate) so it is still genuinely
    // RUNNING — not yet released — once write() starts.
    const importGate = deferred<void>()
    let importStarted = false
    const suspended = withMirroringSuspended(async () => {
      importStarted = true
      await importGate.promise
    })
    await vi.waitFor(() => expect(importStarted).toBe(true))

    // Let the poll's probe resolve as "there is a real, due change" —
    // countedTableCounts() alongside it is real and fast (seedTemplates()
    // above gave it non-zero counts). The poll proceeds to run() -> write():
    // inFlight is set now, suspendDepth is still 1 (the import above hasn't
    // released yet), so write()'s epochAtStart is captured pre-release.
    probeGate.resolve(Date.now())
    await vi.waitFor(() => expect(exportAll).toHaveBeenCalledTimes(1))

    // NOW release the suspended fn — WHILE exportAll() is still pending
    // (exportGate hasn't resolved yet). This is the exact gap write()'s
    // epoch comparison exists to catch: suspendDepth drops back to 0 well
    // before the post-export recheck runs, so a bare `suspendDepth > 0`
    // check alone would wrongly let this write proceed.
    importGate.resolve()
    await suspended // waits for the finally block (suspendDepth--, epoch++) to actually run

    exportGate.resolve('{"schemaVersion":12,"pages":[]}')
    await poll

    expect(writeWorldMirror).not.toHaveBeenCalled()
  })

  it('sanity check: without any suspension, the same real export commits normally', async () => {
    await flushWorldMirror(Date.now())
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
    expect(exportAll).toHaveBeenCalledTimes(1)
  })
})

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
