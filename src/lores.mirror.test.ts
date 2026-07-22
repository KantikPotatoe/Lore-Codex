import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DiskRegistryRead } from './worldRecovery'

// A stateful fake of the on-disk index, not just a call-counting stub: the
// whole point of this file is the union-vs-drop distinction (#174), and a
// mock where readRegistryMirror always resolves the same thing can't tell
// "removed the entry" from "never wrote it" — every test would pass whether
// the code drops a ghost entry or merely re-syncs over it. mirrorDisk holds
// what was last "written" (the real envelope-shaped JSON serializeDiskRegistry
// produces); readRegistryMirror hands that back as a DiskRegistryRead, so it
// can ALSO represent the failure modes #174's second round of fixes closes:
// `mirrorDisk.text === null` is a genuinely absent file (never written this
// test), and `mirrorDisk.forceError` makes the next read report `'error'`
// instead of guessing "absent" — the one shape a stateless mock (always
// resolving null) could never produce, and the one Defect 1's fix exists to
// tell apart from a real absence. vi.hoisted() is required because vi.mock()
// factories are hoisted above regular imports/consts.
const mirrorDisk = vi.hoisted(() => ({ text: null as string | null, forceError: false }))

vi.mock('./platform', async (importOriginal) => ({
  // withRegistryMirrorLock is passed through UNMOCKED (real platform.ts
  // implementation) via importOriginal, not reimplemented here — the whole
  // point of the concurrency test below is to be a mutation-proof of that
  // real lock. A hand-rolled duplicate in this mock would make that test
  // pass or fail independently of whether platform.ts's actual lock works.
  ...(await importOriginal<typeof import('./platform')>()),
  readRegistryMirror: vi.fn(async (): Promise<DiskRegistryRead> => {
    if (mirrorDisk.forceError) return { status: 'error' }
    return mirrorDisk.text === null ? { status: 'absent' } : { status: 'ok', text: mirrorDisk.text }
  }),
  writeRegistryMirror: vi.fn(async (json: string) => {
    mirrorDisk.text = json
    return true
  }),
  trashWorldMirror: vi.fn(async () => true),
}))

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  importBackupInto: vi.fn(async () => {
    throw new Error('import failed')
  }),
}))

import { readRegistryMirror, writeRegistryMirror } from './platform'
import { registry } from './registryDb'
import { syncRegistryMirror, registerLore, deleteLore, importLoreFromBackup } from './lores'
import { CURRENT_SCHEMA_VERSION } from './db'

function worldsOf(json: string | null): Array<Record<string, unknown>> {
  if (!json) return []
  const parsed = JSON.parse(json) as { worlds: Array<Record<string, unknown>> }
  return parsed.worlds
}

beforeEach(async () => {
  vi.clearAllMocks() // clears call history, NOT a mockImplementation override from a prior test
  mirrorDisk.text = null
  mirrorDisk.forceError = false
  // Re-assert the stateful implementations every test: the "trashes before
  // re-indexing" test below overrides writeRegistryMirror/trashWorldMirror
  // with its own mockImplementation to observe call order, and clearAllMocks()
  // does not undo that — without this, every test after it would silently
  // stop updating mirrorDisk, and the union-vs-drop assertions would pass
  // vacuously again.
  vi.mocked(readRegistryMirror).mockImplementation(async (): Promise<DiskRegistryRead> => {
    if (mirrorDisk.forceError) return { status: 'error' }
    return mirrorDisk.text === null ? { status: 'absent' } : { status: 'ok', text: mirrorDisk.text }
  })
  vi.mocked(writeRegistryMirror).mockImplementation(async (json: string) => {
    mirrorDisk.text = json
    return true
  })
  const { trashWorldMirror } = await import('./platform')
  vi.mocked(trashWorldMirror).mockImplementation(async () => true)
  await registry.lores.clear()
})

