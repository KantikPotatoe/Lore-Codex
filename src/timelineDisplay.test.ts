import { describe, it, expect } from 'vitest'
import { resolveDisplayCalendar } from './timelineDisplay'
import type { Calendar, TimelineEvent } from './db'

const IMPERIAL: Calendar = {
  id: 'cal-imperial',
  name: 'Imperial',
  anchor: 0,
  months: [{ name: 'Firstmonth', days: 30 }],
  weekdays: ['Moonday'],
  eras: [],
  createdAt: 0,
}

const ELVEN: Calendar = { ...IMPERIAL, id: 'cal-elven', name: 'Elven Reckoning', createdAt: 1 }

function ev(calendarId: string): TimelineEvent {
  return {
    id: 'e1',
    calendarId,
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
  }
}

describe('resolveDisplayCalendar', () => {
  it('prefers the toolbar pick over the deep-linked event’s calendar', () => {
    const cal = resolveDisplayCalendar([IMPERIAL, ELVEN], 'cal-elven', ev('cal-imperial'))
    expect(cal).toBe(ELVEN)
  })

  it('prefers the deep-linked event’s calendar over the first calendar', () => {
    const cal = resolveDisplayCalendar([IMPERIAL, ELVEN], null, ev('cal-elven'))
    expect(cal).toBe(ELVEN)
  })

  it('falls back to the first calendar with no pick and no deep link', () => {
    const cal = resolveDisplayCalendar([IMPERIAL, ELVEN], null, undefined)
    expect(cal).toBe(IMPERIAL)
  })

  it('falls through a stale toolbar pick to the deep-linked event’s calendar', () => {
    const cal = resolveDisplayCalendar([IMPERIAL, ELVEN], 'cal-deleted', ev('cal-elven'))
    expect(cal).toBe(ELVEN)
  })

  it('falls through an event whose calendar was deleted to the first calendar', () => {
    const cal = resolveDisplayCalendar([IMPERIAL, ELVEN], null, ev('cal-deleted'))
    expect(cal).toBe(IMPERIAL)
  })

  it('is null when the world has no calendars', () => {
    expect(resolveDisplayCalendar([], null, undefined)).toBeNull()
    expect(resolveDisplayCalendar([], 'cal-imperial', ev('cal-imperial'))).toBeNull()
  })
})
