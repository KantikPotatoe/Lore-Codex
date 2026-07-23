import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  LoreDB,
  migrateBackup,
  parseBackup,
  exportAll,
  importAll,
  importBackupInto,
  countAll,
  createPage,
  attachDocument,
  CURRENT_SCHEMA_VERSION,
  type BackupData,
  type Calendar,
  type LorePage,
  type TimelineEvent,
} from '../db'
import pkg from '../../package.json'

// #5 of the futureproofing roadmap: exports now carry a `schemaVersion` so a
// backup is never ambiguous to import as the schema evolves. These tests pin the
// three jobs that protect the data: stamping the version on export, running the
// migration ladder on import, and round-tripping both versioned and legacy
// (unversioned) backups.

async function clearAll(): Promise<void> {
  await Promise.all([
    db.pages.clear(), db.maps.clear(), db.pins.clear(), db.regions.clear(),
    db.templates.clear(), db.calendars.clear(), db.events.clear(), db.images.clear(),
    db.books.clear(), db.chapters.clear(), db.scenes.clear(),
    db.plotlines.clear(), db.beats.clear(),
  ])
}

beforeEach(clearAll)

const samplePage = (id: string): LorePage => ({
  id,
  title: `Page ${id}`,
  category: 'Character',
  content: '',
  summary: '',
  status: 'Draft',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
})

const sampleCalendar = (id: string): Calendar => ({
  id,
  name: 'Cal',
  anchor: 0,
  months: [{ name: 'M1', days: 30 }],
  weekdays: ['D1'],
  eras: [],
  createdAt: 1,
})

const sampleEvent = (id: string, calendarId: string): TimelineEvent => ({
  id,
  calendarId,
  title: 'Event',
  description: '',
  category: 'Battle',
  pageId: null,
  startYear: 1,
  startMonth: 0,
  startDay: 1,
  startAbsolute: 0,
  createdAt: 1,
  updatedAt: 1,
})

describe('migrateBackup — version ladder', () => {
  it('treats a backup with no schemaVersion as legacy and fills every table added later', () => {
    const out = migrateBackup({ pages: [] })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.templates).toEqual([]) // added at v3
    expect(out.calendars).toEqual([]) // added at v5
    expect(out.events).toEqual([])
    expect(out.regions).toEqual([]) // added at v6
  })

  it('upgrades a v2 backup (pre-templates) up through every later step', () => {
    const out = migrateBackup({ schemaVersion: 2, pages: [] })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.templates).toEqual([])
    expect(out.calendars).toEqual([])
    expect(out.events).toEqual([])
    expect(out.regions).toEqual([]) // backfilled at v6
  })

  it('upgrades a v4 backup (pre-timeline) and preserves its existing tables', () => {
    const templates = [{ id: 't1', name: 'T', color: '#fff', items: [], builtin: false }]
    const out = migrateBackup({ schemaVersion: 4, pages: [], templates })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.templates).toBe(templates) // not clobbered
    expect(out.calendars).toEqual([]) // backfilled
    expect(out.events).toEqual([])
  })

  it("leaves a current (v6) backup’s data intact and re-stamps the version", () => {
    const cal = sampleCalendar('c1')
    const out = migrateBackup({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pages: [samplePage('p1')],
      calendars: [cal],
      events: [],
    })
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(out.pages).toHaveLength(1)
    expect(out.calendars).toEqual([cal])
  })

  it('does not mutate its input', () => {
    const input: BackupData = { pages: [] }
    const out = migrateBackup(input)
    expect(input.schemaVersion).toBeUndefined()
    expect(out).not.toBe(input)
  })
})