describe('syncRegistryMirror', () => {
  // #174 second bug: mirroredAt must NEVER be stamped for a world that has
  // not actually been mirrored — only a real mirror write may set it
  // (worldMirrorSync.ts's markWorldMirrored). A registry-only world with no
  // disk entry yet is exactly that case.
  it('writes a registry-only world with mirroredAt: null (nothing has been mirrored yet)', async () => {
    await registry.lores.add({
      id: 'default', name: 'Aethel', banner: null, createdAt: 1, updatedAt: 2,
    })
    await syncRegistryMirror()

    const written = worldsOf(vi.mocked(writeRegistryMirror).mock.calls[0][0])
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe('default')
    expect(written[0].name).toBe('Aethel')
    expect(written[0].mirroredAt).toBeNull()
  })

  it('omits the banner image bytes', async () => {
    await registry.lores.add({
      id: 'default', name: 'Aethel', banner: 'data:image/png;base64,AAAA',
      createdAt: 1, updatedAt: 2,
    })
    await syncRegistryMirror()
    const json = vi.mocked(writeRegistryMirror).mock.calls[0][0]
    // The index is read on every launch; a megabyte of banner data URLs in it
    // would be paid for on every start for no recovery benefit.
    expect(json).not.toContain('base64')
  })

  // Writes the envelope shape, not a bare array — #174 Defect 3. A bare array
  // written today would be indistinguishable from "no version field", which
  // is exactly the legacy shape a future build reads via migration; the
  // format going forward must be self-describing.
  it('writes the version envelope, not a bare array', async () => {
    await registry.lores.add({
      id: 'default', name: 'Aethel', banner: null, createdAt: 1, updatedAt: 2,
    })
    await syncRegistryMirror()
    const json = vi.mocked(writeRegistryMirror).mock.calls[0][0]
    const parsed = JSON.parse(json) as { version: unknown; worlds: unknown }
    expect(typeof parsed.version).toBe('number')
    expect(Array.isArray(parsed.worlds)).toBe(true)
  })

  // #174 Defect 1: a read failure must never be treated as "the disk has
  // nothing" — that turns a transient failure into a permanent, silent loss
  // of every disk-only entry. This is exactly the failure mode a stateless
  // `readRegistryMirror` mock (always resolving the same value) could never
  // represent — it needs the fake to be able to report a genuine error.
  it('refuses to write when the disk read fails, instead of writing an empty/shrunk index', async () => {
    // Seed the disk with a world the registry does NOT know about — the
    // eviction case. If the read failure is mishandled as "empty", the next
    // write would drop this entry forever.
    mirrorDisk.text = JSON.stringify({
      version: 1,
      worlds: [{ id: 'evicted', name: 'Aethel', mirroredAt: 1000, appVersion: '1.3.0' }],
    })
    mirrorDisk.forceError = true

    await syncRegistryMirror()

    expect(writeRegistryMirror).not.toHaveBeenCalled()
    // The disk itself is untouched — still has the survivor.
    expect(worldsOf(mirrorDisk.text).map((w) => w.id)).toEqual(['evicted'])
  })
})

describe('registerLore', () => {
  it('refreshes the mirrored index so a new world is recoverable', async () => {
    await registerLore('Second World')
    expect(writeRegistryMirror).toHaveBeenCalled()
  })
})

describe('deleteLore', () => {
  it('trashes the world mirror and refreshes the index', async () => {
    await registry.lores.add({
      id: 'doomed', name: 'Doomed', banner: null, createdAt: 1, updatedAt: 2,
    })
    vi.clearAllMocks()
    await deleteLore('doomed')

    const { trashWorldMirror } = await import('./platform')
    // Both matter: trashing alone would leave the index advertising a world
    // whose file has moved, and refreshing alone would delete the only copy.
    expect(trashWorldMirror).toHaveBeenCalledWith('doomed', expect.any(String))
    expect(writeRegistryMirror).toHaveBeenCalled()
    const json = vi.mocked(writeRegistryMirror).mock.calls.at(-1)![0]
    expect(json).not.toContain('doomed')
  })

  it('trashes the world mirror before re-indexing', async () => {
    await registry.lores.add({
      id: 'doomed', name: 'Doomed', banner: null, createdAt: 1, updatedAt: 2,
    })
    const order: string[] = []
    const { trashWorldMirror } = await import('./platform')
    vi.mocked(trashWorldMirror).mockImplementation(async () => {
      order.push('trash')
      return true
    })
    vi.mocked(writeRegistryMirror).mockImplementation(async () => {
      order.push('reindex')
      return true
    })

    await deleteLore('doomed')

    // If the order were reversed and the process died between the two steps,
    // registry.json would advertise a world whose file is gone, and recovery
    // would offer to restore it. Trash must come first.
    expect(order).toEqual(['trash', 'reindex'])
  })
})

