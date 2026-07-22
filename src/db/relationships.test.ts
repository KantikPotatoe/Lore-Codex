import { describe, it, expect, beforeEach } from 'vitest'
import {
  addRelationship,
  removeRelationship,
  updateRelationshipNote,
  getRelationsFor,
} from './relationships'
import { seedRelationshipTypes } from './relationshipTypes'
import { db } from '../db'
import type { LorePage } from '../db'

function page(id: string, title: string): LorePage {
  return {
    id, title, titleLc: title.toLowerCase(), category: 'Character',
    content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
  }
}

beforeEach(async () => {
  await db.relationships.clear()
  await db.relationshipTypes.clear()
  await db.pages.clear()
  await seedRelationshipTypes()
  await db.pages.bulkAdd([
    page('uther', 'Uther'), page('arthur', 'Arthur'), page('igraine', 'Igraine'),
  ])
})

describe('addRelationship guards', () => {
  it('refuses a self-relation', async () => {
    expect(await addRelationship('uther', 'uther', 'parent-of')).toBeNull()
    expect(await db.relationships.count()).toBe(0)
  })

  it('refuses an exact duplicate', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    expect(await addRelationship('uther', 'arthur', 'parent-of')).toBeNull()
    expect(await db.relationships.count()).toBe(1)
  })

  it('allows the opposite direction of an asymmetric type', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    expect(await addRelationship('arthur', 'uther', 'parent-of')).not.toBeNull()
    expect(await db.relationships.count()).toBe(2)
  })

  it('refuses the opposite direction of a SYMMETRIC type — same fact', async () => {
    await addRelationship('uther', 'igraine', 'spouse-of')
    expect(await addRelationship('igraine', 'uther', 'spouse-of')).toBeNull()
    expect(await db.relationships.count()).toBe(1)
  })

  it('refuses an unknown type', async () => {
    expect(await addRelationship('uther', 'arthur', 'no-such-type')).toBeNull()
  })
})

describe('getRelationsFor', () => {
  it('merges both directions into one list with the right labels', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')

    const fromUther = await getRelationsFor('uther')
    expect(fromUther.map((r) => [r.label, r.other.title])).toEqual([['Parent of', 'Arthur']])

    const fromArthur = await getRelationsFor('arthur')
    expect(fromArthur.map((r) => [r.label, r.other.title])).toEqual([['Child of', 'Uther']])
  })

  it('sorts by type order, then by the other page title', async () => {
    await addRelationship('uther', 'igraine', 'spouse-of') // order 2
    await addRelationship('uther', 'arthur', 'parent-of') // order 0

    const rows = await getRelationsFor('uther')
    expect(rows.map((r) => r.other.title)).toEqual(['Arthur', 'Igraine'])
  })

  // The sort's first tier (type.order) is exercised above; on its own that test
  // stays green with the title tiebreak deleted. This case pins the second tier
  // alone: every row shares one type, so ordering can come from nothing else.
  //
  // The row ids are explicit, and deliberately ordered so that pre-sort
  // retrieval order is the REVERSE of the expected one. addRelationship mints
  // a uuid, and Dexie returns index matches in primary-key order — so with
  // random ids this assertion would pass ~1 run in 6 with a broken comparator.
  // Seeding the rows directly is what makes the mutation deterministic.
  //
  // Lowercase 'bors' also pins the case-folding: a raw localeCompare without
  // toLowerCase() sorts it after both capitalised titles.
  it('breaks ties on the other page title, case-insensitively', async () => {
    await db.pages.bulkAdd([
      page('cador', 'Cador'), page('bors', 'bors'), page('agravain', 'Agravain'),
    ])
    await db.relationships.bulkAdd([
      { id: 'r1', fromId: 'uther', toId: 'cador', typeId: 'ally-of', note: '', createdAt: 1 },
      { id: 'r2', fromId: 'uther', toId: 'bors', typeId: 'ally-of', note: '', createdAt: 2 },
      { id: 'r3', fromId: 'uther', toId: 'agravain', typeId: 'ally-of', note: '', createdAt: 3 },
    ])

    const rows = await getRelationsFor('uther')
    expect(rows.map((r) => r.other.title)).toEqual(['Agravain', 'bors', 'Cador'])
  })

  it('skips rows whose other page no longer exists', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    await db.pages.delete('arthur')
    expect(await getRelationsFor('uther')).toEqual([])
  })

  it('carries the note through', async () => {
    const id = await addRelationship('uther', 'igraine', 'spouse-of', 'm. 1042–1067')
    expect((await getRelationsFor('uther'))[0].row.note).toBe('m. 1042–1067')

    await updateRelationshipNote(id!, 'annulled')
    expect((await getRelationsFor('uther'))[0].row.note).toBe('annulled')
  })
})

describe('removeRelationship', () => {
  it('removes by row id, so it works from either end', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    const seenFromArthur = await getRelationsFor('arthur')

    await removeRelationship(seenFromArthur[0].row.id)

    expect(await getRelationsFor('uther')).toEqual([])
  })
})

describe('deletePage cascade', () => {
  it('drops relationships on both endpoints', async () => {
    const { deletePage } = await import('./pages')
    await addRelationship('uther', 'arthur', 'parent-of') // arthur is the `to`
    await addRelationship('arthur', 'igraine', 'sibling-of') // arthur is the `from`

    await deletePage('arthur')

    expect(await db.relationships.count()).toBe(0)
  })
})