describe('parseBackup — version reporting', () => {
  it('reports the current version for a legacy (unversioned) backup it migrated', () => {
    const { schemaVersion, data } = parseBackup(JSON.stringify({ pages: [] }))
    expect(schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(data.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('reports the current version for an already-current backup', () => {
    const json = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, pages: [] })
    expect(parseBackup(json).schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('rejects a backup stamped with a newer schemaVersion than this app understands', () => {
    const json = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION + 1, pages: [] })
    // Importing a shape this app doesn't understand could silently drop or corrupt
    // data — refuse before any clear() rather than proceed against an unknown shape.
    expect(() => parseBackup(json)).toThrow(/newer version/)
  })
})

describe('exportAll — version stamping', () => {
  it('stamps schemaVersion, appVersion, and exportedAt onto the payload', async () => {
    const parsed = JSON.parse(await exportAll())
    expect(parsed.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
    expect(parsed.appVersion).toBe(pkg.version)
    expect(typeof parsed.exportedAt).toBe('number')
    expect(Array.isArray(parsed.pages)).toBe(true)
  })
})

describe('importAll — round-trips', () => {
  it('round-trips a current export (pages, calendars, events survive)', async () => {
    await db.pages.add(samplePage('p1'))
    await db.calendars.add(sampleCalendar('c1'))
    await db.events.add(sampleEvent('e1', 'c1'))

    const json = await exportAll()
    await clearAll()
    await importAll(json)

    expect(await db.pages.get('p1')).toMatchObject({ id: 'p1', title: 'Page p1' })
    expect(await db.calendars.get('c1')).toMatchObject({ id: 'c1' })
    expect(await db.events.get('e1')).toMatchObject({ id: 'e1', calendarId: 'c1' })
  })

  it('round-trips regions', async () => {
    await db.maps.add({ id: 'm1', name: 'M', image: '', width: 1, height: 1, createdAt: 1 })
    await db.regions.add({
      id: 'r1', mapId: 'm1', points: [[0, 0], [0, 5], [5, 0]], label: 'Forest',
      pageId: null, color: '#8fae6f',
    })

    const json = await exportAll()
    await clearAll()
    await importAll(json)

    expect(await db.regions.get('r1')).toMatchObject({ id: 'r1', label: 'Forest', color: '#8fae6f' })
  })

  it('round-trips pin and region portals (childMapId)', async () => {
    await db.maps.add({ id: 'm1', name: 'Continent', image: '', width: 1, height: 1, createdAt: 1 })
    await db.maps.add({ id: 'm2', name: 'City', image: '', width: 1, height: 1, createdAt: 2 })
    await db.pins.add({ id: 'pin1', mapId: 'm1', lat: 1, lng: 1, label: 'Capital', pageId: null, childMapId: 'm2' })
    await db.regions.add({
      id: 'r1', mapId: 'm1', points: [[0, 0], [0, 5], [5, 0]], label: 'Reach',
      pageId: null, childMapId: 'm2',
    })

    const json = await exportAll()
    await clearAll()
    await importAll(json)

    expect(await db.pins.get('pin1')).toMatchObject({ id: 'pin1', childMapId: 'm2' })
    expect(await db.regions.get('r1')).toMatchObject({ id: 'r1', childMapId: 'm2' })
  })

  it('imports a legacy (unversioned) backup and re-seeds the built-ins it lacks', async () => {
    // A pre-versioning backup: just a pages array, no schemaVersion / templates / calendars.
    await importAll(JSON.stringify({ pages: [samplePage('legacy')] }))

    expect(await db.pages.get('legacy')).toBeDefined()
    // Missing templates + calendar are re-seeded by importAll's seed* calls.
    expect(await db.templates.count()).toBeGreaterThan(0)
    expect(await db.calendars.count()).toBeGreaterThan(0)
  })

  it('round-trips gallery images', async () => {
    await db.images.add({ id: 'img1', pageId: 'p1', dataUrl: 'data:image/png;base64,AAA', caption: 'cape', order: 0, createdAt: 1 })

    const json = await exportAll()
    await db.images.clear()
    await importAll(json)

    expect(await db.images.get('img1')).toMatchObject({ id: 'img1', pageId: 'p1', caption: 'cape', order: 0 })
  })

  it('round-trips a custom template with sections intact', async () => {
    await db.templates.add({
      id: 'tmpl-sections-test',
      name: 'SectionsTemplate',
      color: '#123456',
      items: [],
      sections: ['Alpha', 'Beta'],
      builtin: false,
    })

    const json = await exportAll()
    await clearAll()
    await importAll(json)

    const restored = await db.templates.get('tmpl-sections-test')
    expect(restored).toMatchObject({ id: 'tmpl-sections-test', sections: ['Alpha', 'Beta'] })
  })

  it('drops imported images whose dataUrl is not a data:image URL', async () => {
    const json = JSON.stringify({
      schemaVersion: 8,
      pages: [],
      images: [
        { id: 'ok', pageId: 'p1', dataUrl: 'data:image/jpeg;base64,GOOD', caption: '', order: 0, createdAt: 1 },
        { id: 'evil', pageId: 'p1', dataUrl: 'javascript:alert(1)', caption: '', order: 1, createdAt: 2 },
      ],
    })
    await importAll(json)
    expect(await db.images.get('ok')).toBeDefined()
    expect(await db.images.get('evil')).toBeUndefined()
  })

  it('drops imported SVG data-URL images (they can embed scripts)', async () => {
    const json = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pages: [],
      images: [
        { id: 'raster', pageId: 'p1', dataUrl: 'data:image/png;base64,AAA', caption: '', order: 0, createdAt: 1 },
        { id: 'svg', pageId: 'p1', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', caption: '', order: 1, createdAt: 2 },
      ],
    })
    await importAll(json)
    expect(await db.images.get('raster')).toBeDefined()
    expect(await db.images.get('svg')).toBeUndefined()
  })
})

describe('schema version', () => {
  it('is at 15 for the typed-relationship tables', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(15)
  })

  it('stamps an older backup up to current with no data loss', () => {
    const out = migrateBackup({ schemaVersion: 6, pages: [], regions: [] })
    expect(out.schemaVersion).toBe(15)
    expect(out.regions).toEqual([])
  })
})

describe('images migration', () => {
  it('MIGRATIONS step normalizes a missing images table to an empty array', () => {
    const out = migrateBackup({ schemaVersion: 7, pages: [] })
    expect(out.images).toEqual([])
  })
})

describe('WIP status migration', () => {
  it('remaps pages tagged WIP to Draft and leaves other statuses alone', () => {
    const out = migrateBackup({
      schemaVersion: 8,
      pages: [
        { id: 'a', status: 'WIP' },
        { id: 'b', status: 'Draft' },
        { id: 'c', status: 'Complete' },
        { id: 'd' },
      ],
    } as never)
    expect((out.pages as Array<{ id: string; status?: string }>).map((p) => p.status)).toEqual([
      'Draft',
      'Draft',
      'Complete',
      undefined,
    ])
  })
})

describe('docLinks in backups', () => {
  beforeEach(async () => {
    await db.pages.clear()
    await db.docLinks.clear()
  })

  it('round-trips docLinks through export → import', async () => {
    const s = await createPage({ title: 'Owner' })
    const d = await createPage({ title: 'Doc', category: 'Document' })
    await attachDocument(s, d)

    const json = await exportAll()
    await db.docLinks.clear()
    await importAll(json)

    const rows = await db.docLinks.toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].pageId).toBe(s)
    expect(rows[0].documentId).toBe(d)
  })

  it('migrates a legacy backup (no docLinks) to an empty table', async () => {
    const legacy = JSON.stringify({ schemaVersion: 9, pages: [] })
    const { data } = parseBackup(legacy)
    expect(data.docLinks).toEqual([])
    await importAll(legacy)
    expect(await db.docLinks.count()).toBe(0)
  })

  it('drops edges referencing pages absent from the backup', async () => {
    const s = await createPage({ title: 'Owner' })
    const d = await createPage({ title: 'Doc', category: 'Document' })
    await attachDocument(s, d)
    const json = await exportAll()
    // Corrupt the backup: remove the document page but keep the edge.
    const obj = JSON.parse(json)
    obj.pages = obj.pages.filter((p: { id: string }) => p.id !== d)
    await importAll(JSON.stringify(obj))
    expect(await db.docLinks.count()).toBe(0)
  })
})

