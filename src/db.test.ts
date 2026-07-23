import { describe, it, expect } from 'vitest'
import { parseBackup } from './db'

// parseBackup is the guard that stands between an arbitrary dropped file and a
// destructive importAll() (which clear()s the DB). These tests pin its two jobs:
// reject anything that isn't a backup *before* any data is touched, and report
// accurate per-kind counts for the import confirmation dialog.

describe('parseBackup — rejection (throws before any DB change)', () => {
  it('rejects non-JSON text', () => {
    expect(() => parseBackup('not json at all')).toThrow(/valid JSON/i)
  })

  it('rejects valid JSON that is null', () => {
    expect(() => parseBackup('null')).toThrow(/Lore Codex backup/i)
  })

  it('rejects a JSON object with no pages array', () => {
    expect(() => parseBackup(JSON.stringify({ maps: [] }))).toThrow(/Lore Codex backup/i)
  })

  it('rejects when pages is present but not an array', () => {
    expect(() => parseBackup(JSON.stringify({ pages: 'oops' }))).toThrow(/Lore Codex backup/i)
  })

  it('rejects a bare JSON array', () => {
    expect(() => parseBackup('[1, 2, 3]')).toThrow(/Lore Codex backup/i)
  })
})

describe('parseBackup — acceptance and counts', () => {
  it('accepts a minimal backup (only an empty pages array)', () => {
    const { data, counts } = parseBackup(JSON.stringify({ pages: [] }))
    expect(data.pages).toEqual([])
    expect(counts).toEqual({
      pages: 0,
      maps: 0,
      pins: 0,
      regions: 0,
      templates: 0,
      calendars: 0,
      events: 0,
      images: 0,
      docLinks: 0,
      books: 0,
      chapters: 0,
      scenes: 0,
      plotlines: 0,
      beats: 0,
      relationshipTypes: 0,
      relationships: 0,
    })
  })

  it('counts every record kind that is present', () => {
    const backup = {
      exportedAt: 123,
      pages: [{ id: 'p1' }, { id: 'p2' }],
      maps: [{ id: 'm1' }],
      pins: [{ id: 'pin1' }, { id: 'pin2' }, { id: 'pin3' }],
      regions: [{ id: 'r1' }, { id: 'r2' }],
      templates: [{ id: 't1' }],
      calendars: [{ id: 'c1' }],
      events: [{ id: 'e1' }, { id: 'e2' }],
    }
    const { counts } = parseBackup(JSON.stringify(backup))
    expect(counts).toEqual({
      pages: 2,
      maps: 1,
      pins: 3,
      regions: 2,
      templates: 1,
      calendars: 1,
      events: 2,
      images: 0,
      docLinks: 0,
      books: 0,
      chapters: 0,
      scenes: 0,
      plotlines: 0,
      beats: 0,
      relationshipTypes: 0,
      relationships: 0,
    })
  })

  it('defaults missing optional kinds to 0 (older backups load)', () => {
    const { counts } = parseBackup(JSON.stringify({ pages: [{ id: 'p1' }] }))
    expect(counts).toMatchObject({ pages: 1, templates: 0, calendars: 0, events: 0 })
  })

  it('treats a non-array optional field as 0 rather than throwing', () => {
    const { counts } = parseBackup(JSON.stringify({ pages: [], maps: { nope: true } }))
    expect(counts.maps).toBe(0)
  })
})
