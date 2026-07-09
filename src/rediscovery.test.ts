import { describe, it, expect } from 'vitest'
import type { LorePage, TimelineEvent } from './db'
import {
  pickRandomId, todayIndex, selectStalePages, pickFeaturedEvent, staleLabel,
} from './rediscovery'

const DAY = 86_400_000

function page(id: string, updatedAt: number): LorePage {
  return { id, title: id, updatedAt } as unknown as LorePage
}
function event(id: string, startAbsolute: number): TimelineEvent {
  return { id, startAbsolute } as unknown as TimelineEvent
}

describe('pickRandomId', () => {
  it('returns null for an empty list', () => {
    expect(pickRandomId([])).toBeNull()
  })
  it('returns the only id for a singleton', () => {
    expect(pickRandomId(['a'])).toBe('a')
  })
  it('uses the injected rng to index deterministically', () => {
    expect(pickRandomId(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickRandomId(['a', 'b', 'c'], () => 0.99)).toBe('c')
  })
})

describe('todayIndex', () => {
  it('floors ms to a day bucket', () => {
    expect(todayIndex(0)).toBe(0)
    expect(todayIndex(DAY + 5)).toBe(1)
    expect(todayIndex(2 * DAY - 1)).toBe(1)
  })
})

describe('selectStalePages', () => {
  const now = 1_000 * DAY
  it('keeps only pages older than the threshold, oldest first', () => {
    const pages = [
      page('fresh', now - 10 * DAY),
      page('old', now - 200 * DAY),
      page('older', now - 400 * DAY),
    ]
    expect(selectStalePages(pages, now).map((p) => p.id)).toEqual(['older', 'old'])
  })
  it('excludes a page exactly at the cutoff boundary', () => {
    const pages = [page('edge', now - 90 * DAY)]
    expect(selectStalePages(pages, now)).toEqual([])
  })
  it('caps at the limit', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page(`p${i}`, now - (100 + i) * DAY))
    expect(selectStalePages(pages, now, { limit: 3 })).toHaveLength(3)
  })
  it('is empty when all pages are fresh', () => {
    expect(selectStalePages([page('a', now)], now)).toEqual([])
  })
})

describe('pickFeaturedEvent', () => {
  it('returns null with no events', () => {
    expect(pickFeaturedEvent([], 5)).toBeNull()
  })
  it('rotates as the day index advances', () => {
    const events = [event('a', 0), event('b', 10), event('c', 20)]
    expect(pickFeaturedEvent(events, 0)!.id).toBe('a')
    expect(pickFeaturedEvent(events, 1)!.id).toBe('b')
    expect(pickFeaturedEvent(events, 3)!.id).toBe('a')
  })
  it('is stable regardless of input order', () => {
    const a = [event('a', 0), event('b', 10), event('c', 20)]
    const b = [event('c', 20), event('a', 0), event('b', 10)]
    expect(pickFeaturedEvent(a, 2)!.id).toBe(pickFeaturedEvent(b, 2)!.id)
  })
  it('handles a negative day index safely', () => {
    const events = [event('a', 0), event('b', 10)]
    expect(pickFeaturedEvent(events, -1)!.id).toBe('b')
  })
})

describe('staleLabel', () => {
  it('renders months for sub-year gaps', () => {
    expect(staleLabel(0, 200 * DAY)).toBe('6 months ago')
    expect(staleLabel(0, 40 * DAY)).toBe('1 month ago')
  })
  it('renders years past 365 days', () => {
    expect(staleLabel(0, 400 * DAY)).toBe('1 year ago')
    expect(staleLabel(0, 800 * DAY)).toBe('2 years ago')
  })
})
