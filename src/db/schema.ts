import Dexie, { liveQuery, type Table } from 'dexie'
import { dbNameFor, currentLoreId } from '../loreId'
import type {
  LorePage,
  WorldMap,
  MapPin,
  MapRegion,
  MetaEntry,
  InfoboxTemplate,
  Snapshot,
  Calendar,
  TimelineEvent,
  PageImage,
  DocLink,
  Book,
  Chapter,
  Scene,
  Plotline,
  Beat,
} from './types'

// ---------------------------------------------------------------------------
// Categories & statuses
// ---------------------------------------------------------------------------

// A page's "type" (Character, Country, Deity…) is just a template — see
// BUILTIN_TEMPLATES in ./templates. Each template carries a colour, used for
// badges, dots and accents across the UI. These built-in colours double as
// fallbacks.
export const CATEGORIES = [
  { name: 'Character', color: '#e0a458' },
  { name: 'Country', color: '#7eb09b' },
  { name: 'Deity', color: '#d9c069' },
  { name: 'Geography', color: '#8fae6f' },
  { name: 'Item', color: '#b59ad6' },
  { name: 'Organization', color: '#c77e9c' },
  { name: 'Religion', color: '#c2a25a' },
  { name: 'Species', color: '#6fb6a3' },
  { name: 'Settlement', color: '#8aa4c7' },
  { name: 'Condition', color: '#cf8f5a' },
  { name: 'Conflict', color: '#cf6f6f' },
  { name: 'Document', color: '#b0a486' },
  { name: 'Culture', color: '#d68a6f' },
  { name: 'Language', color: '#9aa0cf' },
  { name: 'Material', color: '#a98e6a' },
  { name: 'Myth', color: '#b58ad0' },
  { name: 'Technology', color: '#6f9cc7' },
  { name: 'Tradition', color: '#d3a85f' },
  { name: 'Spell', color: '#9c8af0' },
] as const

/** The type a brand-new page starts as (you can change it on the page). */
export const DEFAULT_CATEGORY = 'Character'

/** A palette of pleasant accent colours offered when picking a type's colour. */
export const TYPE_COLORS = [
  '#e0a458', '#d9c069', '#d3a85f', '#c2a25a', '#cf8f5a', '#d68a6f',
  '#cf6f6f', '#c77e9c', '#b58ad0', '#b59ad6', '#9c8af0', '#9aa0cf',
  '#6f9cc7', '#8aa4c7', '#6fb6a3', '#7eb09b', '#8fae6f', '#a98e6a',
  '#b0a486', '#a0a0a0',
] as const

// A synchronous cache of "type name → colour" so categoryColor() stays cheap to
// call during rendering. Seeded from the built-ins, then kept in sync with the
// templates table (see the liveQuery subscription after the db is created).
let categoryColors: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.name.toLowerCase(), c.color as string]),
)

export function categoryColor(name: string): string {
  return categoryColors[name.toLowerCase()] ?? '#a0a0a0'
}

// Development status of a page, shown as a badge so you can see at a glance how
// finished each page is. Ordered from least to most developed.
export const STATUSES = [
  { name: 'Stub', color: '#8a8175' },
  { name: 'Draft', color: '#c98f5a' },
  { name: 'Complete', color: '#5aa86b' },
] as const

export const DEFAULT_STATUS = 'Draft'

export function statusColor(name: string): string {
  return STATUSES.find((s) => s.name === name)?.color ?? '#8a8175'
}

/**
 * A page's status, falling back to the default for older pages without one or
 * with a status that's no longer recognised (e.g. the retired 'WIP' before its
 * data migration has run). Keeps badges from rendering stale labels.
 */
