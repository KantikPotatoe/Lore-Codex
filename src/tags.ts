import type { LorePage } from './db'

/** Aggregate every page's tags into { tag, count } entries, most-used first
 *  (ties broken alphabetically). Pure — no React/Dexie — so the ordering is
 *  unit-testable on its own, mirroring toc.ts / autolink.ts. */
export function tagCounts(pages: LorePage[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const p of pages) {
    for (const tag of p.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** Pick which tag chips the graph toolbar shows: the most-used `limit` tags,
 *  in `counts` order, with every selected tag force-promoted so a live
 *  selection can never hide behind the "+N more" disclosure. Promotion
 *  displaces the lowest-ranked unselected chip rather than growing the row, so
 *  `shown` only exceeds `limit` when more than `limit` tags are selected. */
export function orderTagChips(
  counts: { tag: string; count: number }[],
  selected: Set<string>,
  limit: number,
): { shown: string[]; hiddenCount: number } {
  const ordered = counts.map((c) => c.tag)
  const picked = new Set(ordered.filter((t) => selected.has(t)))
  for (const t of ordered) {
    if (picked.size >= limit) break
    picked.add(t)
  }
  // Re-read in count order so promotion doesn't reshuffle the row.
  const shown = ordered.filter((t) => picked.has(t))
  return { shown, hiddenCount: ordered.length - shown.length }
}
