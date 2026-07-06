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
