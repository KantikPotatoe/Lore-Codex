import { describe, it, expect, beforeEach } from 'vitest'
import {
  registry,
  bootstrapDefaultLore,
  listLores,
  getLore,
  registerLore,
  importLoreFromBackup,
} from './lores'
import { LoreDB, CURRENT_SCHEMA_VERSION } from './db'
import { dbNameFor } from './loreId'

beforeEach(async () => {
  localStorage.clear()
  await registry.lores.clear()
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
