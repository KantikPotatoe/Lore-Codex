import type { IndexEntry, ResultMeta } from './search'
import type { Calendar, TimelineEvent, MapPin, MapRegion, Scene, Chapter, LorePage } from './db'
import { stripHtml } from './html'
import { formatDate } from './calendar'

/** Fields of a calendar that feed an event's indexed date text. Folded into the
 *  event signature so a month/era rename re-indexes events without touching them. */
export function calendarSignature(cal: Calendar): string {
  const months = cal.months.map((m) => m.name).join(',')
  const eras = cal.eras.map((e) => `${e.name}:${e.startYear}`).join(',')
  return `${months}\0${eras}`
}

export function pageEntries(pages: LorePage[]): IndexEntry[] {
  return pages.map((p) => ({
    id: p.id,
    signature: String(p.updatedAt),
    build: () => {
      const body = stripHtml(p.content)
      return {
        text: [p.title, p.summary, p.tags.join(' '), body].join(' '),
        snippetSource: body || p.summary,
        meta: { kind: 'page', id: p.id, title: p.title, category: p.category },
      }
    },
  }))
}

export function eventEntries(events: TimelineEvent[], calendars: Calendar[]): IndexEntry[] {
  const calById = new Map(calendars.map((c) => [c.id, c]))
  return events.map((e) => {
    const cal = calById.get(e.calendarId)
    const calSig = cal ? calendarSignature(cal) : ''
    return {
      id: e.id,
      signature: [e.updatedAt, e.calendarId, calSig].join('\0'),
      build: () => {
        const body = stripHtml(e.description)
        const date = cal ? formatDate(cal, e.startYear, e.startMonth, e.startDay) : ''
        return {
          text: [e.title, body, e.category, date].join(' '),
          snippetSource: body || e.title,
          meta: { kind: 'event', id: e.id, title: e.title, subtitle: date },
        }
      },
    }
  })
}

function pinOrRegionEntry(
  kind: 'pin' | 'region',
  rec: { id: string; label: string; mapId: string; pageId: string | null },
  pageTitles: Map<string, string>,
  mapNames: Map<string, string>,
): IndexEntry {
  const pageTitle = rec.pageId ? pageTitles.get(rec.pageId) ?? '' : ''
  const mapName = mapNames.get(rec.mapId) ?? ''
  return {
    id: rec.id,
    signature: [rec.label, rec.mapId, mapName, pageTitle].join('\0'),
    build: () => ({
      text: [rec.label, pageTitle].join(' '),
      snippetSource: rec.label,
      meta: { kind, id: rec.id, title: rec.label, subtitle: mapName },
    }),
  }
}

export function pinEntries(pins: MapPin[], pageTitles: Map<string, string>, mapNames: Map<string, string>): IndexEntry[] {
  return pins.map((p) => pinOrRegionEntry('pin', p, pageTitles, mapNames))
}

export function regionEntries(regions: MapRegion[], pageTitles: Map<string, string>, mapNames: Map<string, string>): IndexEntry[] {
  return regions.map((r) => pinOrRegionEntry('region', r, pageTitles, mapNames))
}

export function sceneEntries(scenes: Scene[], chapters: Chapter[]): IndexEntry[] {
  const chById = new Map(chapters.map((c) => [c.id, c]))
  return scenes.map((s) => {
    const ch = chById.get(s.chapterId)
    return {
      id: s.id,
      signature: [s.updatedAt, ch?.title ?? '', ch?.order ?? ''].join('\0'),
      build: () => {
        const body = stripHtml(s.content)
        return {
          text: [s.title, s.synopsis, s.notes, body].join(' '),
          snippetSource: body || s.synopsis,
          meta: { kind: 'scene', id: s.id, title: s.title, subtitle: ch?.title ?? '', bookId: s.bookId },
        }
      },
    }
  })
}

/** The navigation target for a result row. Mirrors the existing deep links:
 *  ?pin= / ?event= / ?scene= already handled by their routes; ?region= added in
 *  the MapRoute task. */
export function resultHref(r: ResultMeta): string {
  switch (r.kind) {
    case 'page': return `/page/${r.id}`
    case 'event': return `/timeline?event=${r.id}`
    case 'pin': return `/map?pin=${r.id}`
    case 'region': return `/map?region=${r.id}`
    case 'scene': return `/book/${r.bookId}?scene=${r.id}`
  }
}
