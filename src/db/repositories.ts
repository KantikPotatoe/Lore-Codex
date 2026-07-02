// Repository seam over the data layer.
//
// Routes and components used to reach straight into the Dexie singleton
// (`db.pages.get(id)`, `db.pins.update(...)`) — which welds the whole UI to
// Dexie/IndexedDB and blocks the planned Electron / on-disk-JSON move (#142).
// These repositories are the seam: a small, storage-agnostic interface plus a
// Dexie-backed implementation bound in one place. To swap the backend later,
// provide an alternate implementation of the same interface here — call sites
// stay untouched.
//
// Reactivity note: the read methods just return the promise from a `db.*`
// query, so `useLiveQuery(() => pageRepo.get(id), [id])` stays reactive —
// Dexie tracks the read globally on the `db` instance regardless of how deep in
// the call stack it happens, so wrapping it in a method changes nothing.
//
// Scope: pages + maps (the heaviest leak sites). Other tables (manuscript,
// calendar, templates, images, meta, snapshots) still use their module
// functions directly and are a follow-up sweep.

import { db } from './schema'
import {
  createPage,
  updatePage,
  deletePage,
  renamePage,
  findPageIdByTitle,
  getBacklinks,
} from './pages'
import { addMap, deleteMap, addPin, addRegion } from './maps'
import type { LorePage, MapPin, MapRegion, WorldMap } from './types'

/** A change to a stored record: either a partial patch or a mutator run against
 *  a draft. Mirrors Dexie's two `update()` forms, but named without leaking a
 *  Dexie type so an alternate backend can honour the same contract. */
export type Change<T> = Partial<T> | ((draft: T) => void)

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

export interface PageRepository {
  /** One page by id (`undefined` if it doesn't exist). */
  get(id: string): Promise<LorePage | undefined>
  /** Every page, unordered. */
  list(): Promise<LorePage[]>
  /** Every page, ordered by title. */
  listByTitle(): Promise<LorePage[]>
  /** Pages of one category (page type), ordered by title. */
  listByCategory(category: string): Promise<LorePage[]>
  /** Pages carrying a given tag, ordered by title. */
  listByTag(tag: string): Promise<LorePage[]>
  /** The `limit` most-recently-updated pages, newest first. */
  listRecent(limit: number): Promise<LorePage[]>
  /** Total page count. */
  count(): Promise<number>
  /** Resolve a title to a page id (case-insensitive), or null. No creation. */
  findIdByTitle(title: string): Promise<string | null>
  /** Pages that link to the given page. */
  backlinks(pageId: string): Promise<LorePage[]>
  create(partial?: Partial<LorePage>): Promise<string>
  update(id: string, changes: Partial<LorePage>): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
}

export const pageRepo: PageRepository = {
  get: (id) => db.pages.get(id),
  list: () => db.pages.toArray(),
  listByTitle: () => db.pages.orderBy('title').toArray(),
  listByCategory: (category) => db.pages.where('category').equals(category).sortBy('title'),
  listByTag: (tag) => db.pages.filter((p) => p.tags.includes(tag)).sortBy('title'),
  listRecent: (limit) => db.pages.orderBy('updatedAt').reverse().limit(limit).toArray(),
  count: () => db.pages.count(),
  findIdByTitle: findPageIdByTitle,
  backlinks: getBacklinks,
  create: createPage,
  update: updatePage,
  rename: renamePage,
  remove: deletePage,
}

// ---------------------------------------------------------------------------
// Maps, pins & regions
// ---------------------------------------------------------------------------

export interface MapRepository {
  listMaps(): Promise<WorldMap[]>
  countMaps(): Promise<number>
  addMap(name: string, image: string, width: number, height: number): Promise<string>
  removeMap(id: string): Promise<void>

  getPin(id: string): Promise<MapPin | undefined>
  /** Every pin across all maps. */
  listPins(): Promise<MapPin[]>
  /** Pins on one map (empty when `mapId` is falsy). */
  listPinsForMap(mapId: string): Promise<MapPin[]>
  /** Pins that link to a given page. */
  listPinsForPage(pageId: string): Promise<MapPin[]>
  addPin(mapId: string, lat: number, lng: number): Promise<string>
  updatePin(id: string, changes: Change<MapPin>): Promise<void>
  removePin(id: string): Promise<void>

  /** Every region across all maps. */
  listRegions(): Promise<MapRegion[]>
  /** Regions on one map (empty when `mapId` is falsy). */
  listRegionsForMap(mapId: string): Promise<MapRegion[]>
  addRegion(mapId: string, points: [number, number][]): Promise<string>
  updateRegion(id: string, changes: Change<MapRegion>): Promise<void>
  removeRegion(id: string): Promise<void>
}

export const mapRepo: MapRepository = {
  listMaps: () => db.maps.orderBy('createdAt').toArray(),
  countMaps: () => db.maps.count(),
  addMap,
  removeMap: deleteMap,

  getPin: (id) => db.pins.get(id),
  listPins: () => db.pins.toArray(),
  listPinsForMap: (mapId) =>
    mapId ? db.pins.where('mapId').equals(mapId).toArray() : Promise.resolve([]),
  listPinsForPage: (pageId) => db.pins.where('pageId').equals(pageId).toArray(),
  addPin,
  updatePin: async (id, changes) => {
    // Branch so each call resolves to one Dexie `update()` overload (patch vs.
    // mutator) without casting away the type.
    if (typeof changes === 'function') await db.pins.update(id, changes)
    else await db.pins.update(id, changes)
  },
  removePin: async (id) => {
    await db.pins.delete(id)
  },

  listRegions: () => db.regions.toArray(),
  listRegionsForMap: (mapId) =>
    mapId ? db.regions.where('mapId').equals(mapId).toArray() : Promise.resolve([]),
  addRegion,
  updateRegion: async (id, changes) => {
    if (typeof changes === 'function') await db.regions.update(id, changes)
    else await db.regions.update(id, changes)
  },
  removeRegion: async (id) => {
    await db.regions.delete(id)
  },
}