describe('importLoreFromBackup — rollback drops the disk-only ghost entry (#174)', () => {
  it('leaves no entry for the rolled-back world in the on-disk index, and rethrows the original error', async () => {
    const json = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, pages: [] })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(
      'doomed-uuid' as `${string}-${string}-${string}-${string}-${string}`,
    )

    await expect(importLoreFromBackup('Doomed Import', json)).rejects.toThrow('import failed')

    // registerLore's own sync writes the new id into the disk index first
    // (mirroredAt: null, since nothing was ever mirrored). By the time the
    // rollback runs, the registry entry is already deleted, so a plain
    // syncRegistryMirror() (a union) would keep this id — union semantics
    // only ever ADD or update entries from the registry's "known" set, never
    // remove ones the registry no longer has. Only an explicit drop can
    // remove it. This is what a stateless readRegistryMirror() mock (always
    // resolving the same value) could never catch: this assertion needs the
    // disk to actually remember what was written.
    expect(vi.mocked(writeRegistryMirror).mock.calls.length).toBeGreaterThanOrEqual(2)
    const finalWorlds = worldsOf(mirrorDisk.text)
    expect(finalWorlds.find((e) => e.id === 'doomed-uuid')).toBeUndefined()
    expect(finalWorlds).toEqual([])
  })
})

// #174 Defect 2: syncRegistryMirror, dropFromRegistryMirror (via deleteLore)
// and stampRegistryMirrored (worldMirrorSync.ts, not reachable from lores.ts
// alone) are three independent read-modify-write sequences against the same
// registry.json. This proves the lores.ts-reachable pair of them —
// syncRegistryMirror and deleteLore's drop — cannot interleave into a lost
// update when their read-modify-write windows overlap.
describe('concurrent registry.json writers do not lose an update (#174 Defect 2)', () => {
  it('a drop that races an in-flight sync still lands, instead of being undone by the sync\'s stale write', async () => {
    // Seed the disk with two worlds. 'doomed' is known ONLY to disk (not in
    // the registry) — exactly the union-preserving case syncRegistryMirror
    // exists for, which is also what makes it vulnerable: an in-flight sync
    // that read the disk before the drop committed will write 'doomed' right
    // back.
    mirrorDisk.text = JSON.stringify({
      version: 1,
      worlds: [
        { id: 'keep', name: 'Keep', mirroredAt: 1, appVersion: '1.0.0' },
        { id: 'doomed', name: 'Doomed', mirroredAt: 2, appVersion: '1.0.0' },
      ],
    })
    await registry.lores.add({ id: 'keep', name: 'Keep', banner: null, createdAt: 1, updatedAt: 1 })

    // Gate exactly the FIRST writeRegistryMirror call (sync's) so its write
    // stays pending while deleteLore's drop is attempted concurrently. Later
    // calls (the drop's own write) resolve immediately, as normal.
    let releaseFirstWrite: () => void = () => {}
    const gate = new Promise<void>((resolve) => { releaseFirstWrite = resolve })
    let writeCount = 0
    vi.mocked(writeRegistryMirror).mockImplementation(async (json: string) => {
      writeCount++
      if (writeCount === 1) await gate
      mirrorDisk.text = json
      return true
    })

    const syncPromise = syncRegistryMirror() // reads+merges (still has 'doomed'), then blocks on its write
    // Wait until sync has actually reached (and is blocked on) its write —
    // deterministic regardless of how many task-queue hops the underlying
    // listLores()/readRegistryMirror() calls need, unlike a fixed count of
    // Promise.resolve() flushes.
    await vi.waitFor(() => expect(writeCount).toBeGreaterThanOrEqual(1))

    const deletePromise = deleteLore('doomed') // wants to drop 'doomed'

    // Give any unserialized concurrent work (deleteLore's real Dexie calls,
    // then dropFromRegistryMirror's own read+write) every real chance to run
    // to completion before the gate opens — this is exactly the window an
    // unserialized drop would use to finish first.
    await new Promise((resolve) => setTimeout(resolve, 20))

    releaseFirstWrite()
    await Promise.all([syncPromise, deletePromise])

    const finalIds = worldsOf(mirrorDisk.text).map((w) => w.id)
    expect(finalIds).not.toContain('doomed')
    expect(finalIds).toContain('keep')
  })
})
