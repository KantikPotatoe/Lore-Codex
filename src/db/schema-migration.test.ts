import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { LoreDB } from './schema'

// The v14 upgrade backfills the indexed titleLc field for pages written before it
// existed. The rest of the suite starts from an empty DB (fake-indexeddb runs the
// whole ladder at once), so it never exercises the real "old data on disk → open
// at the new version → upgrade runs" transition. Stage it explicitly here.
describe('schema v14 upgrade — titleLc backfill', () => {
  it('backfills titleLc (trimmed + lowercased) for pages created before the field', async () => {
    const name = 'lore-mig-v14-test'
    await Dexie.delete(name)

    // Stage a DB at the pre-titleLc pages schema and add a row with no titleLc.
    const old = new Dexie(name)
    old.version(13).stores({ pages: 'id, title, category, updatedAt' })
    await old.open()
    await old.table('pages').add({
      id: 'p1', title: '  Rivendell ', category: 'Place',
      content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
    })
    old.close()

    // Reopen the same database through the real class → Dexie runs the v14 upgrade.
    const upgraded = new LoreDB(name)
    await upgraded.open()
    const page = await upgraded.pages.get('p1')
    expect(page?.titleLc).toBe('rivendell')
    // And it's now reachable through the titleLc index the lookups use.
    const viaIndex = await upgraded.pages.where('titleLc').equals('rivendell').first()
    expect(viaIndex?.id).toBe('p1')

    upgraded.close()
    await Dexie.delete(name)
  })
})
