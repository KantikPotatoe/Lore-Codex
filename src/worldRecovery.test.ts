import { describe, it, expect } from 'vitest'
import { parseDiskRegistry, serializeDiskRegistry, plannedRecovery, neverMirrored, REGISTRY_FORMAT_VERSION } from './worldRecovery'
import type { DiskRegistryRead } from './worldRecovery'

const ok = (text: string): DiskRegistryRead => ({ status: 'ok', text })
const absent: DiskRegistryRead = { status: 'absent' }
const error: DiskRegistryRead = { status: 'error' }

const envelope = (worlds: unknown[], version = REGISTRY_FORMAT_VERSION) =>
  JSON.stringify({ version, worlds })

describe('parseDiskRegistry', () => {
  it('reads a well-formed envelope', () => {
    const text = envelope([{ id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' }])
    expect(parseDiskRegistry(ok(text))).toEqual({
      ok: true,
      entries: [{ id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' }],
    })
  })

  // Backward compatibility: everything written before the envelope existed
  // is a bare array. It must still be readable — migrated forward silently,
  // not treated as unreadable.
  it('migrates a legacy bare array forward', () => {
    const text = JSON.stringify([{ id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' }])
    expect(parseDiskRegistry(ok(text))).toEqual({
      ok: true,
      entries: [{ id: 'default', name: 'Aethel', mirroredAt: 42, appVersion: '1.0.0' }],
    })
  })

  it('treats an absent registry as a genuine empty registry (ok, not an error)', () => {
    expect(parseDiskRegistry(absent)).toEqual({ ok: true, entries: [] })
  })

  // #174 Defect 1: a read failure must never be reported the same as an
  // empty registry — a caller about to write must be able to refuse.
  it('reports a seam-level read failure as unreadable, not empty', () => {
    expect(parseDiskRegistry(error)).toEqual({ ok: false })
  })

  // The file is on disk where anything could have happened to it (a
  // half-written index, a bad hand-edit); a corrupt or wrongly-shaped index
  // must be unreadable too, or a caller would write a shrinking union over
  // it exactly as if a seam-level read had failed.
  it('reports unparseable or wrongly-shaped content as unreadable', () => {
    expect(parseDiskRegistry(ok('not json'))).toEqual({ ok: false })
    expect(parseDiskRegistry(ok('{"not":"an array or envelope"}'))).toEqual({ ok: false })
    expect(parseDiskRegistry(ok('42'))).toEqual({ ok: false })
    expect(parseDiskRegistry(ok('null'))).toEqual({ ok: false })
  })

  it('treats a bare empty array as a genuine empty registry', () => {
    expect(parseDiskRegistry(ok('[]'))).toEqual({ ok: true, entries: [] })
  })

  it('drops individual malformed array elements without failing the whole file', () => {
    expect(parseDiskRegistry(ok(JSON.stringify([null])))).toEqual({ ok: true, entries: [] })
    expect(parseDiskRegistry(ok(JSON.stringify([[1, 2]])))).toEqual({ ok: true, entries: [] })
    expect(parseDiskRegistry(ok(JSON.stringify([42])))).toEqual({ ok: true, entries: [] })
  })

  it('drops entries that could not name a file safely', () => {
    const text = JSON.stringify([
      { id: '../escape', name: 'Bad' },
      { id: 'good', name: 'Fine' },
      { id: 42, name: 'Not a string' },
      { name: 'No id' },
    ])
    const parsed = parseDiskRegistry(ok(text))
    expect(parsed.ok).toBe(true)
    expect(parsed.ok && parsed.entries.map((w) => w.id)).toEqual(['good'])
  })

  it('falls back to the id when a name is missing, and nulls unknown metadata', () => {
    const text = JSON.stringify([{ id: 'orphan' }])
    expect(parseDiskRegistry(ok(text))).toEqual({
      ok: true,
      entries: [{ id: 'orphan', name: 'orphan', mirroredAt: null, appVersion: null }],
    })
  })

  // #174 Defect 3: an envelope from a NEWER build must never be flattened by
  // an older one. The auto-updater makes a downgrade a live scenario, not a
  // hypothetical — reporting "unreadable" here is what lets Defect 1's
  // refuse-to-write path protect it.
  it('reports an envelope with a newer, unrecognized version as unreadable', () => {
    const text = envelope(
      [{ id: 'default', name: 'Aethel', mirroredAt: 1, appVersion: '2.0.0' }],
      REGISTRY_FORMAT_VERSION + 1,
    )
    expect(parseDiskRegistry(ok(text))).toEqual({ ok: false })
  })

  it('accepts an envelope at the current version', () => {
    const text = envelope([], REGISTRY_FORMAT_VERSION)
    expect(parseDiskRegistry(ok(text))).toEqual({ ok: true, entries: [] })
  })

  it('reports an envelope with a non-finite version as unreadable rather than guessing', () => {
    expect(parseDiskRegistry(ok('{"version":"NaN","worlds":[]}'))).toEqual({ ok: false })
    expect(parseDiskRegistry(ok(JSON.stringify({ version: Number.NaN, worlds: [] })))).toEqual({ ok: false })
  })

  it('reports an envelope-shaped object with a non-array worlds field as unreadable', () => {
    expect(
      parseDiskRegistry(ok(JSON.stringify({ version: REGISTRY_FORMAT_VERSION, worlds: 'nope' }))),
    ).toEqual({ ok: false })
  })
})

describe('serializeDiskRegistry', () => {
  it('wraps entries in the version envelope', () => {
    const entries = [{ id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' }]
    const json = serializeDiskRegistry(entries)
    expect(JSON.parse(json)).toEqual({ version: REGISTRY_FORMAT_VERSION, worlds: entries })
  })

  it('round-trips through parseDiskRegistry', () => {
    const entries = [{ id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' }]
    expect(parseDiskRegistry(ok(serializeDiskRegistry(entries)))).toEqual({ ok: true, entries })
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

// #174 task r3, item 4: the complement of plannedRecovery — worlds the index
// names but never actually mirrored, so there is nothing to restore, but the
// app must not pretend it never knew about them.
describe('neverMirrored', () => {
  const disk = [
    { id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' },
    { id: 'c', name: 'Gamma', mirroredAt: null, appVersion: null },
  ]

  it('offers a disk-only entry with no mirror', () => {
    expect(neverMirrored(disk, []).map((w) => w.id)).toEqual(['c'])
  })

  it('excludes a disk-only entry that DOES have a mirror (that is plannedRecovery\'s job)', () => {
    expect(neverMirrored(disk, []).map((w) => w.id)).not.toContain('a')
  })

  it('excludes an entry already known to the registry, mirrored or not', () => {
    expect(neverMirrored(disk, [{ id: 'c' }])).toEqual([])
  })

  it('offers nothing when the disk is empty', () => {
    expect(neverMirrored([], [{ id: 'a' }])).toEqual([])
  })

  it('partitions with plannedRecovery: every disk entry absent from the registry lands in exactly one of the two', () => {
    const mixed = [
      { id: 'a', name: 'Alpha', mirroredAt: 1, appVersion: '1.0.0' },
      { id: 'b', name: 'Beta', mirroredAt: 2, appVersion: '1.0.0' },
      { id: 'c', name: 'Gamma', mirroredAt: null, appVersion: null },
    ]
    const known = [{ id: 'a' }] // 'a' is known; 'b' and 'c' are absent from the registry
    const recoverable = plannedRecovery(mixed, known).map((w) => w.id)
    const lost = neverMirrored(mixed, known).map((w) => w.id)
    expect(recoverable).toEqual(['b'])
    expect(lost).toEqual(['c'])
    expect([...recoverable, ...lost].sort()).toEqual(['b', 'c'])
  })
})
