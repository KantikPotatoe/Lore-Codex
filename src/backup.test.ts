import { describe, it, expect, beforeEach } from 'vitest'
import { db, type Scene } from './db'
import { isBackupOverdue, latestChangeTime, unbackedChangeCount } from './backup'

const DAY = 24 * 60 * 60 * 1000

describe('isBackupOverdue', () => {
  it('is overdue when never backed up', () => {
    expect(isBackupOverdue(null)).toBe(true)
  })

  it('uses a 7-day default', () => {
    expect(isBackupOverdue(Date.now() - 8 * DAY)).toBe(true)
    expect(isBackupOverdue(Date.now() - 3 * DAY)).toBe(false)
  })

  it('honors a custom cadence', () => {
    expect(isBackupOverdue(Date.now() - 2 * DAY, 1)).toBe(true)
    expect(isBackupOverdue(Date.now() - 2 * DAY, 5)).toBe(false)
  })
})

/** A minimal scene stamped at `updatedAt`, for change-tracking tests. */
function sceneAt(id: string, updatedAt: number): Scene {
  return {
    id,
    bookId: 'bk',
    chapterId: 'ch',
    title: 'S',
    content: '',
    synopsis: '',
    notes: '',
    status: 'draft',
    order: 0,
    wordCount: 0,
    povPageId: null,
    castPageIds: [],
    locationPageIds: [],
    createdAt: updatedAt,
    updatedAt,
  }
}

describe('manuscript-aware change tracking', () => {
  beforeEach(async () => {
    await Promise.all([
      db.pages.clear(), db.maps.clear(), db.events.clear(),
      db.calendars.clear(), db.images.clear(), db.scenes.clear(),
    ])
  })

  it('latestChangeTime advances when only a scene changed', async () => {
    await db.scenes.add(sceneAt('sc1', 5000))
    expect(await latestChangeTime()).toBe(5000)
  })

  it('unbackedChangeCount counts scenes changed since the last backup', async () => {
    await db.scenes.add(sceneAt('old', 100))
    await db.scenes.add(sceneAt('new', 300))
    expect(await unbackedChangeCount(200)).toBe(1)
  })
})

// latestChangeTime / unbackedChangeCount scan several tables to drive the backup
// reminder. These pin their behaviour across the switch from full-table reads to
// indexed reads (events.updatedAt / images.createdAt) — same answers, cheaper.
describe('backup change-tracking helpers', () => {
  beforeEach(async () => {
    await Promise.all([
      db.pages.clear(),
      db.maps.clear(),
      db.events.clear(),
      db.calendars.clear(),
      db.images.clear(),
      db.scenes.clear(),
    ])
  })

  it('latestChangeTime returns the newest timestamp across every tracked table', async () => {
    await db.pages.put({ id: 'p1', title: 'P', content: '', summary: '', tags: [], category: 'x', createdAt: 10, updatedAt: 100 } as never)
    await db.events.put({ id: 'e1', updatedAt: 300 } as never)
    await db.images.put({ id: 'i1', createdAt: 200 } as never)
    expect(await latestChangeTime()).toBe(300)
  })

  it('latestChangeTime is 0 when nothing has been written', async () => {
    expect(await latestChangeTime()).toBe(0)
  })

  it('unbackedChangeCount counts rows changed strictly after the last backup', async () => {
    await db.pages.put({ id: 'p1', title: 'P', content: '', summary: '', tags: [], category: 'x', createdAt: 10, updatedAt: 50 } as never)
    await db.events.put({ id: 'e-old', updatedAt: 50 } as never)
    await db.events.put({ id: 'e-new', updatedAt: 150 } as never)
    await db.images.put({ id: 'i-new', createdAt: 200 } as never)
    // since = 100: e-new (150) + i-new (200) count; p1 (50) and e-old (50) don't.
    expect(await unbackedChangeCount(100)).toBe(2)
  })

  it('unbackedChangeCount with no prior backup (null) counts everything', async () => {
    await db.pages.put({ id: 'p1', title: 'P', content: '', summary: '', tags: [], category: 'x', createdAt: 10, updatedAt: 50 } as never)
    await db.images.put({ id: 'i1', createdAt: 5 } as never)
    expect(await unbackedChangeCount(null)).toBe(2)
  })
})
