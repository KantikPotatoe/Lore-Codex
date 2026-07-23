import { db, now, activeLoreId, type LoreDB } from './schema'
import { broadcastWorldChange } from '../tabSync'
import { seedTemplates } from './templates'
import { seedDefaultCalendar } from './calendar'
import { seedRelationshipTypes } from './relationshipTypes'
import { BODY_IMAGES_MIGRATED_KEY } from './bodyImageMigration'
import { sanitizeHtml } from '../sanitize'
import pkg from '../../package.json'
import type {
  Beat,
  Book,
  Calendar,
  Chapter,
  DocLink,
  InfoboxTemplate,
  LorePage,
  MapPin,
  MapRegion,
  MetaEntry,
  PageImage,
  Plotline,
  Relationship,
  RelationshipType,
  Scene,
  TimelineEvent,
  WorldMap,
} from './types'

// ---------------------------------------------------------------------------
// Backup / restore — your safety net
// ---------------------------------------------------------------------------

/**
 * The schema version current exports are stamped with. It mirrors the Dexie
 * store version in schema.ts: bump both together whenever the *exported* shape
 * changes, and add a MIGRATIONS step (below) for the new version so older
 * backups keep importing.
 */
export const CURRENT_SCHEMA_VERSION = 15

/**
 * Meta keys that describe this device/install rather than the world, so they
 * must never travel in a backup: they are excluded from exportAll() and
 * dropped on import. An imported `lastBackupAt` would wrongly silence the
 * backup-overdue banner; an imported `snapshot-last-time` would suppress
 * auto-snapshots. These are the canonical definitions — src/backup.ts and
 * src/snapshots.ts import them from here (they can't be defined there:
 * those modules import from the db barrel, which would be a cycle).
 */
export const LAST_BACKUP_KEY = 'lastBackupAt'
export const SNAPSHOT_TIME_KEY = 'snapshot-last-time'
export const LOCAL_ONLY_META_KEYS: readonly string[] = [LAST_BACKUP_KEY, SNAPSHOT_TIME_KEY]

/** The shape produced by exportAll() and accepted by importAll().
 *  `schemaVersion`/`appVersion` were added in schema v5's tooling; legacy
 *  (pre-versioning) backups lack them and are handled by migrateBackup(). */
export interface BackupData {
  schemaVersion?: number
  appVersion?: string
  exportedAt?: number
  pages: LorePage[]
  maps?: WorldMap[]
  pins?: MapPin[]
  regions?: MapRegion[]
  templates?: InfoboxTemplate[]
  calendars?: Calendar[]
  events?: TimelineEvent[]
  images?: PageImage[]
  docLinks?: DocLink[]
  books?: Book[]
  chapters?: Chapter[]
  scenes?: Scene[]
  plotlines?: Plotline[]
  beats?: Beat[]
  relationshipTypes?: RelationshipType[]
  relationships?: Relationship[]
  meta?: MetaEntry[]
}

/** Counts of each record kind in a backup, for the import confirmation. */
export interface BackupCounts {
  pages: number
  maps: number
  pins: number
  regions: number
  templates: number
  calendars: number
  events: number
  images: number
  docLinks: number
  books: number
  chapters: number
  scenes: number
  plotlines: number
  beats: number
  relationshipTypes: number
  relationships: number
}

/** Live row counts for every table, in `BackupCounts` shape. Settings shows
 *  these beside an incoming backup's counts so the user can see exactly what a
 *  restore would replace. Lives here, not in the route, because the table list
 *  belongs to the backup format — add a table to the format and this must
 *  follow. */
export async function countAll(): Promise<BackupCounts> {
  const [pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats, relationshipTypes, relationships] =
    await Promise.all([
    db.pages.count(), db.maps.count(), db.pins.count(), db.regions.count(),
    db.templates.count(), db.calendars.count(), db.events.count(), db.images.count(),
    db.docLinks.count(), db.books.count(), db.chapters.count(), db.scenes.count(),
    db.plotlines.count(), db.beats.count(),
    db.relationshipTypes.count(), db.relationships.count(),
  ])
  return {
    pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats, relationshipTypes, relationships,
  }
}

