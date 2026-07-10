import { linkedTitlesRawCached } from './pages'
import { pageStatus } from './schema'
import type { LorePage } from './types'

// ---------------------------------------------------------------------------
// World health — the worldbuilder's to-do list: what's dangling, unreachable,
// or unwritten. A pure function over the page list, like buildGraphData.
// ---------------------------------------------------------------------------

/** A page title that is linked to but does not exist, plus every page that
 *  references it. Counted by title, not by occurrence: creating the page once
 *  clears all of `sources` at a stroke. `title` keeps the casing the author
 *  typed, because that is what the Create action names the new page. */
export interface BrokenLink {
  title: string
  sources: LorePage[]
}

export interface WorldHealth {
  /** Most-referenced first, ties broken by title. */
  brokenLinks: BrokenLink[]
  /** Pages nothing links to, by title. Linking outward does not save a page. */
  orphans: LorePage[]
  /** Pages still marked Stub, by title. */
  stubs: LorePage[]
}

/** Analyse a world's pages for broken links, orphans, and stubs.
 *
 *  Self-links count as neither an incoming link nor a broken link, matching
 *  `buildGraphData` — so a page whose only inbound reference is itself is
 *  correctly an orphan. Title resolution is case- and whitespace-insensitive;
 *  display and page creation use the author's original casing. */
export function computeWorldHealth(pages: LorePage[]): WorldHealth {
  // Last-write-wins on titles that collide case-insensitively. createPage/
  // renamePage reject clashes going forward, but backup import does not
  // re-validate title uniqueness — so a duplicate-titled world (from an old or
  // hand-edited backup) can mis-report the earlier page as an orphan.
  const idByTitle = new Map<string, string>()
  for (const p of pages) idByTitle.set(p.title.trim().toLowerCase(), p.id)

  const hasIncoming = new Set<string>()
  const brokenByKey = new Map<string, BrokenLink>()

  for (const page of pages) {
    // Already trimmed and deduped by lowercased title, first casing winning.
    for (const raw of linkedTitlesRawCached(page)) {
      const key = raw.toLowerCase()
      const targetId = idByTitle.get(key)
      if (targetId === page.id) continue // self-link
      if (targetId) {
        hasIncoming.add(targetId)
        continue
      }
      const existing = brokenByKey.get(key)
      if (existing) existing.sources.push(page)
      else brokenByKey.set(key, { title: raw, sources: [page] })
    }
  }

  const byTitle = (a: LorePage, b: LorePage) => a.title.localeCompare(b.title)

  return {
    brokenLinks: [...brokenByKey.values()]
      .map((b) => ({ ...b, sources: [...b.sources].sort(byTitle) }))
      .sort((a, b) => b.sources.length - a.sources.length || a.title.localeCompare(b.title)),
    orphans: pages.filter((p) => !hasIncoming.has(p.id)).sort(byTitle),
    stubs: pages.filter((p) => pageStatus(p) === 'Stub').sort(byTitle),
  }
}