describe('manuscript tables in backups', () => {
  it('arrived at schema version 11', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(11)
  })

  it('round-trips books/chapters/scenes/plotlines/beats', async () => {
    await db.books.add({ id: 'b1', title: 'B', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    await db.chapters.add({ id: 'c1', bookId: 'b1', title: 'C', order: 0, createdAt: 1, updatedAt: 1 })
    await db.scenes.add({
      id: 's1', bookId: 'b1', chapterId: 'c1', title: 'S', content: '<p>hi</p>', synopsis: '',
      notes: '', status: 'draft', order: 0, wordCount: 1, povPageId: null,
      castPageIds: [], locationPageIds: [], createdAt: 1, updatedAt: 1,
    })
    await db.plotlines.add({ id: 'p1', bookId: 'b1', name: 'Main', color: '#fff', kind: 'plot', order: 0, createdAt: 1, updatedAt: 1 })
    await db.beats.add({ id: 'bt1', bookId: 'b1', plotlineId: 'p1', sceneId: 's1', label: '', note: 'note', order: 0, createdAt: 1, updatedAt: 1 })

    const json = await exportAll()
    await importAll(json) // clears then restores
    expect(await db.books.count()).toBe(1)
    expect(await db.chapters.count()).toBe(1)
    expect(await db.scenes.count()).toBe(1)
    expect(await db.plotlines.count()).toBe(1)
    expect(await db.beats.count()).toBe(1)
  })

  it('an old backup (schemaVersion 10) imports with empty manuscript tables', () => {
    const { data, counts } = parseBackup(JSON.stringify({ schemaVersion: 10, pages: [] }))
    expect(data.books).toEqual([])
    expect(counts.books).toBe(0)
  })
})

// v12 adds the portable `meta` rows to backups: per-lore settings, home-page
// config, graph prefs. Two keys are deliberately device-local and must never
// travel in a backup: `lastBackupAt` (an imported value would wrongly silence
// the backup-overdue banner) and `snapshot-last-time` (would suppress
// auto-snapshots). Import MERGES meta (bulkPut, no clear) so restoring an old
// meta-less backup or snapshot never wipes current settings.
describe('meta in backups (schema v12)', () => {
  beforeEach(() => db.meta.clear())

  it('exports portable meta rows and excludes device-local bookkeeping keys', async () => {
    await db.meta.bulkPut([
      { key: 'lore-settings', value: { autolinkEnabled: false } },
      { key: 'lastBackupAt', value: 123 },
      { key: 'snapshot-last-time', value: 456 },
    ])
    const parsed = JSON.parse(await exportAll())
    expect(parsed.meta).toEqual([{ key: 'lore-settings', value: { autolinkEnabled: false } }])
  })

  it('round-trips portable meta rows through export → import', async () => {
    await db.meta.put({ key: 'home-config', value: { tagline: 'Ours is the fury', showAbout: false } })
    const json = await exportAll()
    await db.meta.clear()
    await importAll(json)
    expect((await db.meta.get('home-config'))?.value).toEqual({ tagline: 'Ours is the fury', showAbout: false })
  })

  it('applies portable rows from a backup but never its device-local keys', async () => {
    await db.meta.put({ key: 'lastBackupAt', value: 123 })
    const json = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pages: [],
      meta: [
        { key: 'home-config', value: { tagline: 'Imported' } },
        { key: 'lastBackupAt', value: 999 },
        { key: 'snapshot-last-time', value: 999 },
      ],
    })
    await importAll(json)
    expect((await db.meta.get('home-config'))?.value).toEqual({ tagline: 'Imported' })
    // This device's backup bookkeeping is preserved, and the incoming
    // snapshot timestamp is dropped rather than created.
    expect((await db.meta.get('lastBackupAt'))?.value).toBe(123)
    expect(await db.meta.get('snapshot-last-time')).toBeUndefined()
  })

  // Guards the merge-vs-clear design choice: an old backup (or snapshot taken
  // before v12) carries no meta, and restoring it must not wipe settings.
  it('importing a pre-v12 backup leaves existing meta untouched', async () => {
    await db.meta.put({ key: 'lore-settings', value: { snapshotRetention: 5 } })
    await importAll(JSON.stringify({ schemaVersion: 11, pages: [] }))
    expect((await db.meta.get('lore-settings'))?.value).toEqual({ snapshotRetention: 5 })
  })

  it('drops malformed meta rows from an untrusted backup', async () => {
    const json = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      pages: [],
      meta: [{ key: 42, value: 'x' }, 'junk', null, { value: 'no key' }, { key: 'ok', value: 1 }],
    })
    await importAll(json)
    expect(await db.meta.toArray()).toEqual([{ key: 'ok', value: 1 }])
  })

  it('MIGRATIONS: a v11 backup migrates with an empty meta array', () => {
    const out = migrateBackup({ schemaVersion: 11, pages: [] })
    expect(out.meta).toEqual([])
  })
})

