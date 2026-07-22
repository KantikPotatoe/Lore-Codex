import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('./platform', () => ({
  readRegistryMirror: vi.fn(async () => null),
  writeRegistryMirror: vi.fn(async () => true),
  trashWorldMirror: vi.fn(async () => true),
}))

import {
  registry,
  bootstrapDefaultLore,
  listLores,
  getLore,
  registerLore,
  importLoreFromBackup,
  syncRegistryMirror,
  deleteLore,
} from './lores'
import { readRegistryMirror, writeRegistryMirror } from './platform'
import { LoreDB, CURRENT_SCHEMA_VERSION } from './db'
import { dbNameFor } from './loreId'

beforeEach(async () => {
  localStorage.clear()
  await registry.lores.clear()
  vi.clearAllMocks()
  vi.mocked(readRegistryMirror).mockResolvedValue(null)
  vi.mocked(writeRegistryMirror).mockResolvedValue(true)
})

describe('bootstrapDefaultLore', () => {
  it('seeds a default world on a fresh install (empty registry, never bootstrapped)', async () => {
    await bootstrapDefaultLore()
    const lores = await listLores()
    expect(lores).toHaveLength(1)
    expect(lores[0].id).toBe('default')
  })

  it('does NOT re-seed once the user has deleted every world', async () => {
    // First run seeds the default world…
    await bootstrapDefaultLore()
    expect(await listLores()).toHaveLength(1)

    // …user deletes all worlds (registry emptied, but bootstrap already ran once).
    await registry.lores.clear()

    // A subsequent app start must leave the registry empty so the landing
    // page can show the empty state, instead of silently recreating a world.
    await bootstrapDefaultLore()
    expect(await listLores()).toHaveLength(0)
  })

  it('is idempotent when a world already exists', async () => {
    await bootstrapDefaultLore()
    await bootstrapDefaultLore()
    expect(await listLores()).toHaveLength(1)
  })

  // React StrictMode invokes the startup effect twice in dev, so this runs
  // concurrently on a fresh install. The localStorage flag is only set after the
  // async add, so both calls pass the guard and both add id:'default' — the loser
  // hits a duplicate-key ConstraintError unless concurrent calls are serialized.
  it('is safe under concurrent invocation (no duplicate-key error)', async () => {
    await Promise.all([bootstrapDefaultLore(), bootstrapDefaultLore()])
    expect(await listLores()).toHaveLength(1)
  })
})

describe('registerLore', () => {
  it('adds a world to the registry without switching to it', async () => {
    const before = localStorage.getItem('current-lore-id')
    const id = await registerLore('Side World')
    expect((await getLore(id))?.name).toBe('Side World')
    // No switch: the active-world pointer is untouched (createLore switches;
    // the wizard must not until the import has landed).
    expect(localStorage.getItem('current-lore-id')).toBe(before)
  })

  it('falls back to a default name for blank input', async () => {
    const id = await registerLore('   ')
    expect((await getLore(id))?.name).toBe('Untitled World')
  })
})

describe('importLoreFromBackup — the migration wizard core', () => {
  it("registers a world and imports the backup into that world's own DB", async () => {
    const json = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pages: [{
        id: 'p1', title: 'Migrated Page', category: 'Character', content: '',
        summary: '', status: 'Draft', tags: [], createdAt: 1, updatedAt: 1,
      }],
    })

    const id = await importLoreFromBackup('Migrated World', json)

    expect((await getLore(id))?.name).toBe('Migrated World')
    const target = new LoreDB(dbNameFor(id))
    try {
      expect(await target.pages.get('p1')).toMatchObject({ title: 'Migrated Page' })
    } finally {
      await target.delete()
    }
  })

  it('does not register a world when the backup is invalid', async () => {
    const before = (await listLores()).length
    await expect(importLoreFromBackup('Broken', 'not json')).rejects.toThrow()
    expect((await listLores()).length).toBe(before)
  })
})

// #174 C1: the on-disk index must be a union of disk + registry, never a
// replacement — a replacement erases, on the launch right after an eviction,
// the only pointers to the .lore files that survived the eviction.
describe('syncRegistryMirror — the index is a union, never a replacement (#174 C1)', () => {
  it('keeps a world known only to disk when the registry is empty (the eviction case)', async () => {
    // registry.lores is empty (beforeEach clears it) — this is exactly the
    // state right after an eviction: the registry DB is gone, but the
    // on-disk index (and the .lore files it names) survived.
    vi.mocked(readRegistryMirror).mockResolvedValue(JSON.stringify([
      { id: 'evicted', name: 'Aethel', mirroredAt: 1000, appVersion: '1.3.0' },
    ]))

    await syncRegistryMirror()

    expect(writeRegistryMirror).toHaveBeenCalledTimes(1)
    const written = JSON.parse(vi.mocked(writeRegistryMirror).mock.calls[0][0] as string)
    expect(written).toEqual([
      { id: 'evicted', name: 'Aethel', mirroredAt: 1000, appVersion: '1.3.0' },
    ])
  })

  it('adds a registry-only world alongside whatever is already on disk', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue(JSON.stringify([
      { id: 'evicted', name: 'Aethel', mirroredAt: 1000, appVersion: '1.3.0' },
    ]))
    await registry.lores.add({
      id: 'fresh', name: 'Fresh World', banner: null, createdAt: 1, updatedAt: 1,
    })

    await syncRegistryMirror()

    const written = JSON.parse(vi.mocked(writeRegistryMirror).mock.calls[0][0] as string)
    expect(written.map((w: { id: string }) => w.id).sort()).toEqual(['evicted', 'fresh'])
  })
})

describe('deleteLore', () => {
  it('drops the deleted world from the on-disk index (the only way an entry leaves it)', async () => {
    const id = await registerLore('Doomed World') // not the active lore, so no reload fires
    vi.mocked(readRegistryMirror).mockResolvedValue(JSON.stringify([
      { id, name: 'Doomed World', mirroredAt: 500, appVersion: '1.0.0' },
      { id: 'untouched', name: 'Other World', mirroredAt: 10, appVersion: '1.0.0' },
    ]))
    vi.mocked(writeRegistryMirror).mockClear()

    await deleteLore(id)

    const written = JSON.parse(vi.mocked(writeRegistryMirror).mock.calls.at(-1)![0] as string)
    expect(written.map((w: { id: string }) => w.id)).toEqual(['untouched'])
  })
})
