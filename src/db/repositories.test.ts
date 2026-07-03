import { describe, it, expect, beforeEach } from 'vitest'
import { db, pageRepo, mapRepo } from '../db'

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
