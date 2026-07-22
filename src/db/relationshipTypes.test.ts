import { describe, it, expect, beforeEach } from 'vitest'
import {
  BUILTIN_RELATIONSHIP_TYPES,
  seedRelationshipTypes,
  getRelationshipTypes,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
  resetRelationshipType,
} from './relationshipTypes'
import { db } from '../db'

beforeEach(async () => {
  await db.relationshipTypes.clear()
  await db.relationships.clear()
})

describe('seedRelationshipTypes', () => {
  it('seeds the built-in vocabulary in order', async () => {
    await seedRelationshipTypes()
    const types = await getRelationshipTypes()
    expect(types.map((t) => t.id)).toEqual(BUILTIN_RELATIONSHIP_TYPES.map((t) => t.id))
    expect(types.every((t) => t.builtin)).toBe(true)
  })

  // React StrictMode invokes the startup effect twice in dev, so this can run
  // concurrently against a fresh DB. Mirrors the seedTemplates concurrency test.
  it('is safe under concurrent invocation (no BulkError, no duplicates)', async () => {
    await Promise.all([seedRelationshipTypes(), seedRelationshipTypes()])
    expect(await db.relationshipTypes.count()).toBe(BUILTIN_RELATIONSHIP_TYPES.length)
  })

  it('re-adds a missing built-in without touching custom types', async () => {
    await seedRelationshipTypes()
    await createRelationshipType({ label: 'Mentor of', inverse: 'Student of', group: 'social' })
    await db.relationshipTypes.delete('ally-of')

    await seedRelationshipTypes()

    const types = await getRelationshipTypes()
    expect(types.some((t) => t.id === 'ally-of')).toBe(true)
    expect(types.filter((t) => t.label === 'Mentor of')).toHaveLength(1)
  })

  it('leaves an edited built-in alone', async () => {
    await seedRelationshipTypes()
    await updateRelationshipType('enemy-of', { label: 'Sworn enemy of' })
    await seedRelationshipTypes()
    expect((await db.relationshipTypes.get('enemy-of'))?.label).toBe('Sworn enemy of')
  })
})

describe('createRelationshipType', () => {
  it('appends after the highest existing order, not the count', async () => {
    await seedRelationshipTypes()
    const highest = BUILTIN_RELATIONSHIP_TYPES.length - 1
    await db.relationshipTypes.delete('parent-of') // count drops, max order does not

    const id = await createRelationshipType({
      label: 'Rival of', inverse: 'Rival of', group: 'social',
    })

    expect((await db.relationshipTypes.get(id))?.order).toBe(highest + 1)
  })

  it('creates a custom type that is not builtin', async () => {
    const id = await createRelationshipType({
      label: 'Created by', inverse: 'Creator of', group: 'other',
    })
    const type = await db.relationshipTypes.get(id)
    expect(type?.builtin).toBe(false)
    expect(type?.inverse).toBe('Creator of')
  })
})

describe('deleteRelationshipType', () => {
  it('refuses to delete a built-in', async () => {
    await seedRelationshipTypes()
    await deleteRelationshipType('parent-of')
    expect(await db.relationshipTypes.get('parent-of')).toBeDefined()
  })

  it('deletes a custom type and cascades its relationships', async () => {
    const id = await createRelationshipType({
      label: 'Rival of', inverse: 'Rival of', group: 'social',
    })
    await db.relationships.add({
      id: 'r1', fromId: 'a', toId: 'b', typeId: id, note: '', createdAt: 1,
    })
    await db.relationships.add({
      id: 'r2', fromId: 'a', toId: 'c', typeId: 'other-type', note: '', createdAt: 2,
    })

    await deleteRelationshipType(id)

    expect(await db.relationshipTypes.get(id)).toBeUndefined()
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual(['r2'])
  })
})

describe('resetRelationshipType', () => {
  it('restores a built-in to its shipped labels and colour', async () => {
    await seedRelationshipTypes()
    await updateRelationshipType('parent-of', { label: 'Sire of', color: '#000000' })

    await resetRelationshipType('parent-of')

    const type = await db.relationshipTypes.get('parent-of')
    const shipped = BUILTIN_RELATIONSHIP_TYPES.find((t) => t.id === 'parent-of')!
    expect(type?.label).toBe(shipped.label)
    expect(type?.color).toBe(shipped.color)
  })
})
