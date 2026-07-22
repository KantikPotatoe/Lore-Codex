import { describe, it, expect } from 'vitest'
import { mergeWorldIndex, markWorldMirrored, dropWorldFromIndex, type WorldIndexEntry } from './worldIndex'

const APP_VERSION = '1.4.0'

describe('mergeWorldIndex', () => {
  it('adds a registry-only world with mirroredAt: null (nothing has been mirrored yet)', () => {
    const result = mergeWorldIndex({
      onDisk: [],
      known: [{ id: 'a', name: 'Alpha' }],
      appVersion: APP_VERSION,
    })
    expect(result).toEqual([{ id: 'a', name: 'Alpha', mirroredAt: null, appVersion: APP_VERSION }])
  })

  // THE test that pins C1: on the launch after eviction, the registry DB is
  // empty. A disk-only world must survive a merge against that empty
  // registry — this is the entire point of the fix.
  it('keeps a disk-only world when merged against an empty registry (the eviction case)', () => {
    const onDisk: WorldIndexEntry[] = [
      { id: 'evicted', name: 'Aethel', mirroredAt: 1_000, appVersion: '1.3.0' },
    ]
    const result = mergeWorldIndex({ onDisk, known: [], appVersion: APP_VERSION })
    expect(result).toEqual(onDisk)
  })

  it('keeps the disk mirroredAt/appVersion but takes the registry name (renames propagate)', () => {
    const onDisk: WorldIndexEntry[] = [
      { id: 'a', name: 'Old Name', mirroredAt: 500, appVersion: '1.3.0' },
    ]
    const result = mergeWorldIndex({
      onDisk,
      known: [{ id: 'a', name: 'New Name' }],
      appVersion: APP_VERSION,
    })
    expect(result).toEqual([{ id: 'a', name: 'New Name', mirroredAt: 500, appVersion: '1.3.0' }])
  })

  it('collapses duplicate ids on disk to one entry', () => {
    const onDisk: WorldIndexEntry[] = [
      { id: 'a', name: 'First', mirroredAt: 1, appVersion: '1.0.0' },
      { id: 'a', name: 'Second', mirroredAt: 2, appVersion: '1.1.0' },
    ]
    const result = mergeWorldIndex({ onDisk, known: [], appVersion: APP_VERSION })
    expect(result).toHaveLength(1)
  })

  it('is a straight union: unrelated registry and disk worlds both survive', () => {
    const onDisk: WorldIndexEntry[] = [
      { id: 'disk-only', name: 'Disk World', mirroredAt: 9, appVersion: '1.0.0' },
    ]
    const result = mergeWorldIndex({
      onDisk,
      known: [{ id: 'registry-only', name: 'Registry World' }],
      appVersion: APP_VERSION,
    })
    expect(result.map((w) => w.id).sort()).toEqual(['disk-only', 'registry-only'])
  })
})

describe('markWorldMirrored', () => {
  it('sets only its own entry, leaving others untouched', () => {
    const index: WorldIndexEntry[] = [
      { id: 'a', name: 'Alpha', mirroredAt: null, appVersion: null },
      { id: 'b', name: 'Beta', mirroredAt: 5, appVersion: '1.0.0' },
    ]
    const result = markWorldMirrored(index, 'a', 'Alpha', 999, '1.4.0')
    expect(result).toContainEqual({ id: 'a', name: 'Alpha', mirroredAt: 999, appVersion: '1.4.0' })
    expect(result).toContainEqual({ id: 'b', name: 'Beta', mirroredAt: 5, appVersion: '1.0.0' })
  })

  it('inserts the entry when the world was absent from the index', () => {
    const result = markWorldMirrored([], 'new', 'New World', 100, '1.4.0')
    expect(result).toEqual([{ id: 'new', name: 'New World', mirroredAt: 100, appVersion: '1.4.0' }])
  })
})

describe('dropWorldFromIndex', () => {
  it('removes only the named id', () => {
    const index: WorldIndexEntry[] = [
      { id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' },
      { id: 'b', name: 'Beta', mirroredAt: 2, appVersion: '1.0.0' },
    ]
    expect(dropWorldFromIndex(index, 'a').map((w) => w.id)).toEqual(['b'])
  })

  it('is a no-op when the id is not present', () => {
    const index: WorldIndexEntry[] = [{ id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' }]
    expect(dropWorldFromIndex(index, 'missing')).toEqual(index)
  })
})
