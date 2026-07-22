// Repository seam over the data layer.
//
// The seam exists so the UI has exactly ONE idiom for reaching data: routes and
// components call a repository, never the Dexie singleton. That is enforced by
// lint (`no-restricted-imports` in eslint.config.js), because the honour system
// did not hold — this file's header used to say "follow-up sweep" and the sweep
// did not happen, so new code kept copying the wrong idiom.
//
// What this seam is NOT: a portability layer. An earlier header claimed it
// unblocked the storage swap (#142). It does not. Phase 2 of the desktop move
// (#174) mirrors worlds to disk via exportAll() and needs nothing from here, and
// any non-Dexie backend must bring its own invalidation story for the ~77
// `useLiveQuery` sites — which no repository interface reduces. See
// docs/desktop-transition-investigation.md §4.1. Do not justify work here on
// portability grounds without re-reading that section.
//
// Reactivity note: the read methods just return the promise from a `db.*`
// query, so `useLiveQuery(() => pageRepo.get(id), [id])` stays reactive —
// Dexie tracks the read globally on the `db` instance regardless of how deep in
// the call stack it happens, so wrapping it in a method changes nothing.
//
// Tiers:
//   UI (components, routes, hooks) — repositories only. Lint-enforced.
//   Infra (src/backup.ts, searchSync.ts, snapshots.ts, htmlExport.ts,
//          manuscriptExport.ts) — keeps raw `db`, permanently and on purpose:
//          it does whole-DB, cross-table, transactional work that a per-table
//          repository would serve worse, not better.
//   Data layer (src/db/**) — owns `db`.

import { db } from './schema'
import {
  createPage,
  updatePage,
  updateContent,
  deletePage,
  renamePage,
  findPageIdByTitle,
  getBacklinks,
} from './pages'
import { addMap, deleteMap, addPin, addRegion } from './maps'
import { createTemplate, updateTemplate, deleteTemplate, resetTemplate } from './templates'
import {
  createCalendar,
  updateCalendar,
  deleteCalendar,
  addEvent,
  updateEvent,
  deleteEvent,
  type NewEventData,
} from './calendar'
import { listBooks, listChapters, listScenesForBook, listPlotlines, listBeats } from './manuscript'
import {
  seedRelationshipTypes,
  getRelationshipTypes,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
  resetRelationshipType,
  countRelationshipsOfType,
  type NewRelationshipType,
} from './relationshipTypes'
import {
  addRelationship,
  updateRelationshipNote,
  removeRelationship,
  getRelationsFor,
  type PageRelation,
} from './relationships'
import type {
  LorePage,
  MapPin,
  MapRegion,
  WorldMap,
  InfoboxTemplate,
  Calendar,
  TimelineEvent,
  Book,
  Chapter,
  Scene,
  Plotline,
  Beat,
  RelationshipType,
} from './types'

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
  /** Several pages by id, in the order given. Ids with no page come back
   *  `undefined` — callers drop them (a recently-viewed list can name a page
   *  that has since been deleted). */
  getMany(ids: string[]): Promise<(LorePage | undefined)[]>
  /** Every page, unordered. */
  list(): Promise<LorePage[]>
  /** Every page, ordered by title. */
  listByTitle(): Promise<LorePage[]>
  /** Every page's title, ordered by title. Reads the `title` index only — no
   *  record hydration (so it doesn't pull each page's content + embedded image
   *  bytes just to enumerate titles). */
  titles(): Promise<string[]>
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
  /** Write the body only if it actually changed (see `updateContent` in `pages.ts`
   *  for why the comparison has to happen against the DB, not a stale value). */
  updateContent(id: string, content: string): Promise<void>
  rename(id: string, title: string): Promise<void>
  remove(id: string): Promise<void>
}