/** A defensive "treat anything that isn't an array as empty" helper, so a
 *  malformed or older backup never crashes a bulkAdd / count. */
function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : []
}

// ---------------------------------------------------------------------------
// Forward-compatible import — a small migration ladder
// ---------------------------------------------------------------------------
// Each step upgrades a backup from the version it is keyed by to the next one,
// normalising the payload to the shape that version of the app exported. Steps
// run in order, so importAll() can rely on the current shape regardless of how
// old a backup is. Pre-versioning exports carried no `schemaVersion`; they are
// treated as the oldest (1) and were always forward-compatible — each schema
// bump only ever *added* tables — so the ladder simply fills those tables in.
const MIGRATIONS: Record<number, (d: BackupData) => BackupData> = {
  // v3 added the editable infobox templates table (and its export field).
  2: (d) => ({ ...d, templates: asArray(d.templates) }),
  // v5 added the timeline calendars + events tables.
  4: (d) => ({ ...d, calendars: asArray(d.calendars), events: asArray(d.events) }),
  // v6 added the map regions table.
  5: (d) => ({ ...d, regions: asArray(d.regions) }),
  // v7 added pin/region childMapId portals — an additive optional field inside the
  // existing pins/regions arrays, so no migration step is needed (old backups simply
  // lack it ⇒ no portal). The version still bumps to mirror the Dexie store version.
  // v8 added the per-page image gallery table; fill it in for older backups.
  7: (d) => ({ ...d, images: asArray(d.images) }),
  // v9 retired the 'WIP' page status — remap it to 'Draft' on import.
  8: (d) => ({
    ...d,
    pages: asArray(d.pages).map((p) =>
      p.status === 'WIP' ? { ...p, status: 'Draft' } : p,
    ),
  }),
  // v10 added the curated document-attachment join table; fill it in for older backups.
  9: (d) => ({ ...d, docLinks: asArray(d.docLinks) }),
  // v11 added the manuscript authoring tables; fill them in for older backups.
  10: (d) => ({
    ...d,
    books: asArray(d.books),
    chapters: asArray(d.chapters),
    scenes: asArray(d.scenes),
    plotlines: asArray(d.plotlines),
    beats: asArray(d.beats),
  }),
  // v12 added the portable meta rows (settings, home config, graph prefs);
  // fill them in for older backups. Import merges meta rather than replacing
  // it, so an empty array here leaves existing rows untouched.
  11: (d) => ({ ...d, meta: asArray(d.meta) }),
  // v13 added indexes only (events.updatedAt, images.createdAt); the exported
  // shape is unchanged, so this step is identity. The version still bumps to
  // stay in lockstep with the Dexie store version (mirrors the v7 note).
  12: (d) => d,
  // v14 added the derived, indexed titleLc field. sanitizeBackup re-derives it
  // from title on every import, so no per-row work is needed here — this step
  // exists only to advance the ladder to 14.
  13: (d) => d,
  // v15 added the typed-relationship tables (#175); fill them in for older
  // backups. An empty vocabulary is fine — seedRelationshipTypes() re-adds the
  // built-ins right after import, exactly as seedTemplates does.
  14: (d) => ({
    ...d,
    relationshipTypes: asArray(d.relationshipTypes),
    relationships: asArray(d.relationships),
  }),
}

/**
 * Bring a parsed backup up to CURRENT_SCHEMA_VERSION by running every migration
 * step from its stored version onward, then stamp it with the current version.
 * A backup with no `schemaVersion` is treated as version 1 (legacy).
 */
export function migrateBackup(data: BackupData): BackupData {
  let version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 1
  let migrated = data
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (step) migrated = step(migrated)
    version++
  }
  return { ...migrated, schemaVersion: CURRENT_SCHEMA_VERSION }
}

