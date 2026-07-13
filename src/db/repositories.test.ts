import { describe, it, expect, beforeEach } from 'vitest'
import { db, pageRepo, mapRepo, templateRepo, calendarRepo } from '../db'

// The repositories are the storage-agnostic seam the UI now goes through instead
// of touching Dexie directly (#140). These tests pin that each method reads/writes
// the same rows the old direct `db.*` calls did — including the two edge cases the
// interface has to honour: `update` accepting a mutator function, and the
// list-by-map queries returning [] for a falsy map id.

beforeEach(async () => {
  await db.pages.clear()
  await db.images.clear()
  await db.pins.clear()
  await db.regions.clear()
  await db.maps.clear()
})

describe('pageRepo', () => {
  it('create + get + count round-trip', async () => {
    const id = await pageRepo.create({ title: 'Gondor', category: 'Country' })
    const page = await pageRepo.get(id)
    expect(page?.title).toBe('Gondor')
    expect(await pageRepo.count()).toBe(1)
  })

  it('list / listByTitle / listByCategory / listByTag filter and order', async () => {
    await pageRepo.create({ title: 'Zeta', category: 'Character', tags: ['hero'] })
    await pageRepo.create({ title: 'Alpha', category: 'Country', tags: ['hero'] })
    await pageRepo.create({ title: 'Mid', category: 'Character', tags: [] })

    expect((await pageRepo.list()).length).toBe(3)
    expect((await pageRepo.listByTitle()).map((p) => p.title)).toEqual(['Alpha', 'Mid', 'Zeta'])
    expect((await pageRepo.listByCategory('Character')).map((p) => p.title)).toEqual(['Mid', 'Zeta'])
    expect((await pageRepo.listByTag('hero')).map((p) => p.title)).toEqual(['Alpha', 'Zeta'])
  })

  it('titles returns every page title, ordered by title, without hydrating records', async () => {
    await pageRepo.create({ title: 'Zeta' })
    await pageRepo.create({ title: 'Alpha' })
    await pageRepo.create({ title: 'Mid' })
    expect(await pageRepo.titles()).toEqual(['Alpha', 'Mid', 'Zeta'])
  })

  it('listRecent returns the most-recently-updated pages newest first', async () => {
    const a = await pageRepo.create({ title: 'A' })
    const b = await pageRepo.create({ title: 'B' })
    // updatedAt has millisecond resolution; on a fast run the update below
    // lands in the same ms as B's creation, ties on the updatedAt index, and
    // sorts by uuid instead of recency. Wait out the tick so A is strictly newer.
    const t = Date.now()
    while (Date.now() === t) await new Promise((r) => setTimeout(r, 1))
    // Bump A so it becomes the most recent.
    await pageRepo.update(a, { summary: 'touched' })
    const recent = await pageRepo.listRecent(1)
    expect(recent.map((p) => p.id)).toEqual([a])
    expect(b).toBeTruthy()
  })

  it('findIdByTitle resolves case-insensitively, else null', async () => {
    const id = await pageRepo.create({ title: 'Rivendell' })
    expect(await pageRepo.findIdByTitle('rIvEnDeLl')).toBe(id)
    expect(await pageRepo.findIdByTitle('nowhere')).toBeNull()
  })

  it('update patches fields; rename rewrites references; remove deletes', async () => {
    const a = await pageRepo.create({ title: 'Aragorn' })
    const b = await pageRepo.create({
      title: 'Arwen',
      content: '<a data-wikilink data-title="Aragorn">Aragorn</a>',
    })

    await pageRepo.update(a, { summary: 'King' })
    expect((await pageRepo.get(a))?.summary).toBe('King')

    await pageRepo.rename(a, 'Elessar')
    expect((await pageRepo.get(a))?.title).toBe('Elessar')
    expect((await pageRepo.get(b))?.content).toContain('data-title="Elessar"')

    await pageRepo.remove(a)
    expect(await pageRepo.get(a)).toBeUndefined()
  })

  it('backlinks lists pages that link to a page', async () => {
    const target = await pageRepo.create({ title: 'Mordor' })
    await pageRepo.create({
      title: 'Sauron',
      content: '<a data-wikilink data-title="Mordor">Mordor</a>',
    })
    const back = await pageRepo.backlinks(target)
    expect(back.map((p) => p.title)).toEqual(['Sauron'])
  })
})

