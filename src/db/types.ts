// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------
// Everything you write is stored locally in your browser (IndexedDB) via Dexie.
// Nothing leaves your machine. Use the Export button to make backup files.
//
// This module is pure type declarations — no runtime code — so any layer can
// import it without pulling in Dexie or the db singleton.

/** The kind of an infobox field. Absent ⇒ 'text' (so older data stays valid). */
export type FieldType = 'text' | 'ref' | 'number'

/** One row of an infobox.
 *  Normally a labelled piece of information (label + value). When `kind` is
 *  'separator' the row is instead a full-width section heading: `label` holds
 *  the heading text and `value` is unused.
 *  `fieldType` makes a field typed: 'ref' fields store one or more `[[Title]]`
 *  tokens in `value` and are bound to `refType` (a page-type name); 'number'
 *  fields store a numeric string in `value`. */
export interface InfoboxField {
  id: string
  label: string
  value: string
  kind?: 'separator'
  fieldType?: FieldType
  refType?: string
}

/** The wiki-style sidebar box on a page: a picture plus labelled fields.
 *  Which fields appear is seeded from a template (see BUILTIN_TEMPLATES). */
export interface Infobox {
  template: string // which template the fields came from
  image: string | null // data URL of the picture, or null
  caption: string // optional caption under the image
  fields: InfoboxField[]
}

/** A single lore page: a character, country, place, item, event, etc. */
export interface LorePage {
  id: string
  title: string
  /** Lowercased, trimmed `title`, kept in sync on every write and indexed (v14).
   *  Powers case-insensitive title lookups (link resolution, clash checks) as an
   *  indexed read instead of a full-table scan. Optional so older data/backups
   *  without it still type-check; the v14 upgrade + import backfill populate it. */
  titleLc?: string
  category: string // e.g. "Character", "Country" — see CATEGORIES below
  content: string // rich-text HTML produced by the editor
  summary: string // short one-line description, shown in lists
  status?: string // development status — see STATUSES (older pages may lack it)
  tags: string[]
  infobox?: Infobox // optional wiki infobox (older pages may not have one)
  createdAt: number
  updatedAt: number
}

/** One image in a page's gallery. Stored as a compressed JPEG data URL in its
 *  own table (not on LorePage) so editing page text never rewrites image bytes. */
export interface PageImage {
  id: string
  pageId: string // owner page
  dataUrl: string // compressed JPEG data URL (via compressImage)
  caption: string // optional; '' when none
  order: number // 0-based position in the grid
  createdAt: number
  /** 'gallery' (the page's image grid; the default when absent, for legacy rows)
   *  or 'body' — bytes for an inline body image referenced by a bodyImage node in
   *  page.content (#182), kept out of the gallery grid. */
  kind?: 'gallery' | 'body'
}

/** A curated attachment linking a page to a Document-type page. Reciprocal:
 *  surfaced on both the owning page ("Documents") and the document
 *  ("Attached to"). The edge is id-based, so page renames never touch it. */
export interface DocLink {
  id: string
  pageId: string      // the page the document is attached to
  documentId: string  // the attached Document-type page
  order: number       // 0-based position in pageId's curated list
  createdAt: number
}

/** An uploaded world map image. */
export interface WorldMap {
  id: string
  name: string
  image: string // data URL of the uploaded image
  width: number // natural pixel size, used to lay out the map
  height: number
  createdAt: number
}

/** A pin dropped on a map, optionally linked to a lore page. */
export interface MapPin {
  id: string
  mapId: string
  lat: number // Leaflet coordinates (see MapView for details)
  lng: number
  label: string
  pageId: string | null // linked lore page, or null
  childMapId?: string // portal: the map this pin opens (drill-down); absent ⇒ none
}

/** A drawable area on a map (territory, biome…), optionally linked to a page.
 *  Colour derives from the linked page's type unless `color` overrides it. */
export interface MapRegion {
  id: string
  mapId: string
  points: [number, number][] // [lat, lng] vertices in Leaflet CRS.Simple coords
  label: string
  pageId: string | null // linked lore page, or null
  color?: string // per-region colour override; absent ⇒ derive from page type
  childMapId?: string // portal: the map this region opens (drill-down); absent ⇒ none
}

/** One month in a custom calendar. */
export interface CalendarMonth {
  name: string
  days: number
}

/** A named era within a calendar (e.g. "First Age", "Imperial Era"). */
export interface CalendarEra {
  id: string
  name: string
  startYear: number   // the continuous calendar year at which this era begins
  color?: string      // optional accent for era background bands
}

/** A custom in-world calendar: months, weekdays, eras, and a shared-axis anchor. */
export interface Calendar {
  id: string
  name: string
  /** Absolute day on which this calendar's year 0, month 0, day 1 sits. Defaults to 0. */
  anchor: number
  months: CalendarMonth[]
  weekdays: string[]
  eras: CalendarEra[]
  createdAt: number
}

/** One event on a timeline: a dated occurrence optionally spanning a range. */
export interface TimelineEvent {
  id: string
  calendarId: string
  title: string
  /** Rich-text HTML from LoreEditor. */
  description: string
  /** Free-form category label (e.g. "Battle", "Birth", "Founding"). */
  category: string
  /** Optional hex color for the event accent. Falls back to --accent. */
  color?: string
  /** Optional single emoji shown in the card header and axis block. */
  icon?: string
  /** Linked lore page stored id, like MapPin.pageId. Null if unlinked. */
  pageId: string | null
  startYear: number
  /** 0-based month index into the calendar's months array. */
  startMonth: number
  /** 1-based day within the month. */
  startDay: number
  endYear?: number
  endMonth?: number
  endDay?: number
  /** Cached absolute-day for sorting and horizontal positioning. Computed on every write. */
  startAbsolute: number
  endAbsolute?: number
  createdAt: number
  updatedAt: number
}