// The migration wizard imports a backup into a freshly created world's DB —
// which is NOT the module-bound active `db` (that only rebinds on reload).
describe('importBackupInto — parameterized target', () => {
  it('fills the target database and leaves the active one untouched', async () => {
    await db.pages.add(samplePage('active-page'))
    const target = new LoreDB('lore-app-wizard-test')
    try {
      const json = JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        pages: [samplePage('migrated-page')],
      })
      await importBackupInto(target, json)

      expect(await target.pages.get('migrated-page')).toBeDefined()
      // The active DB neither gained the imported page nor lost its own.
      expect(await db.pages.get('migrated-page')).toBeUndefined()
      expect(await db.pages.get('active-page')).toBeDefined()
    } finally {
      await target.delete()
    }
  })

  // Sanitization-on-import for importBackupInto is covered in
  // import-sanitize.test.ts — DOMPurify needs the jsdom environment
  // (happy-dom's parser lets <script> survive).
})

describe('countAll', () => {
  it('countAll() reports what each table holds', async () => {
    await db.pages.clear()
    await db.templates.clear()
    await db.pages.bulkAdd([
      { id: 'p1', title: 'A', content: '', summary: '', tags: [], category: 'x', createdAt: 1, updatedAt: 1 },
      { id: 'p2', title: 'B', content: '', summary: '', tags: [], category: 'x', createdAt: 1, updatedAt: 1 },
    ] as never)

    const counts = await countAll()

    expect(counts.pages).toBe(2)
    expect(counts.templates).toBe(0)
    // Every BackupCounts key must be populated — a missing table would silently
    // read as `undefined` in the Settings import summary.
    for (const value of Object.values(counts)) expect(typeof value).toBe('number')
  })
})