export function pageStatus(page: Pick<LorePage, 'status'>): string {
  const s = page.status
  if (s && STATUSES.some((x) => x.name === s)) return s
  return DEFAULT_STATUS
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export class LoreDB extends Dexie {
  pages!: Table<LorePage, string>
  maps!: Table<WorldMap, string>
  pins!: Table<MapPin, string>
  regions!: Table<MapRegion, string>
  meta!: Table<MetaEntry, string>
  templates!: Table<InfoboxTemplate, string>
  snapshots!: Table<Snapshot, number>
  calendars!: Table<Calendar, string>
  events!: Table<TimelineEvent, string>
  images!: Table<PageImage, string>
  docLinks!: Table<DocLink, string>
  books!: Table<Book, string>
  chapters!: Table<Chapter, string>
  scenes!: Table<Scene, string>
  plotlines!: Table<Plotline, string>
  beats!: Table<Beat, string>

  constructor(name: string = 'lore-app') {
    super(name)
    this.version(1).stores({
      // Indexes: only fields we search/sort by need listing here.
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
    })
    // v2 adds a meta table (app settings); existing data is preserved.
    this.version(2).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
      meta: '&key',
    })
    // v3 adds editable infobox templates; existing data is preserved.
    this.version(3).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
      meta: '&key',
      templates: 'id, name',
    })
    // v4 adds auto-snapshots stored locally; existing data is preserved.
    this.version(4).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
    })
    // v5 adds in-world timeline calendars and events; existing data is preserved.
    this.version(5).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
    })
    // v6 adds drawable map regions (polygons); existing data is preserved.
    this.version(6).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId',
      regions: 'id, mapId, pageId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
    })
    // v7 indexes childMapId on pins & regions for map nesting (portals);
    // existing data is preserved (an added index needs no data migration).
    this.version(7).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
    })
    // v8 adds the per-page image gallery table; existing data is preserved
    // (a new table needs no data migration of the others).
    this.version(8).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
      images: 'id, pageId, order',
    })
    // v9 retires the 'WIP' page status (merged into 'Draft'). No store change —
    // only a data migration remapping any page still tagged 'WIP'.
    this.version(9).upgrade((tx) =>
      tx
        .table('pages')
        .toCollection()
        .modify((p: LorePage) => {
          if (p.status === 'WIP') p.status = 'Draft'
        }),
    )
    // v10 adds the curated document-attachment join table (#109); existing data
    // is preserved (a new table needs no data migration of the others).
    this.version(10).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
      images: 'id, pageId, order',
      docLinks: 'id, pageId, documentId',
    })
    // v11 adds the manuscript authoring tables (books, chapters, scenes, plotlines,
    // beats); existing data is preserved (new tables need no data migration).
    this.version(11).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
      images: 'id, pageId, order',
      docLinks: 'id, pageId, documentId',
      books: 'id, order',
      chapters: 'id, bookId, order',
      scenes: 'id, bookId, chapterId, order, updatedAt',
      plotlines: 'id, bookId, order',
      beats: 'id, bookId, plotlineId, sceneId',
    })
    // v12 changes no stores or data — it exists only to keep this ladder in
    // lockstep with the backup format, which gained the portable meta rows
    // (see CURRENT_SCHEMA_VERSION in ./backup.ts: "bump both together").
    this.version(12).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId',
      images: 'id, pageId, order',
      docLinks: 'id, pageId, documentId',
      books: 'id, order',
      chapters: 'id, bookId, order',
      scenes: 'id, bookId, chapterId, order, updatedAt',
      plotlines: 'id, bookId, order',
      beats: 'id, bookId, plotlineId, sceneId',
    })
    // v13 adds indexes only (events.updatedAt, images.createdAt) so the backup
    // reminder can read the newest/changed rows without hydrating whole tables
    // (#181). No data migration — Dexie builds the indexes on upgrade. The
    // exported shape is unchanged, but CURRENT_SCHEMA_VERSION still bumps to
    // mirror the store version (see the v7 index-only note in db/backup.ts).
    this.version(13).stores({
      pages: 'id, title, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId, updatedAt',
      images: 'id, pageId, order, createdAt',
      docLinks: 'id, pageId, documentId',
      books: 'id, order',
      chapters: 'id, bookId, order',
      scenes: 'id, bookId, chapterId, order, updatedAt',
      plotlines: 'id, bookId, order',
      beats: 'id, bookId, plotlineId, sceneId',
    })
  }
}

export const db = new LoreDB(dbNameFor(currentLoreId()))

// Keep the synchronous colour cache in sync with the templates table, so every
// page type (built-in or one you add) shows its colour everywhere instantly.
liveQuery(() => db.templates.toArray()).subscribe((tpls) => {
  const next: Record<string, string> = Object.fromEntries(
    CATEGORIES.map((c) => [c.name.toLowerCase(), c.color as string]),
  )
  for (const t of tpls) if (t.color) next[t.name.toLowerCase()] = t.color
  categoryColors = next
})

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  return (await db.meta.get(key))?.value as T | undefined
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db.meta.put({ key, value })
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
// Tiny id/timestamp helpers shared across the db modules.

export const uid = (): string => crypto.randomUUID()
export const now = (): number => Date.now()
