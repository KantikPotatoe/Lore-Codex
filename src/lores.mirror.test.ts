import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./platform', () => ({
  writeRegistryMirror: vi.fn(async () => true),
  trashWorldMirror: vi.fn(async () => true),
}))

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  importBackupInto: vi.fn(async () => {
    throw new Error('import failed')
  }),
}))

import { writeRegistryMirror, trashWorldMirror } from './platform'
import { registry } from './registryDb'
import { syncRegistryMirror, registerLore, deleteLore, importLoreFromBackup } from './lores'
import { CURRENT_SCHEMA_VERSION } from './db'

beforeEach(async () => {
  vi.clearAllMocks()
  await registry.lores.clear()
})

describe('syncRegistryMirror', () => {
  it('writes every world with its name and freshness metadata', async () => {
    await registry.lores.add({
      id: 'default', name: 'Aethel', banner: null, createdAt: 1, updatedAt: 2,
    })
    await syncRegistryMirror()

    const json = vi.mocked(writeRegistryMirror).mock.calls[0][0]
    const parsed = JSON.parse(json) as Array<Record<string, unknown>>
    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('default')
    expect(parsed[0].name).toBe('Aethel')
    // Displayed in the restore panel, so the user knows how fresh a world is.
    expect(typeof parsed[0].mirroredAt).toBe('number')
    expect(typeof parsed[0].appVersion).toBe('string')
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

describe('importLoreFromBackup — rollback re-syncs the index (#174)', () => {
  it('re-syncs the index after rolling back a failed import, and rethrows the original error', async () => {
    const json = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, pages: [] })

    await expect(importLoreFromBackup('Doomed Import', json)).rejects.toThrow('import failed')

    // registerLore's own sync (writing the new id in), then the rollback's
    // re-sync (writing it back out) — both must happen, or the index is
    // left advertising an id the registry no longer knows about.
    expect(vi.mocked(writeRegistryMirror).mock.calls.length).toBeGreaterThanOrEqual(2)
    const lastJson = vi.mocked(writeRegistryMirror).mock.calls.at(-1)![0]
    expect(lastJson).not.toContain('Doomed Import')
  })
})
