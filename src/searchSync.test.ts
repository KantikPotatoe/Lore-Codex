import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { db, pageRepo } from './db'
import { installSearchIndex } from './searchSync'
import { searchAll, resetIndex } from './search'

// fake-indexeddb + happy-dom (suite defaults). liveQuery emits async, so we poll.

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for index')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let teardown: (() => void) | null = null

beforeEach(async () => {
  resetIndex()
  await db.pages.clear()
  await db.events.clear()
  await db.calendars.clear()
  await db.pins.clear()
  await db.regions.clear()
  await db.scenes.clear()
  await db.chapters.clear()
})

afterEach(() => { teardown?.(); teardown = null })

describe('installSearchIndex', () => {
  it('indexes pages as they change and stops on teardown', async () => {
    teardown = installSearchIndex()
    const id = await pageRepo.create({ title: 'Rivendell' })
    await waitFor(() => searchAll('Rivendell').length === 1)
    expect(searchAll('Rivendell')[0].id).toBe(id)
  })

  it('indexes events, pins, and scenes across their tables', async () => {
    teardown = installSearchIndex()
    const calId = await db.calendars.add({
      id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1,
    } as never)
    await db.events.add({
      id: 'e1', calendarId: calId, title: 'Council of Elrond', description: '', category: '', pageId: null,
      startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1,
    } as never)
    const mapId = await db.maps.add({ id: 'm1', name: 'Eriador', image: '', width: 1, height: 1, createdAt: 1 } as never)
    await db.pins.add({ id: 'pin1', mapId, lat: 0, lng: 0, label: 'Weathertop', pageId: null } as never)

    await waitFor(() => searchAll('Elrond').length === 1 && searchAll('Weathertop').length === 1)
    expect(searchAll('Elrond')[0].kind).toBe('event')
    expect(searchAll('Weathertop')[0].kind).toBe('pin')
  })
})
