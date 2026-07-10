// src/pageChronology.ts
// Pure matcher: which timeline events reference a given page, in chronological
// order. No React, no Dexie — the component supplies the rows. Lives at src/
// (not src/db/) because it imports nothing from the database at runtime: types
// are erased and wikiLinkTitles is itself pure. A runtime db import here would
// drag the Dexie singleton into every consumer.

import { wikiLinkTitles } from './html'
import type { Calendar, TimelineEvent } from './db'

/** How an event refers to the page. `linked` is the curated `event.pageId` ref
 *  (survives a rename, it stores an id); `mention` is a wiki link to the page
 *  title in the event's description. An event can be both. */
export type ChronologyRole = 'linked' | 'mention'

export interface ChronologyEntry {
  event: TimelineEvent
  /** The event's calendar, or null if it has since been deleted. */
  calendar: Calendar | null
  /** Never empty. `linked` precedes `mention` when both apply. */
  roles: ChronologyRole[]
}

/**
 * Every event that references this page, sorted by the shared absolute-day axis
 * so events recorded in different calendars still read as one chronology.
 * Ties break by title, keeping the order stable across renders.
 */
export function pageChronology(
  pageId: string,
  title: string,
  events: TimelineEvent[],
  calendars: Calendar[],
): ChronologyEntry[] {
  const titleLc = title.trim().toLowerCase()
  const calById = new Map(calendars.map((c) => [c.id, c]))

  const entries: ChronologyEntry[] = []
  for (const event of events) {
    const roles: ChronologyRole[] = []
    if (pageId && event.pageId === pageId) roles.push('linked')
    if (
      titleLc &&
      wikiLinkTitles(event.description).some((t) => t.trim().toLowerCase() === titleLc)
    ) {
      roles.push('mention')
    }
    if (roles.length === 0) continue
    entries.push({ event, calendar: calById.get(event.calendarId) ?? null, roles })
  }

  entries.sort(
    (a, b) =>
      a.event.startAbsolute - b.event.startAbsolute ||
      a.event.title.localeCompare(b.event.title),
  )
  return entries
}
