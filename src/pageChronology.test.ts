import { describe, it, expect } from 'vitest'
import { pageChronology } from './pageChronology'
import type { Calendar, TimelineEvent } from './db'

const CAL: Calendar = {
  id: 'cal-1',
  name: 'Standard Calendar',
  anchor: 0,
  months: [{ name: 'Firstmonth', days: 30 }, { name: 'Secondmonth', days: 30 }],
  weekdays: ['Moonday', 'Sunday'],
  eras: [],
  createdAt: 0,
}

const CAL_2: Calendar = { ...CAL, id: 'cal-2', name: 'Elven Reckoning', anchor: 1000 }

function ev(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    calendarId: 'cal-1',
    title: 'An Event',
    description: '',
    category: '',
    pageId: null,
    startYear: 0,
    startMonth: 0,
    startDay: 1,
    startAbsolute: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

/** An event description containing a wiki link to `title`, as Tiptap stores it. */
function mentions(title: string): string {
  return `<p>Fought at <a data-wikilink data-title="${title}">${title}</a>.</p>`
}

describe('pageChronology', () => {
  it('matches an event whose pageId is this page', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ pageId: 'p1' })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['linked'])
    expect(entries[0].calendar?.id).toBe('cal-1')
  })

  it('matches an event whose description wiki-links this page title', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ description: mentions('Aldric') })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['mention'])
  })

  it('yields one row with both roles when an event links and mentions', () => {
    const event = ev({ pageId: 'p1', description: mentions('Aldric') })
    const entries = pageChronology('p1', 'Aldric', [event], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['linked', 'mention'])
  })

  it('compares titles ignoring case and surrounding whitespace', () => {
    const entries = pageChronology('p1', '  aLdRiC ', [ev({ description: mentions('Aldric') })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['mention'])
  })

  it('skips events that neither link nor mention the page', () => {
    const events = [ev({ pageId: 'other' }), ev({ id: 'e2', description: mentions('Someone Else') })]
    expect(pageChronology('p1', 'Aldric', events, [CAL])).toEqual([])
  })

  it('interleaves events from calendars with different anchors by startAbsolute', () => {
    const events = [
      ev({ id: 'late', calendarId: 'cal-2', pageId: 'p1', startAbsolute: 1200, title: 'Late' }),
      ev({ id: 'early', calendarId: 'cal-1', pageId: 'p1', startAbsolute: 30, title: 'Early' }),
    ]
    const entries = pageChronology('p1', 'Aldric', events, [CAL, CAL_2])
    expect(entries.map((e) => e.event.id)).toEqual(['early', 'late'])
    expect(entries[1].calendar?.name).toBe('Elven Reckoning')
  })

  it('breaks startAbsolute ties by title, stably', () => {
    const events = [
      ev({ id: 'b', pageId: 'p1', startAbsolute: 5, title: 'Siege of Bel' }),
      ev({ id: 'a', pageId: 'p1', startAbsolute: 5, title: 'Alms of Ash' }),
    ]
    const entries = pageChronology('p1', 'Aldric', events, [CAL])
    expect(entries.map((e) => e.event.id)).toEqual(['a', 'b'])
  })

  it('yields calendar: null for an event whose calendar was deleted, without throwing', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ calendarId: 'gone', pageId: 'p1' })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].calendar).toBeNull()
  })

  it('returns an empty array when the page title is blank', () => {
    expect(pageChronology('p1', '   ', [ev({ description: mentions('Aldric') })], [CAL])).toEqual([])
  })
})
