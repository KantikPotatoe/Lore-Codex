import { describe, it, expect } from 'vitest'
import { parseDiskRegistry, plannedRecovery } from './worldRecovery'

describe('parseDiskRegistry', () => {
  it('reads a well-formed index', () => {
    const text = JSON.stringify([
      { id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' },
    ])
    expect(parseDiskRegistry(text)).toEqual([
      { id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' },
    ])
  })

  it('treats an absent registry as nothing to recover', () => {
    expect(parseDiskRegistry(null)).toEqual([])
  })

  // The file is on disk where anything could have happened to it; a corrupt
  // index must degrade to "no offer", never crash the lore selector.
  it('survives malformed input', () => {
    expect(parseDiskRegistry('not json')).toEqual([])
    expect(parseDiskRegistry('{"not":"an array"}')).toEqual([])
    expect(parseDiskRegistry('[]')).toEqual([])
    // Array elements can themselves be anything JSON allows — null, nested
    // arrays, bare numbers — and none of them is an object with a usable id.
    expect(parseDiskRegistry('[null]')).toEqual([])
    expect(parseDiskRegistry('[[1,2]]')).toEqual([])
    expect(parseDiskRegistry('[42]')).toEqual([])
  })

  it('drops entries that could not name a file safely', () => {
    const text = JSON.stringify([
      { id: '../escape', name: 'Bad' },
      { id: 'good', name: 'Fine' },
      { id: 42, name: 'Not a string' },
      { name: 'No id' },
    ])
    expect(parseDiskRegistry(text).map((w) => w.id)).toEqual(['good'])
  })

  it('falls back to the id when a name is missing, and nulls unknown metadata', () => {
    const text = JSON.stringify([{ id: 'orphan' }])
    expect(parseDiskRegistry(text)).toEqual([
      { id: 'orphan', name: 'orphan', mirroredAt: null, appVersion: null },
    ])
  })
})

describe('plannedRecovery', () => {
  const disk = [
    { id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' },
    { id: 'b', name: 'Beta', mirroredAt: 2, appVersion: '1.0.0' },
  ]

  it('offers worlds on disk that the registry does not know about', () => {
    expect(plannedRecovery(disk, [{ id: 'a' }]).map((w) => w.id)).toEqual(['b'])
  })

  it('offers nothing when the registry already has everything', () => {
    expect(plannedRecovery(disk, [{ id: 'a' }, { id: 'b' }])).toEqual([])
  })

  it('offers everything when the registry is empty', () => {
    expect(plannedRecovery(disk, []).map((w) => w.id)).toEqual(['a', 'b'])
  })

  it('offers nothing when the disk is empty', () => {
    expect(plannedRecovery([], [{ id: 'a' }])).toEqual([])
  })

  // Second bug in #174: mirroredAt was stamped for every world at index-write
  // time even though only the active world is ever mirrored. An entry with no
  // .lore file on disk must never be offered — restoring it can only fail.
  it('excludes an entry with no mirror, even when unknown to the registry', () => {
    const withUnmirrored = [
      ...disk,
      { id: 'c', name: 'Gamma', mirroredAt: null, appVersion: null },
    ]
    expect(plannedRecovery(withUnmirrored, []).map((w) => w.id)).toEqual(['a', 'b'])
  })
})
