// src/timelineDisplay.ts
// Pure selector for the timeline's display reckoning. Lives at src/ (not
// src/db/) because it imports nothing from the database at runtime — the types
// are erased. A runtime db import here would drag the Dexie singleton along.

import type { Calendar, TimelineEvent } from './db'

/**
 * The calendar the timeline renders its dates in, highest priority first:
 *
 * 1. the reckoning the reader picked in the toolbar,
 * 2. the calendar of a deep-linked (`?event=<id>`) event, so the row is shown
 *    in the reckoning it was recorded in rather than someone else's,
 * 3. the first calendar.
 *
 * Every step falls through when its id resolves to nothing — a stale toolbar
 * pick, an event whose calendar was deleted — so a dangling deep link degrades
 * to the default view instead of blanking it. Null only when the world has no
 * calendars at all.
 */
export function resolveDisplayCalendar(
  calendars: Calendar[],
  displayCalId: string | null,
  focusEvent: TimelineEvent | undefined,
): Calendar | null {
  return (
    calendars.find((c) => c.id === displayCalId) ??
    calendars.find((c) => c.id === focusEvent?.calendarId) ??
    calendars[0] ??
    null
  )
}