/**
 * Parse and validate a backup file, then migrate it to the current schema. Throws
 * a friendly Error if the text isn't a Lore Codex backup — this is what prevents a
 * wrong file from wiping the DB, since importAll() calls it before any clear().
 * Only `pages` (an array) is required, so older backups without maps/pins/templates
 * still load. The returned `data` is already migrated to CURRENT_SCHEMA_VERSION and
 * `schemaVersion` reports the version the file was read as upgraded to.
 */
export function parseBackup(
  json: string,
): { data: BackupData; counts: BackupCounts; schemaVersion: number } {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error("This file isn't valid JSON — it may be corrupted.")
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as BackupData).pages)) {
    throw new Error("This doesn't look like a Lore Codex backup file. Nothing was changed.")
  }
  const stamped = (raw as BackupData).schemaVersion
  if (typeof stamped === 'number' && stamped > CURRENT_SCHEMA_VERSION) {
    // A backup from a newer app version may use a shape this build doesn't
    // understand; importing it could silently drop or corrupt data. Refuse before
    // any clear() rather than proceed. (migrateBackup only upgrades old → current.)
    throw new Error('This backup was made by a newer version of Lore Codex. Update the app before importing it. Nothing was changed.')
  }
  const data = migrateBackup(raw as BackupData)
  return {
    data,
    schemaVersion: data.schemaVersion ?? CURRENT_SCHEMA_VERSION,
    counts: {
      pages: data.pages.length,
      maps: asArray(data.maps).length,
      pins: asArray(data.pins).length,
      regions: asArray(data.regions).length,
      templates: asArray(data.templates).length,
      calendars: asArray(data.calendars).length,
      events: asArray(data.events).length,
      images: asArray(data.images).length,
      docLinks: asArray(data.docLinks).length,
      books: asArray(data.books).length,
      chapters: asArray(data.chapters).length,
      scenes: asArray(data.scenes).length,
      plotlines: asArray(data.plotlines).length,
      beats: asArray(data.beats).length,
      relationshipTypes: asArray(data.relationshipTypes).length,
      relationships: asArray(data.relationships).length,
    },
  }
}

export async function exportAll(): Promise<string> {
  const [pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats, relationshipTypes, relationships, allMeta] = await Promise.all([
    db.pages.toArray(),
    db.maps.toArray(),
    db.pins.toArray(),
    db.regions.toArray(),
    db.templates.toArray(),
    db.calendars.toArray(),
    db.events.toArray(),
    db.images.toArray(),
    db.docLinks.toArray(),
    db.books.toArray(),
    db.chapters.toArray(),
    db.scenes.toArray(),
    db.plotlines.toArray(),
    db.beats.toArray(),
    db.relationshipTypes.toArray(),
    db.relationships.toArray(),
    db.meta.toArray(),
  ])
  // Only the portable meta rows travel; device-local bookkeeping stays home.
  const meta = allMeta.filter((m) => !LOCAL_ONLY_META_KEYS.includes(m.key))
  return JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: pkg.version,
    exportedAt: now(),
    pages,
    maps,
    pins,
    regions,
    templates,
    calendars,
    events,
    images,
    docLinks,
    books,
    chapters,
    scenes,
    plotlines,
    beats,
    relationshipTypes,
    relationships,
    meta,
  })
}

/** A snapshot payload: text tables only. Image and map *bytes* are deliberately
 *  left out — they rarely change, are covered by real backups, and storing them
 *  in every retained snapshot multiplies origin quota ~11x (#183). The image /
 *  map / pin / region arrays are present but empty so the payload is still a valid
 *  backup `parseBackup` accepts; `restoreSnapshot` then leaves the live image/map
 *  tables untouched rather than clearing them. */
