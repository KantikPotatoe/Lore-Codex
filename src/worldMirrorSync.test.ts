import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MIRROR_QUIET_MS, MIRROR_FLOOR_MS } from './worldMirror'

vi.mock('./platform', () => ({ writeWorldMirror: vi.fn(async () => true) }))
vi.mock('./db', () => ({ exportAll: vi.fn(async () => '{"pages":[]}') }))
vi.mock('./backup', () => ({ latestChangeTime: vi.fn(async () => 0) }))
vi.mock('./loreId', () => ({ currentLoreId: () => 'default' }))

import { writeWorldMirror } from './platform'
import { exportAll } from './db'
import { latestChangeTime } from './backup'
import {
  maybeMirrorWorld,
  flushWorldMirror,
  withMirroringSuspended,
  resetWorldMirrorStateForTests,
} from './worldMirrorSync'

const NOW = 1_000_000_000
const SETTLED = NOW - MIRROR_QUIET_MS - 1

beforeEach(() => {
  vi.clearAllMocks()
  resetWorldMirrorStateForTests()
  vi.mocked(writeWorldMirror).mockResolvedValue(true)
  vi.mocked(exportAll).mockResolvedValue('{"pages":[]}')
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
  it('writes even inside the quiet and floor windows', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(NOW - 1) // still "editing"
    await flushWorldMirror()
    // On close there is no later opportunity, so the windows do not apply.
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the world never changed', async () => {
    vi.mocked(latestChangeTime).mockResolvedValue(0)
    await flushWorldMirror()
    expect(writeWorldMirror).not.toHaveBeenCalled()
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