export const pageRepo: PageRepository = {
  get: (id) => db.pages.get(id),
  getMany: (ids) => db.pages.bulkGet(ids),
  list: () => db.pages.toArray(),
  listByTitle: () => db.pages.orderBy('title').toArray(),
  titles: () => db.pages.orderBy('title').keys() as Promise<string[]>,
  listByCategory: (category) => db.pages.where('category').equals(category).sortBy('title'),
  listByTag: (tag) => db.pages.filter((p) => p.tags.includes(tag)).sortBy('title'),
  listRecent: (limit) => db.pages.orderBy('updatedAt').reverse().limit(limit).toArray(),
  count: () => db.pages.count(),
  findIdByTitle: findPageIdByTitle,
  backlinks: getBacklinks,
  create: createPage,
  update: updatePage,
  updateContent,
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

  getRegion(id: string): Promise<MapRegion | undefined>
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

  getRegion: (id) => db.regions.get(id),
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

// ---------------------------------------------------------------------------
// Page types (templates)
// ---------------------------------------------------------------------------

export interface TemplateRepository {
  /** Every page type, unordered — for callers that group by something else. */
  list(): Promise<InfoboxTemplate[]>
  /** Every page type, ordered by name — for pickers and the /templates list.
   *  Deliberately NOT `getTemplates()`: that falls back to BUILTIN_TEMPLATES on
   *  an empty table, which is seeding behaviour, not a UI read. */
  listByName(): Promise<InfoboxTemplate[]>
  create(name: string, color?: string): Promise<string>
  update(id: string, changes: Partial<InfoboxTemplate>): Promise<void>
  remove(id: string): Promise<void>
  /** Restore a built-in type to its shipped definition. */
  reset(id: string): Promise<void>
}

export const templateRepo: TemplateRepository = {
  list: () => db.templates.toArray(),
  listByName: () => db.templates.orderBy('name').toArray(),
  create: createTemplate,
  update: updateTemplate,
  remove: deleteTemplate,
  reset: resetTemplate,
}

// ---------------------------------------------------------------------------
// Calendars & timeline events
// ---------------------------------------------------------------------------

export interface CalendarRepository {
  /** Every calendar, ordered by creation. */
  listCalendars(): Promise<Calendar[]>
  getCalendar(id: string): Promise<Calendar | undefined>
  createCalendar(name: string): Promise<string>
  /** Rewrites every event's cached absolute days in one transaction — see
   *  `updateCalendar` in `calendar.ts`. */
  updateCalendar(id: string, changes: Partial<Calendar>): Promise<void>
  /** Cascade-deletes the calendar's events. */
  removeCalendar(id: string): Promise<void>

  /** Every event, unordered. */
  listEvents(): Promise<TimelineEvent[]>
  /** Every event on the shared absolute-day axis, earliest first. */
  listEventsByDate(): Promise<TimelineEvent[]>
  addEvent(data: NewEventData): Promise<string>
  /** Always recomputes the cached absolute days — see `updateEvent` in
   *  `calendar.ts`. `id`/`createdAt` are not patchable. */
  updateEvent(id: string, changes: Partial<Omit<TimelineEvent, 'id' | 'createdAt'>>): Promise<void>
  removeEvent(id: string): Promise<void>
}

export const calendarRepo: CalendarRepository = {
  listCalendars: () => db.calendars.orderBy('createdAt').toArray(),
  getCalendar: (id) => db.calendars.get(id),
  createCalendar,
  updateCalendar,
  removeCalendar: deleteCalendar,

  listEvents: () => db.events.toArray(),
  listEventsByDate: () => db.events.orderBy('startAbsolute').toArray(),
  addEvent,
  updateEvent,
  removeEvent: deleteEvent,
}

// ---------------------------------------------------------------------------
// Manuscript: books → chapters → scenes, plus the plotline/beat grid
// ---------------------------------------------------------------------------

export interface ManuscriptRepository {
  listBooks(): Promise<Book[]>
  getBook(id: string): Promise<Book | undefined>

  /** Chapters of one book, in reading order. */
  listChaptersForBook(bookId: string): Promise<Chapter[]>

  getScene(id: string): Promise<Scene | undefined>
  /** Scenes of one book, in reading order. */
  listScenesForBook(bookId: string): Promise<Scene[]>
  /** Every scene across every book — for library-wide word-count stats. */
  listAllScenes(): Promise<Scene[]>

  /** Plotline lanes of one book, in lane order (includes the structure lane). */
  listPlotlinesForBook(bookId: string): Promise<Plotline[]>
  /** Every beat in one book, unordered (the grid places them by cell). */
  listBeatsForBook(bookId: string): Promise<Beat[]>
}

export const manuscriptRepo: ManuscriptRepository = {
  listBooks,
  getBook: (id) => db.books.get(id),

  listChaptersForBook: listChapters,

  getScene: (id) => db.scenes.get(id),
  listScenesForBook,
  listAllScenes: () => db.scenes.toArray(),

  listPlotlinesForBook: listPlotlines,
  listBeatsForBook: listBeats,
}

// ---------------------------------------------------------------------------
// Typed relationships (#175)
// ---------------------------------------------------------------------------

export interface RelationshipRepository {
  /** The vocabulary, in display order. */
  listTypes(): Promise<RelationshipType[]>
  createType(input: NewRelationshipType): Promise<string>
  updateType(
    id: string,
    changes: Partial<Omit<RelationshipType, 'id' | 'builtin'>>,
  ): Promise<void>
  /** Deletes a custom type and cascades its relationships. Built-ins refused. */
  removeType(id: string): Promise<void>
  resetType(id: string): Promise<void>
  /** How many relationships use a type — for the delete confirmation. */
  countOfType(id: string): Promise<number>
  seedTypes(): Promise<void>

  /** Every relationship touching a page, from that page's point of view. */
  listFor(pageId: string): Promise<PageRelation[]>
  /** Returns the new row id, or null when refused (self / duplicate / bad type). */
  add(fromId: string, toId: string, typeId: string, note?: string): Promise<string | null>
  updateNote(id: string, note: string): Promise<void>
  remove(id: string): Promise<void>
}

export const relationshipRepo: RelationshipRepository = {
  listTypes: getRelationshipTypes,
  createType: createRelationshipType,
  updateType: updateRelationshipType,
  removeType: deleteRelationshipType,
  resetType: resetRelationshipType,
  countOfType: countRelationshipsOfType,
  seedTypes: seedRelationshipTypes,

  listFor: getRelationsFor,
  add: addRelationship,
  updateNote: updateRelationshipNote,
  remove: removeRelationship,
}