/** One row in a template: a field, or a separator (`separator: true`).
 *  A field may declare a `fieldType`; 'ref' fields also carry a `refType`
 *  (the name of the page-type whose pages the field links to). */
export interface TemplateItem {
  label: string
  separator?: boolean
  fieldType?: FieldType
  refType?: string
}

/** A page type: a coloured category plus the starter rows for its infobox. */
export interface InfoboxTemplate {
  id: string
  name: string
  color: string // accent colour for this type's badges/dots
  icon?: string // optional emoji shown on map pins for this type
  items: TemplateItem[]
  sections?: string[] // ordered starter body-section names; absent ⇒ none set yet
  /** Sidebar group this type belongs to (#115). Absent ⇒ never set, so
   *  seedTemplates() may backfill it; '' ⇒ deliberately ungrouped by the
   *  user, and never re-backfilled. */
  group?: string
  builtin: boolean // true for the shipped starter templates
}

/** A small key/value row for app settings like "when did we last back up". */
export interface MetaEntry {
  key: string
  value: unknown
}

/** A point-in-time export kept as automatic local version history. */
export interface Snapshot {
  id?: number
  timestamp: number
  editCount: number   // distinct pages changed since the previous snapshot
  data: string        // raw exportAll() JSON
}

// ---------------------------------------------------------------------------
// Manuscript authoring (the author's real novel — distinct from wiki pages and
// from the in-world Document page type). Book → Chapter → Scene, plus a Plottr-
// style plotline grid (Plotline lanes × Scene columns, Beat cells).
// ---------------------------------------------------------------------------

/** A book/volume in the world. A world can hold several (a series). */
export interface Book {
  id: string
  title: string
  synopsis: string          // short, plain text
  order: number             // position in the world's book list
  targetWordCount?: number  // optional word-count goal
  createdAt: number
  updatedAt: number
}

/** A chapter within a book. */
export interface Chapter {
  id: string
  bookId: string
  title: string
  order: number             // position within the book
  targetWordCount?: number
  createdAt: number
  updatedAt: number
}

/** A scene's draft state, distinct from the page `STATUSES`. */
export type SceneStatus = 'outline' | 'draft' | 'revised' | 'done'

/** A scene — the atomic writing unit. Holds the prose. */
export interface Scene {
  id: string
  bookId: string
  chapterId: string
  title: string
  content: string           // Tiptap HTML (rendered by LoreEditor)
  synopsis: string          // short card summary, plain text
  notes: string             // private notes, plain text
  status: SceneStatus
  order: number             // position within the chapter
  wordCount: number         // cached, recomputed on every content write
  targetWordCount?: number
  povPageId: string | null  // wiki page: POV character
  castPageIds: string[]     // wiki pages present in the scene
  locationPageIds: string[] // wiki pages: setting(s)
  createdAt: number
  updatedAt: number
}

/** Which built-in story structure a structure-track lane was seeded from. */
export type StructureType = 'save-the-cat' | 'heros-journey' | 'snowflake'

/** A lane on the grid. 'plot' = a storyline you track; 'structure' = a
 *  story-structure track (fixed named beats). At most one 'structure' lane per book. */
export interface Plotline {
  id: string
  bookId: string
  name: string
  color: string
  kind: 'plot' | 'structure'
  structureType?: StructureType   // set only when kind==='structure'
  order: number
  createdAt: number
  updatedAt: number
}

/** A cell on the grid: what a plotline does in a scene. */
export interface Beat {
  id: string
  bookId: string
  plotlineId: string
  sceneId: string | null    // null = a structure beat not yet aligned to a scene
  label: string             // structure beats carry a fixed name ("Catalyst"); plot beats optional
  note: string              // the card text
  order: number             // structure beats: canonical order; plot beats: placement fallback
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Typed relationships (#175)
// ---------------------------------------------------------------------------
// Untyped [[wiki links]] can say Arthur references Uther but not that Uther is
// his *father*. A Relationship is one directed fact; the RelationshipType it
// points at says how that fact reads from each end.

/** Which view a relationship type feeds. #136 filters to 'kin', #137 to
 *  'faction'/'org'. Stored on the type so a user-invented "Half-sibling of"
 *  tagged 'kin' appears in the family tree without hardcoding its id. */
export type RelationshipGroup = 'kin' | 'faction' | 'org' | 'social' | 'other'

/** A user-definable kind of relationship, with how it reads from each end.
 *  A type is *symmetric* when `label` and `inverse` are the same text — see
 *  isSymmetric() in src/relations.ts. That is the definition, not a shortcut:
 *  there is deliberately no stored flag that could contradict the labels. */
export interface RelationshipType {
  id: string
  label: string // reads from the `from` page: "Parent of"
  inverse: string // reads from the `to` page: "Child of"
  color: string
  group: RelationshipGroup
  order: number // display order in pickers and the page aside
  builtin: boolean // true for the shipped starter vocabulary
}

/** One directed fact: `fromId` is `type.label` of `toId`.
 *  Stored ONCE and rendered from both ends via the type's inverse — two
 *  mirrored rows could desync, and one row cannot disagree with itself. */
export interface Relationship {
  id: string
  fromId: string
  toId: string
  typeId: string
  note: string // free text, '' when none — covers "m. 1042–1067"
  createdAt: number
}
