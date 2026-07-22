import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MIRROR_QUIET_MS, MIRROR_FLOOR_MS, MIRROR_POLL_MS } from './worldMirror'

vi.mock('./platform', () => ({
  writeWorldMirror: vi.fn(async () => true),
  readRegistryMirror: vi.fn(async () => null),
  writeRegistryMirror: vi.fn(async () => true),
  WORLDS_DIR: 'worlds',
}))

// activeLoreId is fixed at 'default' — distinct from currentLoreId's mocked
// return value below, so any test that asserts writeWorldMirror was called
// with 'default' is implicitly pinning I1 (the module must use the bound
// snapshot, not a live localStorage read).
vi.mock('./db', () => ({
  exportAll: vi.fn(async () => '{"pages":[]}'),
  activeLoreId: 'default',
  countAll: vi.fn(async () => ({
    pages: 0, maps: 0, pins: 0, regions: 0, templates: 0, calendars: 0, events: 0,
    images: 0, docLinks: 0, books: 0, chapters: 0, scenes: 0, plotlines: 0, beats: 0,
  })),
  db: {
    pins: { count: vi.fn(async () => 0) },
    regions: { count: vi.fn(async () => 0) },
    templates: { count: vi.fn(async () => 0) },
    docLinks: { count: vi.fn(async () => 0) },
    books: { count: vi.fn(async () => 0) },
    chapters: { count: vi.fn(async () => 0) },
    plotlines: { count: vi.fn(async () => 0) },
    beats: { count: vi.fn(async () => 0) },
    meta: { count: vi.fn(async () => 0) },
  },
}))
vi.mock('./backup', () => ({ latestChangeTime: vi.fn(async () => 0) }))
// The live localStorage read I1 must NOT be trusted — mocked to a value that
// deliberately differs from activeLoreId's 'default' above, so any test that
// still ends up writing 'default' proves the fix, not a mock coincidence.
vi.mock('./loreId', () => ({ currentLoreId: vi.fn(() => 'stale-live-lore-id') }))

import { writeWorldMirror, readRegistryMirror, writeRegistryMirror } from './platform'
import { exportAll, countAll, db } from './db'
import { latestChangeTime } from './backup'
import { currentLoreId } from './loreId'
import { registry } from './registryDb'
import {
  maybeMirrorWorld,
  flushWorldMirror,
  withMirroringSuspended,
  resetWorldMirrorStateForTests,
  startMirrorLoop,
  getMirrorHealth,
  mirrorFilePath,
} from './worldMirrorSync'

const NOW = 1_000_000_000
const SETTLED = NOW - MIRROR_QUIET_MS - 1

const ZERO_COUNTS = {
  pages: 0, maps: 0, pins: 0, regions: 0, templates: 0, calendars: 0, events: 0,
  images: 0, docLinks: 0, books: 0, chapters: 0, scenes: 0, plotlines: 0, beats: 0,
}

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

// Every test in this file is about the poll/floor/quiet/suspend/health logic
// for a world the app already knows about — the "registry has no row for
// activeLoreId" case (the post-eviction Critical, #174) is deliberately NOT
// this file's concern: it can't be, since this file mocks './db' wholesale,
// and that mock is exactly what let that bug through review twice (see
// worldMirrorSync.realdb.test.ts, which drives a real Dexie DB instead). So
// every test here runs against a registered 'default' world by default;
// `put` (not `add`) so a test that wants a specific name can override it.
async function registerActiveLore(overrides: Partial<{ name: string }> = {}) {
  await registry.lores.put({
    id: 'default', name: 'Test World', banner: null, createdAt: 1, updatedAt: 1, ...overrides,
  })
}

