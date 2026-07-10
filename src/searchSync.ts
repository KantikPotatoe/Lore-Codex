import { liveQuery, type Subscription } from 'dexie'
import { db } from './db'
import { syncSlice } from './search'
import { pageEntries, eventEntries, pinEntries, regionEntries, sceneEntries } from './searchEntries'

/**
 * Subscribe the search index to every searchable table. Each liveQuery emits its
 * whole table on any change; syncSlice re-indexes only the deltas (see search.ts),
 * and the adapters' signatures gate the expensive stripHtml. Returns an
 * unsubscribe-all. Module-level index state is otherwise discarded by the
 * window.location.reload() that switchLore() performs.
 */
export function installSearchIndex(): () => void {
  const subs: Subscription[] = [
    liveQuery(() => db.pages.toArray()).subscribe((pages) => {
      syncSlice('page', pageEntries(pages))
    }),

    // Events depend on their calendar for date text — subscribe to both.
    liveQuery(async () => ({
      events: await db.events.toArray(),
      calendars: await db.calendars.toArray(),
    })).subscribe(({ events, calendars }) => {
      syncSlice('event', eventEntries(events, calendars))
    }),

    // Pins and regions join to page titles and map names — one subscription feeds both slices.
    liveQuery(async () => ({
      pins: await db.pins.toArray(),
      regions: await db.regions.toArray(),
      pages: await db.pages.toArray(),
      maps: await db.maps.toArray(),
    })).subscribe(({ pins, regions, pages, maps }) => {
      const pageTitles = new Map(pages.map((p) => [p.id, p.title]))
      const mapNames = new Map(maps.map((m) => [m.id, m.name]))
      syncSlice('pin', pinEntries(pins, pageTitles, mapNames))
      syncSlice('region', regionEntries(regions, pageTitles, mapNames))
    }),

    // Scenes join to their chapter for the subtitle and signature.
    liveQuery(async () => ({
      scenes: await db.scenes.toArray(),
      chapters: await db.chapters.toArray(),
    })).subscribe(({ scenes, chapters }) => {
      syncSlice('scene', sceneEntries(scenes, chapters))
    }),
  ]
  return () => subs.forEach((s) => s.unsubscribe())
}