export async function exportSnapshot(): Promise<string> {
  const [pages, templates, calendars, events, docLinks, books, chapters, scenes,
    plotlines, beats, relationshipTypes, relationships, allMeta] = await Promise.all([
    db.pages.toArray(),
    db.templates.toArray(),
    db.calendars.toArray(),
    db.events.toArray(),
    db.docLinks.toArray(),
    db.books.toArray(),
    db.chapters.toArray(),
    db.scenes.toArray(),
    db.plotlines.toArray(),
    db.beats.toArray(),
    db.relationshipTypes.toArray(),
    db.relationships.toArray(),
    db.meta.toArray(),
  ])
  const meta = allMeta.filter((m) => !LOCAL_ONLY_META_KEYS.includes(m.key))
  return JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: pkg.version,
    exportedAt: now(),
    pages,
    maps: [],
    pins: [],
    regions: [],
    templates,
    calendars,
    events,
    images: [],
    docLinks,
    books,
    chapters,
    scenes,
    plotlines,
    beats,
    relationshipTypes,
    relationships,
    meta,
  })
}

/**
 * Strip any scripting from the rich-text HTML a backup carries, so importing an
 * untrusted (e.g. shared) backup can't inject XSS. This is the import-time half of
 * roadmap item #8: sanitizing here — the single boundary where outside data enters
 * the DB — means every render path downstream gets clean HTML, regardless of how it
 * later renders it (the page body goes through Tiptap, but a timeline-event
 * description is dropped straight into the DOM via dangerouslySetInnerHTML). Only the
 * two HTML-bearing fields are touched; `summary`, infobox values, etc. are plain text
 * rendered as React text, which React already escapes. See src/sanitize.ts.
 */
/** A raster image data-URL with nothing that could break out of a `src="…"`
 *  attribute: real `data:image/…` (not SVG — it can embed <script>), and free of
 *  whitespace or a double-quote (a legitimate base64/percent data URL has neither).
 *  Guards the HTML-export sink, which interpolates these into raw markup. */
