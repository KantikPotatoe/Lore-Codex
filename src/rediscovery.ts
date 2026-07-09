import type { LorePage, TimelineEvent } from './db'

const MS_PER_DAY = 86_400_000

/** Pick a random id, or null for an empty list. `rng` injectable for tests. */
export function pickRandomId(ids: string[], rng: () => number = Math.random): string | null {
  if (ids.length === 0) return null
  return ids[Math.floor(rng() * ids.length)] ?? null
}

/** Integer day bucket, used as the featured-event rotation seed. */
export function todayIndex(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / MS_PER_DAY)
}

/** Pages whose `updatedAt` is strictly older than the cutoff, oldest first, capped. */
export function selectStalePages(
  pages: LorePage[],
  nowMs: number = Date.now(),
  opts: { thresholdDays?: number; limit?: number } = {},
): LorePage[] {
  const { thresholdDays = 90, limit = 6 } = opts
  const cutoff = nowMs - thresholdDays * MS_PER_DAY
  return pages
    .filter((p) => p.updatedAt < cutoff)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, limit)
}

/** Deterministic daily pick: stable-sort by (startAbsolute, id), index by day. */
export function pickFeaturedEvent(events: TimelineEvent[], dayIndex: number): TimelineEvent | null {
  if (events.length === 0) return null
  const sorted = [...events].sort(
    (a, b) => a.startAbsolute - b.startAbsolute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const i = ((dayIndex % sorted.length) + sorted.length) % sorted.length
  return sorted[i]
}

/** Human "N months/years ago" for the Dusty-corners hint. */
export function staleLabel(updatedAt: number, nowMs: number = Date.now()): string {
  const days = Math.floor((nowMs - updatedAt) / MS_PER_DAY)
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? '' : 's'} ago`
  }
  const months = Math.max(1, Math.floor(days / 30))
  return `${months} month${months === 1 ? '' : 's'} ago`
}