beforeEach(async () => {
  vi.clearAllMocks()
  resetWorldMirrorStateForTests()
  vi.mocked(writeWorldMirror).mockResolvedValue(true)
  vi.mocked(exportAll).mockResolvedValue('{"pages":[]}')
  vi.mocked(readRegistryMirror).mockResolvedValue(null)
  vi.mocked(writeRegistryMirror).mockResolvedValue(true)
  vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS })
  vi.mocked(currentLoreId).mockReturnValue('stale-live-lore-id')
  for (const t of [db.pins, db.regions, db.templates, db.docLinks, db.books,
    db.chapters, db.plotlines, db.beats, db.meta]) {
    vi.mocked(t.count).mockResolvedValue(0)
  }
  await registry.lores.clear()
  await registerActiveLore()
})

describe('maybeMirrorWorld', () => {
  it('writes the active world when the policy says due', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).toHaveBeenCalledWith('default', '{"pages":[]}')
  })

  it('does not export at all when nothing changed', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(0)
    await maybeMirrorWorld(NOW)
    // The point of checking the policy before exporting: a full export inlines
    // every image, so an idle app must not pay that cost every poll.
    expect(exportAll).not.toHaveBeenCalled()
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })

  it('respects the interval floor after a write', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)

    // A newer change, but only a moment after the write we just did.
    vi.mocked(latestChangeTime).mockResolvedValue(NOW + 1)
    await maybeMirrorWorld(NOW + MIRROR_QUIET_MS + 2)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)

    // Once the floor clears, it writes again.
    await maybeMirrorWorld(NOW + MIRROR_FLOOR_MS + MIRROR_QUIET_MS + 2)
    expect(writeWorldMirror).toHaveBeenCalledTimes(2)
  })

  it('coalesces overlapping calls into one write', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await Promise.all([maybeMirrorWorld(NOW), maybeMirrorWorld(NOW), maybeMirrorWorld(NOW)])
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('leaves the mirror time unchanged when the seam reports no write', async () => {
    // The browser path: writeWorldMirror returns false. Recording a mirror time
    // there would make the policy think a mirror exists when none does.
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    vi.mocked(writeWorldMirror).mockResolvedValue(false)
    await maybeMirrorWorld(NOW)
    vi.mocked(writeWorldMirror).mockResolvedValue(true)
    await maybeMirrorWorld(NOW + 1)
    expect(writeWorldMirror).toHaveBeenCalledTimes(2)
  })
})

describe('flushWorldMirror', () => {
  it('writes even inside the quiet and floor windows, given content', async () => {
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS, pages: 1 })
    await flushWorldMirror()
    // On close there is no later opportunity, so the windows do not apply.
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the world is completely empty', async () => {
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS })
    vi.mocked(db.meta.count).mockResolvedValue(0)
    await flushWorldMirror()
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })

  it('treats a meta-only world (settings, no pages) as content worth flushing', async () => {
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS })
    vi.mocked(db.meta.count).mockResolvedValue(1)
    await flushWorldMirror()
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })
})

describe('withMirroringSuspended', () => {
  it('drops mirror attempts made during an import instead of deferring them', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await withMirroringSuspended(async () => {
      // importAll() is clear() + bulkAdd. A mirror landing here would capture a
      // half-empty world and rename it over a good file.
      await maybeMirrorWorld(NOW)
      await flushWorldMirror()
    })
    expect(writeWorldMirror).not.toHaveBeenCalled()

    // Dropped, not queued: nothing fires on its own once the guard lifts.
    expect(writeWorldMirror).not.toHaveBeenCalled()

    // The next real evaluation writes the post-import state.
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('lifts the guard even when the wrapped work throws', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await expect(
      withMirroringSuspended(async () => { throw new Error('bad backup') }),
    ).rejects.toThrow('bad backup')
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })
})