describe('mapRepo', () => {
  it('addMap / listMaps / countMaps / removeMap round-trip', async () => {
    const id = await mapRepo.addMap('Middle-earth', 'data:img', 100, 80)
    expect((await mapRepo.listMaps()).map((m) => m.name)).toEqual(['Middle-earth'])
    expect(await mapRepo.countMaps()).toBe(1)
    await mapRepo.removeMap(id)
    expect(await mapRepo.countMaps()).toBe(0)
  })

  it('pins: add, get, list, scope-by-map, scope-by-page, update, remove', async () => {
    const mapId = await mapRepo.addMap('M', 'data:img', 10, 10)
    const pinId = await mapRepo.addPin(mapId, 1, 2)

    expect((await mapRepo.getPin(pinId))?.mapId).toBe(mapId)
    expect((await mapRepo.listPins()).length).toBe(1)
    expect((await mapRepo.listPinsForMap(mapId)).length).toBe(1)

    // Falsy map id yields an empty list (mirrors the old ternary in MapRoute).
    expect(await mapRepo.listPinsForMap('')).toEqual([])

    await mapRepo.updatePin(pinId, { pageId: 'p1', label: 'Capital' })
    expect((await mapRepo.getPin(pinId))?.label).toBe('Capital')
    expect((await mapRepo.listPinsForPage('p1')).length).toBe(1)

    // Mutator form (used by MapRoute to delete an optional field).
    await mapRepo.updatePin(pinId, (p) => {
      p.childMapId = 'child'
    })
    expect((await mapRepo.getPin(pinId))?.childMapId).toBe('child')
    await mapRepo.updatePin(pinId, (p) => {
      delete p.childMapId
    })
    expect((await mapRepo.getPin(pinId))?.childMapId).toBeUndefined()

    await mapRepo.removePin(pinId)
    expect(await mapRepo.getPin(pinId)).toBeUndefined()
  })

  it('regions: add, scope-by-map, update (patch + mutator), remove', async () => {
    const mapId = await mapRepo.addMap('M', 'data:img', 10, 10)
    const regionId = await mapRepo.addRegion(mapId, [
      [0, 0],
      [1, 1],
      [0, 1],
    ])

    expect((await mapRepo.listRegionsForMap(mapId)).length).toBe(1)
    expect(await mapRepo.listRegionsForMap('')).toEqual([])

    await mapRepo.updateRegion(regionId, { color: '#f00' })
    expect((await db.regions.get(regionId))?.color).toBe('#f00')
    await mapRepo.updateRegion(regionId, (r) => {
      delete r.color
    })
    expect((await db.regions.get(regionId))?.color).toBeUndefined()

    await mapRepo.removeRegion(regionId)
    expect((await mapRepo.listRegions()).length).toBe(0)
  })
})

describe('templateRepo', () => {
  beforeEach(async () => {
    await db.templates.clear()
    await db.templates.bulkAdd([
      { id: 't2', name: 'Zebra', color: '#111', items: [] },
      { id: 't1', name: 'Aardvark', color: '#222', items: [] },
    ] as never)
  })

  it('list() returns every template', async () => {
    const all = await templateRepo.list()
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('listByName() orders by name', async () => {
    const all = await templateRepo.listByName()
    expect(all.map((t) => t.name)).toEqual(['Aardvark', 'Zebra'])
  })

  // The BUILTIN_TEMPLATES fallback in getTemplates() must NOT leak into the
  // repo: UI reads show what the table holds, nothing more.
  it('list() returns empty on an empty table (no builtin fallback)', async () => {
    await db.templates.clear()
    expect(await templateRepo.list()).toEqual([])
  })

  it('update() writes through', async () => {
    await templateRepo.update('t1', { color: '#abc' })
    expect((await db.templates.get('t1'))?.color).toBe('#abc')
  })
})

describe('calendarRepo', () => {
  beforeEach(async () => {
    await Promise.all([db.calendars.clear(), db.events.clear()])
    await db.calendars.bulkAdd([
      { id: 'c2', name: 'Second', createdAt: 200 },
      { id: 'c1', name: 'First', createdAt: 100 },
    ] as never)
    await db.events.bulkAdd([
      { id: 'e2', calendarId: 'c1', title: 'Late', startAbsolute: 900 },
      { id: 'e1', calendarId: 'c1', title: 'Early', startAbsolute: 100 },
    ] as never)
  })

  it('listCalendars() orders by createdAt', async () => {
    expect((await calendarRepo.listCalendars()).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('getCalendar() fetches one', async () => {
    expect((await calendarRepo.getCalendar('c2'))?.name).toBe('Second')
  })

  it('getCalendar() returns undefined for an unknown id', async () => {
    expect(await calendarRepo.getCalendar('nope')).toBeUndefined()
  })

  it('listEventsByDate() orders by startAbsolute', async () => {
    expect((await calendarRepo.listEventsByDate()).map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('listEvents() returns every event', async () => {
    expect((await calendarRepo.listEvents()).map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })
})