describe('typed relationships in backups (#175)', () => {
  it('round-trips both new tables through export and import', async () => {
    await db.relationshipTypes.clear()
    await db.relationships.clear()
    await db.pages.clear()
    await db.pages.bulkAdd([
      { id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
        content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'arthur', title: 'Arthur', titleLc: 'arthur', category: 'Character',
        content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
    ])
    await db.relationshipTypes.add({
      id: 'parent-of', label: 'Parent of', inverse: 'Child of',
      color: '#e0a458', group: 'kin', order: 0, builtin: true,
    })
    await db.relationships.add({
      id: 'r1', fromId: 'uther', toId: 'arthur',
      typeId: 'parent-of', note: 'm. 1042', createdAt: 1,
    })

    const json = await exportAll()
    await db.relationships.clear()
    await db.relationshipTypes.clear()
    await importAll(json)

    expect(await db.relationshipTypes.get('parent-of')).toMatchObject({ inverse: 'Child of' })
    expect(await db.relationships.get('r1')).toMatchObject({ note: 'm. 1042' })
  })

  it('counts the new tables for the import confirmation', async () => {
    const json = await exportAll()
    const { counts } = parseBackup(json)
    expect(counts.relationships).toBe(await db.relationships.count())
    expect(counts.relationshipTypes).toBe(await db.relationshipTypes.count())
  })

  it('imports a pre-v15 backup with the new tables empty', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 14, pages: [], maps: [], pins: [], regions: [],
      templates: [], calendars: [], events: [], images: [], docLinks: [],
      books: [], chapters: [], scenes: [], plotlines: [], beats: [], meta: [],
    })
    const { data, counts } = parseBackup(legacy)
    expect(counts.relationships).toBe(0)
    expect(data.relationships).toEqual([])
    expect(data.relationshipTypes).toEqual([])
  })

  it('drops edges whose endpoints are not in the backup page set', async () => {
    const crafted = JSON.stringify({
      schemaVersion: 15,
      pages: [
        { id: 'uther', title: 'Uther', category: 'Character',
          content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
        { id: 'arthur', title: 'Arthur', category: 'Character',
          content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
      ],
      relationshipTypes: [], meta: [],
      relationships: [
        { id: 'ok', fromId: 'uther', toId: 'arthur', typeId: 't', note: '', createdAt: 1 },
        { id: 'dangling', fromId: 'uther', toId: 'ghost', typeId: 't', note: '', createdAt: 1 },
      ],
    })
    const { data } = parseBackup(crafted)
    // sanitizeBackup runs inside importAll, so assert through a real import.
    await importAll(crafted)
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual(['ok'])
    expect(data.relationships).toHaveLength(2) // parseBackup itself does not filter
  })

  it('drops a self-loop edge a hand-crafted backup could carry', async () => {
    // addRelationship refuses fromId === toId at runtime, but a hand-edited
    // backup bypasses that path. Left in, getRelationsFor would match the row on
    // both the fromId and toId indexes and render it twice (duplicate React key).
    const crafted = JSON.stringify({
      schemaVersion: 15,
      pages: [
        { id: 'uther', title: 'Uther', category: 'Character',
          content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
      ],
      relationshipTypes: [], meta: [],
      relationships: [
        { id: 'loop', fromId: 'uther', toId: 'uther', typeId: 't', note: '', createdAt: 1 },
      ],
    })
    await importAll(crafted)
    expect(await db.relationships.count()).toBe(0)
  })
})