function isCleanImageDataUrl(v: unknown): v is string {
  if (typeof v !== 'string' || /[\s"]/.test(v)) return false
  // MIME essences are case-insensitive, so the guard must be too: `startsWith`
  // on the raw string let `data:image/SVG+xml` past both clauses and into the DB.
  const head = v.slice(0, 40).toLowerCase()
  return head.startsWith('data:image/') && !head.startsWith('data:image/svg+xml')
}

function sanitizeBackup(data: BackupData): BackupData {
  return {
    ...data,
    // Drop rows a hand-edited/truncated backup can't safely provide the load-bearing
    // fields for (a non-string id or title): downstream consumers call p.title.trim()
    // and p.tags.join() unconditionally, so one bad row would throw app-wide on the
    // next edit (the search-sync liveQuery). Salvageable-but-missing fields are coerced.
    pages: asArray(data.pages)
      .filter((p): p is LorePage => !!p && typeof p === 'object' && typeof p.id === 'string' && typeof p.title === 'string')
      .map((p) => ({
        ...p,
        content: sanitizeHtml(typeof p.content === 'string' ? p.content : ''),
        // Always (re)derive titleLc from title so it's present + correct regardless
        // of the backup's age — the v14 indexed lookups depend on it (#184).
        titleLc: p.title.trim().toLowerCase(),
        tags: Array.isArray(p.tags) ? p.tags.filter((t): t is string => typeof t === 'string') : [],
        // infobox.image feeds the raw-markup HTML export too; drop anything that
        // isn't a clean image data-URL so a crafted value can't inject there.
        ...(p.infobox
          ? { infobox: { ...p.infobox, image: isCleanImageDataUrl(p.infobox.image) ? p.infobox.image : null } }
          : {}),
      })),
    events: asArray(data.events).map((e) => ({ ...e, description: sanitizeHtml(e.description) })),
    // Map images feed L.imageOverlay. Upload used to launder every map through
    // a JPEG re-encode; #246 removed that, so this is now the only check on
    // the import path; upload is gated by `isImportableType`. Blank rather
    // than drop (the treatment `images` gets below): pins and regions are
    // keyed by mapId, so dropping the map row would strand them as
    // unreachable data. A blanked map keeps its pins and is repaired by
    // re-uploading the image.
    maps: asArray(data.maps).map((m) => ({
      ...m,
      image: isCleanImageDataUrl(m.image) ? m.image : '',
    })),
    // Scene prose is HTML from the editor; scrub it at the import boundary like page
    // content. synopsis/notes/title are plain text (React-escaped), left untouched.
    scenes: asArray(data.scenes).map((s) => ({ ...s, content: sanitizeHtml(s.content) })),
    // Images carry no HTML; defend against a non-image payload smuggled into dataUrl.
    // SVG data-URLs are excluded specifically: they can embed <script>, so a future
    // render path (<object>/<iframe>/new-tab navigation) would execute it. A quote or
    // whitespace is likewise rejected — it would break out of the HTML export's src="…".
    images: asArray(data.images).filter((img) => isCleanImageDataUrl(img.dataUrl)),
    // Drop attachment edges whose endpoints aren't in this backup's page set —
    // an untrusted or hand-edited backup could carry dangling ids.
    docLinks: (() => {
      const pageIds = new Set(asArray(data.pages).map((p) => p.id))
      return asArray(data.docLinks).filter(
        (l) => pageIds.has(l.pageId) && pageIds.has(l.documentId),
      )
    })(),
    // Drop relationship edges whose endpoints aren't in this backup's page set —
    // an untrusted or hand-edited backup could carry dangling ids, and a
    // half-resolvable relationship renders as a blank row. Self-loops are dropped
    // too: addRelationship refuses fromId === toId at runtime, but a hand-edited
    // backup bypasses that, and getRelationsFor would match such a row on both
    // its indexes and render it twice. The `note` is plain text rendered as text
    // (React-escaped), so it needs no HTML sanitizing.
    relationships: (() => {
      const pageIds = new Set(asArray(data.pages).map((p) => p.id))
      return asArray(data.relationships).filter(
        (r) => r.fromId !== r.toId && pageIds.has(r.fromId) && pageIds.has(r.toId),
      )
    })(),
    // Meta values are arbitrary JSON rendered only as React text (settings,
    // home config, graph prefs) — no HTML sink, so no sanitizing. Do drop
    // malformed rows (bulkPut would throw on a non-string key) and the
    // device-local keys, which must not clobber this install's bookkeeping.
    meta: asArray(data.meta).filter(
      (m): m is MetaEntry =>
        !!m && typeof m === 'object' && typeof m.key === 'string' &&
        !LOCAL_ONLY_META_KEYS.includes(m.key),
    ),
  }
}

/**
 * Validate, sanitize, and load a backup into `target` — which need not be the
 * module-bound active `db`: the migration wizard imports into a freshly
 * created world's DB before switching to it (the singleton only rebinds on
 * reload). Does NOT re-seed built-ins — `importAll` does that for the active
 * world, and a wizard-created world is seeded by the App start effect right
 * after the switch reloads.
 */
export async function importBackupInto(target: LoreDB, json: string): Promise<void> {
  const { data: parsed } = parseBackup(json) // throws before any clear(); migrated to the current shape
  const data = sanitizeBackup(parsed) // strip XSS from untrusted HTML before it touches the DB
  await target.transaction('rw', [target.pages, target.maps, target.pins, target.regions, target.templates, target.calendars, target.events, target.images, target.docLinks, target.books, target.chapters, target.scenes, target.plotlines, target.beats, target.relationshipTypes, target.relationships, target.meta], async () => {
    await Promise.all([
      target.pages.clear(), target.maps.clear(), target.pins.clear(), target.regions.clear(),
      target.templates.clear(), target.calendars.clear(), target.events.clear(), target.images.clear(),
      target.docLinks.clear(), target.books.clear(), target.chapters.clear(), target.scenes.clear(),
      target.plotlines.clear(), target.beats.clear(), target.relationshipTypes.clear(), target.relationships.clear(),
    ])
    await target.pages.bulkAdd(asArray(data.pages))
    await target.maps.bulkAdd(asArray(data.maps))
    await target.pins.bulkAdd(asArray(data.pins))
    await target.regions.bulkAdd(asArray(data.regions))
    await target.templates.bulkAdd(asArray(data.templates))
    await target.calendars.bulkAdd(asArray(data.calendars))
    await target.events.bulkAdd(asArray(data.events))
    await target.images.bulkAdd(asArray(data.images))
    await target.docLinks.bulkAdd(asArray(data.docLinks))
    await target.books.bulkAdd(asArray(data.books))
    await target.chapters.bulkAdd(asArray(data.chapters))
    await target.scenes.bulkAdd(asArray(data.scenes))
    await target.plotlines.bulkAdd(asArray(data.plotlines))
    await target.beats.bulkAdd(asArray(data.beats))
    await target.relationshipTypes.bulkAdd(asArray(data.relationshipTypes))
    await target.relationships.bulkAdd(asArray(data.relationships))
    // Meta is MERGED (put over existing keys), not cleared-and-replaced: a
    // pre-v12 backup or snapshot carries no meta, and restoring one must not
    // wipe this world's settings/home config. Device-local keys were already
    // dropped from `data.meta` by sanitizeBackup, so they survive here too.
    await target.meta.bulkPut(asArray(data.meta))
  })
}

export async function importAll(json: string): Promise<void> {
  // Warn other tabs before we clear+repopulate the active world under them.
  broadcastWorldChange(activeLoreId, 'import')
  await importBackupInto(db, json)
  // Older backups have no templates / calendars — make sure the built-ins exist.
  await seedTemplates()
  await seedDefaultCalendar()
  await seedRelationshipTypes()
  // Incoming pages may carry legacy inline body images; let the next startup
  // convert them to the by-ref model (#182).
  await db.meta.delete(BODY_IMAGES_MIGRATED_KEY)
}

/**
 * Restore a text-only snapshot into `target`: the text tables are cleared and
 * replaced from the snapshot, while images, maps, pins and regions are left
 * exactly as they are in the live DB. Snapshots don't version those (#183), so a
 * restore must not wipe them — it rolls back the writing, not the picture library.
 * Meta is merged (never cleared), matching importBackupInto. The transaction spans
 * only the text tables, so the image/map tables are provably untouched.
 */
export async function restoreSnapshotInto(target: LoreDB, json: string): Promise<void> {
  const { data: parsed } = parseBackup(json) // throws before any clear(); migrated to current shape
  const data = sanitizeBackup(parsed)
  await target.transaction(
    'rw',
    [target.pages, target.templates, target.calendars, target.events, target.docLinks,
      target.books, target.chapters, target.scenes, target.plotlines, target.beats,
      target.relationshipTypes, target.relationships, target.meta],
    async () => {
      await Promise.all([
        target.pages.clear(), target.templates.clear(), target.calendars.clear(),
        target.events.clear(), target.docLinks.clear(), target.books.clear(),
        target.chapters.clear(), target.scenes.clear(), target.plotlines.clear(),
        target.beats.clear(), target.relationshipTypes.clear(), target.relationships.clear(),
      ])
      await target.pages.bulkAdd(asArray(data.pages))
      await target.templates.bulkAdd(asArray(data.templates))
      await target.calendars.bulkAdd(asArray(data.calendars))
      await target.events.bulkAdd(asArray(data.events))
      await target.docLinks.bulkAdd(asArray(data.docLinks))
      await target.books.bulkAdd(asArray(data.books))
      await target.chapters.bulkAdd(asArray(data.chapters))
      await target.scenes.bulkAdd(asArray(data.scenes))
      await target.plotlines.bulkAdd(asArray(data.plotlines))
      await target.beats.bulkAdd(asArray(data.beats))
      await target.relationshipTypes.bulkAdd(asArray(data.relationshipTypes))
      await target.relationships.bulkAdd(asArray(data.relationships))
      await target.meta.bulkPut(asArray(data.meta))
    },
  )
}

export async function restoreSnapshot(json: string): Promise<void> {
  await restoreSnapshotInto(db, json)
  // An older snapshot may predate a built-in type/calendar — make sure they exist.
  await seedTemplates()
  await seedDefaultCalendar()
  await seedRelationshipTypes()
  // A pre-#182 snapshot's page bodies may hold inline images; re-convert on next start.
  await db.meta.delete(BODY_IMAGES_MIGRATED_KEY)
}
