import { describe, it, expect, vi, beforeEach } from 'vitest'

// A stateful fake of the on-disk index, not just a call-counting stub: the
// whole point of this file is the union-vs-drop distinction (#174), and a
// mock where readRegistryMirror always resolves null can't tell "removed the
// entry" from "never wrote it" — every test would pass whether the code drops
// a ghost entry or merely re-syncs over it. mirrorDisk holds what was last
// "written"; readRegistryMirror hands that back. vi.hoisted() is required
// because vi.mock() factories are hoisted above regular imports/consts.
const mirrorDisk = vi.hoisted(() => ({ text: null as string | null }))

vi.mock('./platform', () => ({
  readRegistryMirror: vi.fn(async () => mirrorDisk.text),
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

import { readRegistryMirror, writeRegistryMirror, trashWorldMirror } from './platform'
import { registry } from './registryDb'
import { syncRegistryMirror, registerLore, deleteLore, importLoreFromBackup } from './lores'
import { CURRENT_SCHEMA_VERSION } from './db'

beforeEach(async () => {
  vi.clearAllMocks() // clears call history, NOT a mockImplementation override from a prior test
  mirrorDisk.text = null
  // Re-assert the stateful implementations every test: the "trashes before
  // re-indexing" test below overrides writeRegistryMirror/trashWorldMirror
  // with its own mockImplementation to observe call order, and clearAllMocks()
  // does not undo that — without this, every test after it would silently
  // stop updating mirrorDisk, and the union-vs-drop assertions would pass
  // vacuously again.
  vi.mocked(readRegistryMirror).mockImplementation(async () => mirrorDisk.text)
  vi.mocked(writeRegistryMirror).mockImplementation(async (json: string) => {
    mirrorDisk.text = json
    return true
  })
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

    const json = vi.mocked(writeRegistryMirror).mock.calls[0][0]
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('default')
    expect(parsed[0].name).toBe('Aethel')
    expect(parsed[0].mirroredAt).toBeNull()
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
    // resolving null) could never catch: this assertion needs the disk to
    // actually remember what was written.
    expect(vi.mocked(writeRegistryMirror).mock.calls.length).toBeGreaterThanOrEqual(2)
    const finalDisk = JSON.parse(mirrorDisk.text ?? '[]') as Array<{ id: string; name: string }>
    expect(finalDisk.find((e) => e.id === 'doomed-uuid')).toBeUndefined()
    expect(finalDisk).toEqual([])
  })
})
