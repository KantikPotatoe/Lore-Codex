import { db, uid, now } from './schema'
import { dateToAbsolute } from '../calendar'
import type { CalendarMonth, Calendar, TimelineEvent } from './types'

// ---------------------------------------------------------------------------
// Timeline calendars — CRUD
// ---------------------------------------------------------------------------
// Note: the pure date math lives in ../calendar; this module is the Dexie-backed
// CRUD that keeps each event's cached absolute-day fields in sync.

const DEFAULT_CALENDAR_MONTHS: CalendarMonth[] = [
  { name: 'January', days: 31 }, { name: 'February', days: 28 },
  { name: 'March', days: 31 },   { name: 'April', days: 30 },
  { name: 'May', days: 31 },     { name: 'June', days: 30 },
  { name: 'July', days: 31 },    { name: 'August', days: 31 },
  { name: 'September', days: 30 },{ name: 'October', days: 31 },
  { name: 'November', days: 30 }, { name: 'December', days: 31 },
]

/**
 * Seed a single "Standard Calendar" on first app start if no calendars exist yet.
 * Safe to call repeatedly (checks count first). Modeled on seedTemplates().
 */
export async function seedDefaultCalendar(): Promise<void> {
  // Wrap the count-then-add in one rw transaction so concurrent invocations
  // serialize. React StrictMode double-invokes the startup effect in dev; without
  // the transaction both calls see count 0 and each add a calendar, leaving two
  // "Standard Calendar"s. Inside a transaction the second call runs only after
  // the first commits and the count guard short-circuits it.
  await db.transaction('rw', db.calendars, async () => {
    const count = await db.calendars.count()
    if (count > 0) return
    await db.calendars.add({
      id: uid(),
      name: 'Standard Calendar',
      anchor: 0,
      months: DEFAULT_CALENDAR_MONTHS,
      weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      eras: [{ id: uid(), name: 'Common Era', startYear: 0 }],
      createdAt: now(),
    })
  })
}

/** Create a new calendar with default months and weekdays. Returns its id. */
export async function createCalendar(name: string): Promise<string> {
  const id = uid()
  await db.calendars.add({
    id,
    name: name.trim() || 'New Calendar',
    anchor: 0,
    months: DEFAULT_CALENDAR_MONTHS.map((m) => ({ ...m })),
    weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    eras: [],
    createdAt: now(),
  })
  return id
}

/**
 * Update a calendar. If months or anchor change, recomputes startAbsolute / endAbsolute
 * for all events belonging to that calendar so sort order stays correct.
 */
export async function updateCalendar(id: string, changes: Partial<Calendar>): Promise<void> {
  if (!('months' in changes || 'anchor' in changes)) {
    await db.calendars.update(id, changes)
    return
  }
  await db.transaction('rw', db.calendars, db.events, async () => {
    await db.calendars.update(id, changes)
    const cal = await db.calendars.get(id)
    if (!cal) return
    const events = await db.events.where('calendarId').equals(id).toArray()
    await Promise.all(
      events.map((e) => {
        const startAbsolute = dateToAbsolute(cal, e.startYear, e.startMonth, e.startDay)
        const endAbsolute =
          e.endYear != null
            ? dateToAbsolute(cal, e.endYear, e.endMonth ?? 0, e.endDay ?? 1)
            : undefined
        return db.events.update(e.id, { startAbsolute, endAbsolute })
      }),
    )
  })
}

/**
 * Delete a calendar and cascade-delete all its events.
 * Mirrors the deleteMap pattern (transaction).
 */
export async function deleteCalendar(calendarId: string): Promise<void> {
  await db.transaction('rw', db.calendars, db.events, async () => {
    await db.calendars.delete(calendarId)
    await db.events.where('calendarId').equals(calendarId).delete()
  })
}

// ---------------------------------------------------------------------------
// Timeline events — CRUD
// ---------------------------------------------------------------------------

export type NewEventData = Omit<TimelineEvent, 'id' | 'startAbsolute' | 'endAbsolute' | 'createdAt' | 'updatedAt'>

/** Add a timeline event. Computes startAbsolute / endAbsolute automatically. */
export async function addEvent(data: NewEventData): Promise<string> {
  const cal = await db.calendars.get(data.calendarId)
  if (!cal) throw new Error('Calendar not found')
  const startAbsolute = dateToAbsolute(cal, data.startYear, data.startMonth, data.startDay)
  const endAbsolute =
    data.endYear != null
      ? dateToAbsolute(cal, data.endYear, data.endMonth ?? 0, data.endDay ?? 1)
      : undefined
  const id = uid()
  await db.events.add({
    ...data,
    id,
    startAbsolute,
    endAbsolute,
    createdAt: now(),
    updatedAt: now(),
  })
  return id
}

/** Update a timeline event. Always recomputes startAbsolute / endAbsolute. */
export async function updateEvent(
  id: string,
  changes: Partial<Omit<TimelineEvent, 'id' | 'createdAt'>>,
): Promise<void> {
  const existing = await db.events.get(id)
  if (!existing) return
  const merged = { ...existing, ...changes }
  const cal = await db.calendars.get(merged.calendarId)
  if (!cal) throw new Error('Calendar not found')
  const startAbsolute = dateToAbsolute(cal, merged.startYear, merged.startMonth, merged.startDay)
  const endAbsolute =
    merged.endYear != null
      ? dateToAbsolute(cal, merged.endYear, merged.endMonth ?? 0, merged.endDay ?? 1)
      : undefined
  await db.events.update(id, { ...changes, startAbsolute, endAbsolute, updatedAt: now() })
}

/** Delete a timeline event. */
export async function deleteEvent(id: string): Promise<void> {
  await db.events.delete(id)
}
