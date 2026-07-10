import { describe, it, expect } from 'vitest'
import {
  calendarSignature, pageEntries, eventEntries, pinEntries, regionEntries, sceneEntries, resultHref,
} from './searchEntries'
import type { Calendar, TimelineEvent, MapPin, MapRegion, Scene, Chapter, LorePage } from './db'

// searchEntries uses stripHtml (DOMParser) inside build(); happy-dom default env applies.

const cal = (over: Partial<Calendar> = {}): Calendar => ({
  id: 'c1', name: 'Reckoning', anchor: 0,
  months: [{ name: 'Seedfall', days: 30 }, { name: 'Highsun', days: 30 }],
  weekdays: [], eras: [{ id: 'e', name: 'Imperial Era', startYear: 0 }],
  createdAt: 1, ...over,
})

const event = (over: Partial<TimelineEvent> & { id: string }): TimelineEvent => ({
  calendarId: 'c1', title: '', description: '', category: '', pageId: null,
  startYear: 412, startMonth: 0, startDay: 9, startAbsolute: 0, createdAt: 1, updatedAt: 1, ...over,
})

describe('calendarSignature', () => {
  it('changes when a month is renamed, so an event re-indexes though its own record is untouched', () => {
    const a = calendarSignature(cal())
    const b = calendarSignature(cal({ months: [{ name: 'Ashfall', days: 30 }, { name: 'Highsun', days: 30 }] }))
    expect(a).not.toBe(b)
  })
  it('changes when an era is renamed', () => {
    const a = calendarSignature(cal())
    const b = calendarSignature(cal({ eras: [{ id: 'e', name: 'Dark Era', startYear: 0 }] }))
    expect(a).not.toBe(b)
  })
})

describe('pageEntries', () => {
  const page = (over: Partial<LorePage> & { id: string }): LorePage => ({
    title: '', category: '', content: '', summary: '', tags: [], status: 'idea',
    createdAt: 1, updatedAt: 1, ...over,
  })

  it('indexes title, summary, tags, and stripped content', () => {
    const [entry] = pageEntries([page({ id: 'p', title: 'Ashfall Crater', summary: 'a scar', tags: ['place'], content: '<p>the <b>rim</b> glows</p>', category: 'Location' })])
    const built = entry.build()
    expect(built.text).toContain('Ashfall Crater')
    expect(built.text).toContain('a scar')
    expect(built.text).toContain('place')
    expect(built.text).toContain('rim') // HTML stripped
    expect(built.meta).toMatchObject({ kind: 'page', id: 'p', title: 'Ashfall Crater', category: 'Location' })
  })
})

describe('eventEntries', () => {
  it('indexes title, stripped description, category, and formatted date from the right calendar', () => {
    const [entry] = eventEntries([event({ id: 'e', title: 'Ashfall begins', description: '<p>the <b>sky</b> darkened</p>', category: 'Battle' })], [cal()])
    const built = entry.build()
    expect(built.text).toContain('Ashfall begins')
    expect(built.text).toContain('sky') // HTML stripped
    expect(built.text).toContain('Battle')
    expect(built.text).toContain('Seedfall') // month name from the calendar
    expect(built.meta).toMatchObject({ kind: 'event', id: 'e', title: 'Ashfall begins' })
    expect(built.meta.kind === 'event' && built.meta.subtitle).toContain('Year 412')
  })
  it('folds the calendar signature into the event signature', () => {
    const [a] = eventEntries([event({ id: 'e' })], [cal()])
    const [b] = eventEntries([event({ id: 'e' })], [cal({ months: [{ name: 'Ashfall', days: 30 }, { name: 'Highsun', days: 30 }] })])
    expect(a.signature).not.toBe(b.signature)
  })
  it('indexes an event whose calendar is missing (no date text, empty subtitle)', () => {
    const [entry] = eventEntries([event({ id: 'e', title: 'Orphan', calendarId: 'gone' })], [])
    const built = entry.build()
    expect(built.text).toContain('Orphan')
    expect(built.meta.kind === 'event' && built.meta.subtitle).toBe('')
  })
})