describe('stamping the registry index after a real mirror write (#174 second bug)', () => {
  it('stamps mirroredAt for the mirrored world after writeWorldMirror succeeds', async () => {
    await registerActiveLore({ name: 'My World' })
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)

    await maybeMirrorWorld(NOW)

    expect(writeRegistryMirror).toHaveBeenCalledTimes(1)
    const written = JSON.parse(vi.mocked(writeRegistryMirror).mock.calls[0][0])
    expect(written).toEqual([
      { id: 'default', name: 'My World', mirroredAt: NOW, appVersion: expect.any(String) },
    ])
  })

  it('does not stamp the index when the seam reports no write (browser path)', async () => {
    vi.mocked(writeWorldMirror).mockResolvedValue(false)
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)

    await maybeMirrorWorld(NOW)

    expect(writeRegistryMirror).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// I5 (#174, round 2) — the mirror must refuse to write for a world the
// registry doesn't know about. See worldMirrorSync.realdb.test.ts for the
// real-Dexie reproduction of the actual post-eviction defect this closes;
// these two are the mocked-suite complement, isolating just the guard.
// ---------------------------------------------------------------------------
describe('I5: refuses to mirror a world absent from the registry', () => {
  it('maybeMirrorWorld does not write when activeLoreId has no registry row', async () => {
    await registry.lores.clear() // undo this file's default beforeEach seed
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })

  it('flushWorldMirror does not write when activeLoreId has no registry row, even with content', async () => {
    await registry.lores.clear()
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS, pages: 1 })
    await flushWorldMirror(NOW)
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// I1 — the mirror must target the module-bound world, not a live
// localStorage read that can have moved on (deleteLore/switchLore reload
// window).
// ---------------------------------------------------------------------------
describe('I1: targets the bound world, not currentLoreId()', () => {
  it('writes under activeLoreId even though currentLoreId() reports a different id', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    expect(currentLoreId()).toBe('stale-live-lore-id') // sanity: the live read really does disagree
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).toHaveBeenCalledWith('default', expect.any(String))
    expect(writeWorldMirror).not.toHaveBeenCalledWith('stale-live-lore-id', expect.anything())
  })

  it('flushWorldMirror on close also writes under activeLoreId', async () => {
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS, pages: 1 })
    await flushWorldMirror(NOW)
    expect(writeWorldMirror).toHaveBeenCalledWith('default', expect.any(String))
  })
})

