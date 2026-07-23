// @vitest-environment jsdom
//
// Runs under jsdom (not the suite-default happy-dom) because importAll() now runs a
// DOMPurify pass, and DOMPurify needs jsdom's faithful HTML parser — see the note in
// src/sanitize.test.ts. fake-indexeddb is installed globally by setup-tests.ts, so
// db.* works here as it does under happy-dom.
import { describe, it, expect, beforeEach } from 'vitest'
import { db, LoreDB, importAll, importBackupInto, buildGraphData, type LorePage, type TimelineEvent } from '../db'
import { syncSlice, resetIndex } from '../search'
import { pageEntries } from '../searchEntries'

async function clearAll(): Promise<void> {
  await Promise.all([
    db.pages.clear(), db.maps.clear(), db.pins.clear(),
    db.templates.clear(), db.calendars.clear(), db.events.clear(),
  ])
}

beforeEach(clearAll)

const pageWith = (content: string): LorePage => ({
  id: 'p1',
  title: 'Page',
  category: 'Character',
  content,
  summary: '',
  tags: [],
  createdAt: 1,
  updatedAt: 1,
})

const eventWith = (description: string): TimelineEvent => ({
  id: 'e1',
  calendarId: 'c1',
  title: 'Event',
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

describe('importBackupInto — sanitizes non-active targets too (migration wizard)', () => {
  it("strips scripting from page content imported into another world's DB", async () => {
    const target = new LoreDB('lore-app-wizard-sanitize-test')
    try {
      await importBackupInto(
        target,
        JSON.stringify({ pages: [pageWith('<p>ok</p><script>alert(1)</script>')] }),
      )
      const content = (await target.pages.get('p1'))?.content ?? ''
      expect(content).toContain('<p>ok</p>')
      expect(content).not.toContain('<script>')
    } finally {
      await target.delete()
    }
  })
})

describe('importAll — XSS sanitization (roadmap #8)', () => {
  it('strips a <script> payload from an imported page body', async () => {
    await importAll(JSON.stringify({ pages: [pageWith('<p>lore</p><script>alert(document.cookie)</script>')] }))
    const stored = await db.pages.get('p1')
    expect(stored?.content).toContain('<p>lore</p>')
    expect(stored?.content?.toLowerCase()).not.toContain('<script')
    expect(stored?.content).not.toContain('alert(document.cookie)')
  })

  it('strips an onerror handler from an imported image', async () => {
    await importAll(JSON.stringify({ pages: [pageWith('<img src=x onerror="alert(1)">')] }))
    const stored = await db.pages.get('p1')
    expect(stored?.content?.toLowerCase()).not.toContain('onerror')
    expect(stored?.content).not.toContain('alert(1)')
  })

  it('strips scripting from an imported timeline-event description (the raw render sink)', async () => {
    await importAll(
      JSON.stringify({
        pages: [],
        events: [eventWith('<p>battle</p><img src=x onerror="fetch(`/steal`)">')],
      }),
    )
    const stored = await db.events.get('e1')
    expect(stored?.description).toContain('<p>battle</p>')
    expect(stored?.description?.toLowerCase()).not.toContain('onerror')
    expect(stored?.description).not.toContain('fetch(')
  })

  it('drops a gallery image whose dataUrl carries a quote/whitespace injection', async () => {
    await importAll(
      JSON.stringify({
        pages: [],
        images: [
          { id: 'ok', pageId: 'p1', dataUrl: 'data:image/png;base64,AAA', caption: '', order: 0, createdAt: 1 },
          { id: 'bad', pageId: 'p1', dataUrl: 'data:image/png;base64,AAA" onerror="alert(1)', caption: '', order: 1, createdAt: 1 },
        ],
      }),
    )
    expect(await db.images.get('ok')).toBeTruthy()
    expect(await db.images.get('bad')).toBeUndefined()
  })

  it('nulls an infobox.image that is not a clean image data-URL, keeps a legit one', async () => {
    const dirty = { ...pageWith('<p>x</p>'), id: 'dirty', infobox: { template: 'T', image: 'data:image/png;base64,AAA" onerror="alert(1)', caption: '', fields: [] } }
    const clean = { ...pageWith('<p>y</p>'), id: 'clean', infobox: { template: 'T', image: 'data:image/png;base64,iVBORw0KGgo=', caption: '', fields: [] } }
    await importAll(JSON.stringify({ pages: [dirty, clean] }))
    expect((await db.pages.get('dirty'))?.infobox?.image).toBeNull()
    expect((await db.pages.get('clean'))?.infobox?.image).toBe('data:image/png;base64,iVBORw0KGgo=')
  })

  it('drops a malformed page row (non-string title) instead of importing something that bricks indexing', async () => {
    // A hand-edited/truncated backup can carry a bad row; importing it must not
    // let downstream consumers (search index, graph) throw on p.title/p.tags.
    await importAll(
      JSON.stringify({ pages: [{ id: 'bad', title: 42 }, pageWith('<p>ok</p>')] }),
    )
    expect(await db.pages.get('bad')).toBeUndefined()
    expect(await db.pages.get('p1')).toBeTruthy()

    const pages = await db.pages.toArray()
    expect(() => { resetIndex(); syncSlice('page', pageEntries(pages)) }).not.toThrow()
    expect(() => buildGraphData(pages, [], [])).not.toThrow()
  })

  it('coerces a missing/invalid tags field to an array on import', async () => {
    const noTags = { id: 'nt', title: 'NoTags', category: 'Character', content: '<p>x</p>', summary: '', createdAt: 1, updatedAt: 1 }
    await importAll(JSON.stringify({ pages: [noTags] }))
    expect((await db.pages.get('nt'))?.tags).toEqual([])
  })

  it('preserves legitimate Tiptap markup (wiki links, images, tables) on import', async () => {
    const body =
      '<a data-wikilink="" data-title="Gandalf" class="wiki-link">Gandalf</a>' +
      '<img src="data:image/png;base64,iVBORw0KGgo=" alt="x">' +
      '<table><tbody><tr><td>a</td></tr></tbody></table>'
    await importAll(JSON.stringify({ pages: [pageWith(body)] }))
    const stored = await db.pages.get('p1')
    expect(stored?.content).toContain('data-wikilink')
    expect(stored?.content).toContain('data-title="Gandalf"')
    expect(stored?.content).toContain('data:image/png;base64,')
    expect(stored?.content).toContain('<table')
  })
})