describe('pinEntries / regionEntries', () => {
  const pin = (over: Partial<MapPin> & { id: string }): MapPin => ({ mapId: 'm1', lat: 0, lng: 0, label: '', pageId: null, ...over })
  const pageTitles = new Map([['p1', 'Ashfall Crater']])
  const mapNames = new Map([['m1', 'Northern Reach']])

  it('indexes label + linked page title; map name goes to subtitle, not text', () => {
    const [entry] = pinEntries([pin({ id: 'x', label: 'crater', pageId: 'p1' })], pageTitles, mapNames)
    const built = entry.build()
    expect(built.text).toContain('crater')
    expect(built.text).toContain('Ashfall Crater') // linked page title indexed
    expect(built.text).not.toContain('Northern Reach') // map name is display-only
    expect(built.meta.kind === 'pin' && built.meta.subtitle).toBe('Northern Reach')
  })
  it('indexes a pin whose linked page was deleted (findable by label)', () => {
    const [entry] = pinEntries([pin({ id: 'x', label: 'crater', pageId: 'gone' })], pageTitles, mapNames)
    expect(entry.build().text).toContain('crater')
  })
  it('regionEntries mirrors pinEntries and emits kind region', () => {
    const region: MapRegion = { id: 'r', mapId: 'm1', points: [[0, 0]], label: 'reach', pageId: 'p1' }
    const [entry] = regionEntries([region], pageTitles, mapNames)
    expect(entry.build().meta.kind).toBe('region')
  })
})

describe('sceneEntries', () => {
  const scene = (over: Partial<Scene> & { id: string }): Scene => ({
    bookId: 'b1', chapterId: 'ch1', title: '', content: '', synopsis: '', notes: '',
    status: 'draft', order: 0, wordCount: 0, povPageId: null, castPageIds: [], locationPageIds: [],
    createdAt: 1, updatedAt: 1, ...over,
  })
  const chapters: Chapter[] = [{ id: 'ch1', bookId: 'b1', title: 'The Ash Falls', order: 2, createdAt: 1, updatedAt: 1 }]

  it('indexes title + synopsis + notes + stripped content and carries bookId + chapter subtitle', () => {
    const [entry] = sceneEntries([scene({ id: 's', title: 'Descent', synopsis: 'she flees', notes: 'foreshadow', content: '<p>the <i>ashfall</i> settled</p>' })], chapters)
    const built = entry.build()
    expect(built.text).toContain('Descent')
    expect(built.text).toContain('she flees')
    expect(built.text).toContain('foreshadow')
    expect(built.text).toContain('ashfall') // HTML stripped
    expect(built.meta).toMatchObject({ kind: 'scene', id: 's', bookId: 'b1' })
    expect(built.meta.kind === 'scene' && built.meta.subtitle).toBe('The Ash Falls')
  })
  it('indexes a scene whose chapter is missing (empty subtitle)', () => {
    const [entry] = sceneEntries([scene({ id: 's', title: 'Lost', chapterId: 'gone' })], chapters)
    const built = entry.build()
    expect(built.text).toContain('Lost')
    expect(built.meta.kind === 'scene' && built.meta.subtitle).toBe('')
  })
})

describe('resultHref', () => {
  it('routes each kind to its target', () => {
    expect(resultHref({ kind: 'page', id: 'a', title: '', category: '' })).toBe('/page/a')
    expect(resultHref({ kind: 'event', id: 'e', title: '', subtitle: '' })).toBe('/timeline?event=e')
    expect(resultHref({ kind: 'pin', id: 'p', title: '', subtitle: '' })).toBe('/map?pin=p')
    expect(resultHref({ kind: 'region', id: 'r', title: '', subtitle: '' })).toBe('/map?region=r')
    expect(resultHref({ kind: 'scene', id: 's', title: '', subtitle: '', bookId: 'b' })).toBe('/book/b?scene=s')
  })
})