// ---------------------------------------------------------------------------
// I2 — the mirror-specific probe must catch tables latestChangeTime() cannot
// see (pins, regions, templates, docLinks, books, chapters, plotlines, beats,
// meta), by row count rather than timestamp.
// ---------------------------------------------------------------------------
describe('I2: mirror-specific probe covers the 9 uncounted-by-latestChangeTime tables', () => {
  it('a pin-only session (no page/map/event/calendar/image/scene change) still triggers a write', async () => {
    // Nothing in the 6 latestChangeTime tables ever changed.
    vi.mocked(latestChangeTime).mockResolvedValue(0)

    // First poll establishes the baseline count (1 pin already exists) — an
    // existing, already-mirrored world. No write: nothing new has been seen.
    vi.mocked(db.pins.count).mockResolvedValue(1)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    // The user adds a second pin. The very next poll notices the count moved,
    // but the change is brand new — the quiet window hasn't elapsed yet.
    vi.mocked(db.pins.count).mockResolvedValue(2)
    await maybeMirrorWorld(NOW + MIRROR_POLL_MS)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    // A later poll, with the pin count unchanged since it was first noticed:
    // the change has settled past the quiet window and the floor is clear
    // (lastMirrorAt is still 0 this page-life), so it writes.
    await maybeMirrorWorld(NOW + MIRROR_POLL_MS + MIRROR_QUIET_MS + 1)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('a plotline/beat-only session triggers a write the same way', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(0)
    vi.mocked(db.plotlines.count).mockResolvedValue(1)
    vi.mocked(db.beats.count).mockResolvedValue(3)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    vi.mocked(db.beats.count).mockResolvedValue(4) // one beat added to the grid
    await maybeMirrorWorld(NOW + MIRROR_POLL_MS)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    await maybeMirrorWorld(NOW + MIRROR_POLL_MS + MIRROR_QUIET_MS + 1)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('a settings-only session (meta row added) triggers a write', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(0)
    vi.mocked(db.meta.count).mockResolvedValue(2)
    await maybeMirrorWorld(NOW)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    vi.mocked(db.meta.count).mockResolvedValue(3) // a new setting saved
    await maybeMirrorWorld(NOW + MIRROR_POLL_MS)
    expect(writeWorldMirror).not.toHaveBeenCalled()

    await maybeMirrorWorld(NOW + MIRROR_POLL_MS + MIRROR_QUIET_MS + 1)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('a stable world with unchanging counted-table rows never fires from them alone', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(0)
    vi.mocked(db.pins.count).mockResolvedValue(5)
    vi.mocked(db.templates.count).mockResolvedValue(9)
    for (let i = 0; i < 5; i++) {
      await maybeMirrorWorld(NOW + i * MIRROR_POLL_MS)
    }
    expect(writeWorldMirror).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// I2 safety net — flushWorldMirror is unconditional on close: it writes
// whenever the world has content, even if nothing changed since the last
// mirror (which is exactly what a probe blind spot looks like).
// ---------------------------------------------------------------------------
describe('I2 safety net: flushWorldMirror ignores "nothing changed since last mirror"', () => {
  it('still writes on close even when the probe reports no change at all', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    await maybeMirrorWorld(NOW) // establishes a real lastMirrorAt = NOW
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)

    // Nothing changed since: latestChangeTime is flat, counted tables are
    // flat. The old behaviour (lastChangeAt <= lastMirrorAt) would skip this.
    // The world still has content, so the close flush must write anyway.
    vi.mocked(countAll).mockResolvedValue({ ...ZERO_COUNTS, pages: 1 })
    await flushWorldMirror(NOW + 1)
    expect(writeWorldMirror).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// I3 — suspension must be re-checked after exportAll() resolves, immediately
// before the disk write, because a poll can begin before the guard is raised
// and still be mid-export (or mid-probe) when it is.
// ---------------------------------------------------------------------------
describe('I3: suspension raised mid-flight aborts the write before it commits', () => {
  it('drops a poll whose change-probe was still pending when suspension began', async () => {
    // Block the probe (latestChangeTime) so maybeMirrorWorld is caught between
    // its entry guard (suspendDepth checked, still 0) and ever reaching run() —
    // i.e. before `inFlight` exists, so withMirroringSuspended's own
    // await-inFlight guard does not apply here. This is exactly the case only
    // write()'s post-export recheck can catch.
    const probeGate = deferred<number>()
    vi.mocked(latestChangeTime).mockReturnValue(probeGate.promise)

    const poll = maybeMirrorWorld(NOW)
    // Let the poll actually reach and block on the probe.
    await Promise.resolve()
    expect(exportAll).not.toHaveBeenCalled()

    // Suspension begins now — inFlight is still null, so it takes effect
    // immediately, before the poll has even decided to export. The callback
    // stays blocked on its own gate so suspension is still raised later, when
    // the poll reaches its recheck (a callback that resolved instantly would
    // have already lifted the guard by then).
    const importGate = deferred<void>()
    let importStarted = false
    const suspended = withMirroringSuspended(async () => {
      importStarted = true
      await importGate.promise
    })
    await vi.waitFor(() => expect(importStarted).toBe(true))

    // Now let the poll's probe resolve as "settled and due". It proceeds to
    // exportAll() and, without the fix, would go on to commit — but suspension
    // is still raised at that point.
    probeGate.resolve(SETTLED)
    await poll

    expect(exportAll).toHaveBeenCalledTimes(1) // the export itself still ran…
    expect(writeWorldMirror).not.toHaveBeenCalled() // …but never reached disk

    importGate.resolve()
    await suspended
  })

  it('lets an already-in-flight export finish and commit before the suspended callback runs', async () => {
    // Here the export is genuinely in flight (inFlight is set) before
    // suspension is requested — withMirroringSuspended must wait for it, so
    // the callback (e.g. importAll's clear()) cannot race the write that is
    // already reading the tables it's about to clear.
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    const exportGate = deferred<string>()
    vi.mocked(exportAll).mockReturnValue(exportGate.promise)

    const poll = maybeMirrorWorld(NOW) // reaches run() -> write() -> exportAll()
    await vi.waitFor(() => expect(exportAll).toHaveBeenCalledTimes(1))

    let importStarted = false
    const suspended = withMirroringSuspended(async () => { importStarted = true })
    // Give the suspend call every chance to (wrongly) run its callback early.
    await Promise.resolve()
    await Promise.resolve()
    expect(importStarted).toBe(false) // must not start while the export is still pending

    exportGate.resolve('{"pages":[]}')
    await poll
    expect(writeWorldMirror).toHaveBeenCalledTimes(1) // the pre-suspend write commits cleanly

    await suspended
    expect(importStarted).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// I4 — a rejected write must land in mirror health, not vanish as an
// unhandled rejection off the fire-and-forget poll loop.
// ---------------------------------------------------------------------------
describe('I4: mirror health', () => {
  it('reports never-written health before any write has happened', () => {
    // The freshly-launched-app reading: no success, no error. Distinct from a
    // failure — Settings must not word this as something having gone wrong.
    expect(getMirrorHealth()).toEqual({ lastSuccessAt: null, lastError: null })
  })

  it('records a failed write instead of leaving it unhandled', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    vi.mocked(writeWorldMirror).mockRejectedValue(new Error('disk full'))

    await expect(maybeMirrorWorld(NOW)).rejects.toThrow('disk full')

    expect(getMirrorHealth()).toEqual({
      lastSuccessAt: null,
      lastError: { message: 'disk full', at: NOW },
    })
  })

  it('clears the recorded error once a later write succeeds', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    vi.mocked(writeWorldMirror).mockRejectedValueOnce(new Error('disk full'))
    await expect(maybeMirrorWorld(NOW)).rejects.toThrow('disk full')
    expect(getMirrorHealth().lastError).not.toBeNull()

    vi.mocked(writeWorldMirror).mockResolvedValue(true)
    // Past the floor from the (failed) attempt at NOW — lastMirrorAt was never
    // set by that attempt, so this is due regardless, but keep it realistic.
    await maybeMirrorWorld(NOW + MIRROR_FLOOR_MS + MIRROR_QUIET_MS + 2)

    expect(getMirrorHealth()).toEqual({
      lastSuccessAt: NOW + MIRROR_FLOOR_MS + MIRROR_QUIET_MS + 2,
      lastError: null,
    })
  })

  it('does not record a health change when the seam merely reports no write (browser path)', async () => {
    // writeWorldMirror resolving false (the browser, where there is no
    // filesystem to mirror to) is not a failure — nothing should land in
    // lastError for it.
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    vi.mocked(writeWorldMirror).mockResolvedValue(false)

    await maybeMirrorWorld(NOW)

    expect(getMirrorHealth()).toEqual({ lastSuccessAt: null, lastError: null })
  })

  it('the poll loop catches a rejected write instead of leaving it unhandled', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(SETTLED)
    vi.mocked(writeWorldMirror).mockRejectedValue(new Error('permission denied'))

    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const stop = startMirrorLoop()
    try {
      const tick = setIntervalSpy.mock.calls[0][0] as () => void
      // A rejection from the tick's void-called promise must never escape as
      // an unhandled rejection — if it did, this test process would report
      // one regardless of the assertion below.
      tick()
      await vi.waitFor(() => {
        expect(getMirrorHealth().lastError?.message).toBe('permission denied')
      })
    } finally {
      stop()
      setIntervalSpy.mockRestore()
    }
  })
})

describe('mirrorFilePath', () => {
  it('places the mirror under worlds/<loreId>.lore', () => {
    expect(mirrorFilePath('some-world')).toBe('worlds/some-world.lore')
  })

  it('defaults to the bound active world', () => {
    // activeLoreId is mocked to 'default' at the top of this file.
    expect(mirrorFilePath()).toBe('worlds/default.lore')
  })
})
