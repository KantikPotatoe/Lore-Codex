import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  createPage,
  updatePage,
  deletePage,
  findPageIdByTitle,
  renamePage,
  getBacklinks,
  linkedTitlesCached,
  clearLinkedTitlesCache,
  type Infobox,
  type LorePage,
} from '../db'

// pages.ts owns the link-resolution and atomic rename/rewrite logic the whole
// wiki depends on. These tests run against the in-memory Dexie DB (cleared each
// time) and pin: title resolution, renamePage rewriting every reference while
// leaving the rest untouched, the clash guard, and backlink gathering.

beforeEach(async () => {
  await db.pages.clear()
  await db.images.clear()
  await db.pins.clear()
  await db.regions.clear()
  await db.events.clear()
  await db.scenes.clear()
})

/** A minimal scene row carrying the given prose. */
async function addScene(id: string, content: string): Promise<string> {
  await db.scenes.add({
    id,
    bookId: 'bk',
    chapterId: 'ch',
    title: 'S',
    content,
    synopsis: '',
    notes: '',
    status: 'draft',
    order: 0,
    wordCount: 0,
    povPageId: null,
    castPageIds: [],
    locationPageIds: [],
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** A minimal timeline event carrying the given rich-text description. */
async function addEvent(id: string, description: string): Promise<string> {
  await db.events.add({
    id,
    calendarId: 'c1',
    title: 'E',
    description,
    category: 'Battle',
    pageId: null,
    startYear: 1,
    startMonth: 0,
    startDay: 1,
    startAbsolute: 0,
    createdAt: 1,
    updatedAt: 1,
  })
  return id
}

/** A body anchor linking to `title` (matches what the editor emits). */
function link(title: string): string {
  return `<a data-wikilink data-title="${title}">${title}</a>`
}

function refInfobox(value: string): Infobox {
  return {
    template: 'X',
    image: null,
    caption: '',
    fields: [{ id: 'f1', label: 'Ally', value, fieldType: 'ref' }],
  }
}

describe('createPage', () => {
  it('rejects an explicit title that clashes with an existing page (case-insensitive)', async () => {
    await createPage({ title: 'Gondor' })
    await expect(createPage({ title: '  gondor ' })).rejects.toThrow(/already exists/)
    // The clashing page was not added.
    expect(await db.pages.count()).toBe(1)
  })

  it('stamps the indexed titleLc (trimmed + lowercased) so lookups are indexed', async () => {
    const id = await createPage({ title: '  The Grey  Havens ' })
    const page = await db.pages.get(id)
    expect(page?.titleLc).toBe('the grey  havens')
    // Resolvable through the titleLc index the lookups now use.
    expect(await db.pages.where('titleLc').equals('the grey  havens').first()).toMatchObject({ id })
  })

  it('still allows repeated blank pages (the default Untitled is exempt)', async () => {
    await createPage()
    await createPage()
    const titles = (await db.pages.toArray()).map((p) => p.title)
    expect(titles).toEqual(['Untitled', 'Untitled'])
  })
})

describe('deletePage', () => {
  it('unlinks pins that pointed at the deleted page', async () => {
    const pageId = await createPage({ title: 'Doomed' })
    await db.pins.add({ id: 'pin1', mapId: 'm1', lat: 0, lng: 0, label: 'X', pageId })
    await db.pins.add({ id: 'pin2', mapId: 'm1', lat: 1, lng: 1, label: 'Y', pageId: null })

    await deletePage(pageId)

    expect((await db.pins.get('pin1'))!.pageId).toBeNull()
    expect((await db.pins.get('pin2'))!.pageId).toBeNull() // untouched
  })

  it('unlinks map regions that pointed at the deleted page', async () => {
    const pageId = await createPage({ title: 'Doomed' })
    await db.regions.add({ id: 'r1', mapId: 'm1', pageId, points: [], label: 'X' })
    await db.regions.add({ id: 'r2', mapId: 'm1', pageId: 'other', points: [], label: 'Y' })

    await deletePage(pageId)

    expect((await db.regions.get('r1'))!.pageId).toBeNull()
    expect((await db.regions.get('r2'))!.pageId).toBe('other') // untouched
  })

  it('unlinks timeline events that pointed at the deleted page', async () => {
    const pageId = await createPage({ title: 'Doomed' })
    await addEvent('ev1', '<p>x</p>')
    await db.events.update('ev1', { pageId })

    await deletePage(pageId)

    expect((await db.events.get('ev1'))!.pageId).toBeNull()
  })

  it('drops the deleted page from scene POV/cast/location refs', async () => {
    const pageId = await createPage({ title: 'Doomed' })
    const keep = await createPage({ title: 'Kept' })
    await addScene('sc1', '<p>x</p>')
    await db.scenes.update('sc1', {
      povPageId: pageId,
      castPageIds: [pageId, keep],
      locationPageIds: [pageId],
    })

    await deletePage(pageId)

    const s = (await db.scenes.get('sc1'))!
    expect(s.povPageId).toBeNull()
    expect(s.castPageIds).toEqual([keep])
    expect(s.locationPageIds).toEqual([])
  })
})

describe('findPageIdByTitle', () => {
  it('finds a page case-insensitively and trimming the query', async () => {
    const id = await createPage({ title: 'The Shire' })
    expect(await findPageIdByTitle('  the shire ')).toBe(id)
  })

  it('returns null when no page has that title', async () => {
    await createPage({ title: 'Gondor' })
    expect(await findPageIdByTitle('Mordor')).toBeNull()
  })
})

describe('renamePage', () => {
  it('renames the page and rewrites a body anchor (attr + text) on another page', async () => {
    const target = await createPage({ title: 'Frodo' })
    const linker = await createPage({ title: 'Sam', content: `<p>knows ${link('Frodo')}</p>` })

    await renamePage(target, 'Frodo Baggins')

    expect((await db.pages.get(target))!.title).toBe('Frodo Baggins')
    // titleLc tracks the rename so indexed lookups keep resolving.
    expect((await db.pages.get(target))!.titleLc).toBe('frodo baggins')
    expect(await findPageIdByTitle('FRODO BAGGINS')).toBe(target)
    const body = (await db.pages.get(linker))!.content
    expect(body).toContain('data-title="Frodo Baggins"')
    expect(body).toContain('>Frodo Baggins<')
    expect(body).not.toContain('data-title="Frodo"')
  })

  it('rewrites infobox [[tokens]] that referenced the old title', async () => {
    const target = await createPage({ title: 'Frodo' })
    const linker = await createPage({ title: 'Sam', infobox: refInfobox('[[Frodo]]') })

    await renamePage(target, 'Frodo Baggins')

    const box = (await db.pages.get(linker))!.infobox!
    expect(box.fields[0].value).toBe('[[Frodo Baggins]]')
  })

  it('throws on a title clash and does not rename', async () => {
    const a = await createPage({ title: 'Gondor' })
    await createPage({ title: 'Mordor' })

    await expect(renamePage(a, 'Mordor')).rejects.toThrow(/already exists/)
    expect((await db.pages.get(a))!.title).toBe('Gondor')
  })

  it('no-ops on an empty or unchanged title', async () => {
    const id = await createPage({ title: 'Gondor' })
    const before = (await db.pages.get(id))!.updatedAt

    await renamePage(id, '   ')
    await renamePage(id, 'Gondor')

    const after = await db.pages.get(id)
    expect(after!.title).toBe('Gondor')
    expect(after!.updatedAt).toBe(before)
  })

  it('leaves pages that never referenced the renamed page untouched', async () => {
    const target = await createPage({ title: 'Frodo' })
    const bystander = await createPage({ title: 'Aragorn', content: '<p>no links here</p>' })
    const beforeStamp = (await db.pages.get(bystander))!.updatedAt
    // Make a detectable gap so an unexpected rewrite would change updatedAt.
    await updatePage(target, {})

    await renamePage(target, 'Frodo Baggins')

    expect((await db.pages.get(bystander))!.updatedAt).toBe(beforeStamp)
  })

  it('rewrites a wiki-link in a manuscript scene body', async () => {
    const target = await createPage({ title: 'Frodo' })
    const scene = await addScene('sc1', `<p>then ${link('Frodo')} spoke</p>`)

    await renamePage(target, 'Frodo Baggins')

    const body = (await db.scenes.get(scene))!.content
    expect(body).toContain('data-title="Frodo Baggins"')
    expect(body).toContain('>Frodo Baggins<')
    expect(body).not.toContain('data-title="Frodo"')
  })

  it('rewrites wiki-links and citations in a timeline-event description', async () => {
    const target = await createPage({ title: 'Frodo' })
    const cite = `<sup data-citation data-target="Frodo" data-locator="p.2"></sup>`
    const event = await addEvent('ev1', `<p>${link('Frodo')} arrives${cite}</p>`)

    await renamePage(target, 'Frodo Baggins')

    const desc = (await db.events.get(event))!.description
    expect(desc).toContain('data-title="Frodo Baggins"')
    expect(desc).toContain('data-target="Frodo Baggins"')
    expect(desc).not.toContain('"Frodo"')
    expect(desc).toContain('data-locator="p.2"')
  })

  it('leaves scenes/events that never referenced the renamed page untouched', async () => {
    const target = await createPage({ title: 'Frodo' })
    const scene = await addScene('sc2', '<p>no links here</p>')
    const event = await addEvent('ev2', '<p>nothing</p>')

    await renamePage(target, 'Frodo Baggins')

    expect((await db.scenes.get(scene))!.updatedAt).toBe(1)
    expect((await db.events.get(event))!.updatedAt).toBe(1)
  })

  it('rewrites a citation marker that targeted the old title', async () => {
    const target = await createPage({ title: 'Frodo' })
    const cited = `<sup data-citation data-target="Frodo" data-locator="p.2" class="citation"></sup>`
    const linker = await createPage({ title: 'Sam', content: `<p>knows him${cited}</p>` })

    await renamePage(target, 'Frodo Baggins')

    const body = (await db.pages.get(linker))!.content
    expect(body).toContain('data-target="Frodo Baggins"')
    expect(body).not.toContain('data-target="Frodo"')
    expect(body).toContain('data-locator="p.2"') // other attrs untouched
  })
})

describe('getBacklinks', () => {
  it('finds linkers via body and infobox, excludes self, sorts by title', async () => {
    const target = await createPage({ title: 'Frodo' })
    // Self-reference must not count.
    await updatePage(target, { content: `<p>${link('Frodo')}</p>` })
    const zed = await createPage({ title: 'Zed', content: `<p>${link('Frodo')}</p>` })
    const amy = await createPage({ title: 'Amy', infobox: refInfobox('[[Frodo]]') })
    await createPage({ title: 'Nobody', content: '<p>nothing</p>' })

    const backlinks = await getBacklinks(target)
    expect(backlinks.map((p) => p.id)).toEqual([amy, zed])
  })

  it('returns [] for an unknown page id', async () => {
    expect(await getBacklinks('does-not-exist')).toEqual([])
  })
})

describe('linkedTitlesCached', () => {
  beforeEach(() => clearLinkedTitlesCache())

  const pageWith = (over: Partial<LorePage>): LorePage => ({
    id: 'p', title: 'P', category: 'Character', content: '', summary: '',
    tags: [], createdAt: 1, updatedAt: 1, ...over,
  })

  it('returns the same linked titles as linkedTitles', () => {
    const page = pageWith({ content: `<p>${link('Rohan')} and ${link('Gondor')}</p>` })
    expect(linkedTitlesCached(page)).toEqual(new Set(['rohan', 'gondor']))
  })

  it('memoizes by (id, updatedAt): a body change with the SAME updatedAt is not re-parsed', () => {
    const first = pageWith({ updatedAt: 5, content: `<p>${link('Rohan')}</p>` })
    expect(linkedTitlesCached(first)).toEqual(new Set(['rohan']))
    // Same id + updatedAt but different body → served from cache (stale on purpose;
    // in practice every content edit bumps updatedAt).
    const restamped = pageWith({ updatedAt: 5, content: `<p>${link('Mordor')}</p>` })
    expect(linkedTitlesCached(restamped)).toEqual(new Set(['rohan']))
  })

  it('recomputes when updatedAt advances', () => {
    expect(linkedTitlesCached(pageWith({ updatedAt: 5, content: `<p>${link('Rohan')}</p>` })))
      .toEqual(new Set(['rohan']))
    expect(linkedTitlesCached(pageWith({ updatedAt: 6, content: `<p>${link('Mordor')}</p>` })))
      .toEqual(new Set(['mordor']))
  })
})
