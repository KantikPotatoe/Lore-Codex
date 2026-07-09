import { db, uid, now, DEFAULT_CATEGORY, DEFAULT_STATUS } from './schema'
import { defaultInfobox } from './templates'
import { parseHtml, wikiLinkTitles } from '../html'
import type { LorePage } from './types'

/** The indexed lookup key for a title: trimmed + lowercased. The single source
 *  of truth for how `titleLc` is derived, so every write agrees with the reads. */
export function titleKey(title: string): string {
  return title.trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Page CRUD
// ---------------------------------------------------------------------------

export async function createPage(partial: Partial<LorePage> = {}): Promise<string> {
  const id = uid()
  const category = partial.category || DEFAULT_CATEGORY
  const explicitTitle = partial.title?.trim()
  // Resolve the default infobox (reads db.templates) before opening the write
  // transaction, which then only spans db.pages for the clash-check + add.
  const infobox = partial.infobox ?? (await defaultInfobox(category))
  const title = explicitTitle || 'Untitled'
  const page: LorePage = {
    id,
    title,
    titleLc: titleKey(title),
    category,
    content: partial.content || '',
    summary: partial.summary || '',
    status: partial.status || DEFAULT_STATUS,
    tags: partial.tags || [],
    infobox,
    createdAt: now(),
    updatedAt: now(),
  }
  await db.transaction('rw', db.pages, async () => {
    // Reject an explicit title that clashes with an existing page (case-insensitive),
    // mirroring renamePage — duplicate titles make [[links]] ambiguous. The default
    // 'Untitled' is exempt so creating several blank pages still works. The check is
    // inside the transaction so a concurrent add can't slip a clash past it, and uses
    // the titleLc index (v14) rather than scanning the whole table.
    if (explicitTitle) {
      const clash = await db.pages.where('titleLc').equals(titleKey(explicitTitle)).first()
      if (clash) throw new Error(`A page titled "${clash.title}" already exists.`)
    }
    await db.pages.add(page)
  })
  return id
}

export async function updatePage(id: string, changes: Partial<LorePage>): Promise<void> {
  // Keep the denormalised titleLc in lockstep if a title lands through the generic
  // update path (the dedicated rename flow sets it too).
  const derived =
    typeof changes.title === 'string' ? { titleLc: titleKey(changes.title) } : null
  await db.pages.update(id, { ...changes, ...derived, updatedAt: now() })
}

export async function deletePage(id: string): Promise<void> {
  // One transaction so the delete + gallery cleanup + ref unlinks either all land
  // or all roll back — a mid-sequence failure can't leave orphaned images or refs
  // pointing at a deleted page. Every store that holds a pageId ref is cleaned so
  // no dangling id survives to resolve as "This page doesn't exist".
  await db.transaction('rw', [db.pages, db.images, db.pins, db.docLinks, db.regions, db.events, db.scenes], async () => {
    await db.pages.delete(id)
    // Remove this page's gallery images so no orphans are left behind.
    await db.images.where('pageId').equals(id).delete()
    // Unlink any pins that pointed at this page.
    const linkedPins = await db.pins.where('pageId').equals(id).toArray()
    await Promise.all(linkedPins.map((p) => db.pins.update(p.id, { pageId: null })))
    // Unlink any map regions that pointed at this page.
    const linkedRegions = await db.regions.where('pageId').equals(id).toArray()
    await Promise.all(linkedRegions.map((r) => db.regions.update(r.id, { pageId: null })))
    // Unlink any timeline events that pointed at this page.
    const linkedEvents = await db.events.where('pageId').equals(id).toArray()
    await Promise.all(linkedEvents.map((e) => db.events.update(e.id, { pageId: null })))
    // Drop the id from manuscript scene POV/cast/location refs. Scenes have no
    // per-ref index, so this scans the table — fine at manuscript scale.
    const scenes = await db.scenes.toArray()
    await Promise.all(
      scenes
        .filter((s) => s.povPageId === id || s.castPageIds.includes(id) || s.locationPageIds.includes(id))
        .map((s) =>
          db.scenes.update(s.id, {
            povPageId: s.povPageId === id ? null : s.povPageId,
            castPageIds: s.castPageIds.filter((p) => p !== id),
            locationPageIds: s.locationPageIds.filter((p) => p !== id),
          }),
        ),
    )
    // Drop document-attachment edges on either endpoint (owning page or document).
    await db.docLinks.where('pageId').equals(id).delete()
    await db.docLinks.where('documentId').equals(id).delete()
  })
}

/** Find an existing page's id by title (case-insensitive), or null. No creation —
 *  clicking a link to a missing page is handled (with confirmation) by the caller. */
export async function findPageIdByTitle(title: string): Promise<string | null> {
  // Indexed case-insensitive lookup via titleLc (v14) — no full-table scan.
  const match = await db.pages.where('titleLc').equals(titleKey(title)).first()
  return match?.id ?? null
}

/** Rewrite every reference to `oldTitle` into `newTitle` within a rich-text HTML
 *  body: `<a data-wikilink data-title="Old">` anchors (attribute + text) AND
 *  `<sup data-citation data-target="Old">` citation markers. Titles match
 *  case-insensitively. Returns the rewritten HTML, or null if it referenced
 *  nothing (so untouched bodies aren't re-written). Shared by page content,
 *  manuscript scenes, and timeline-event descriptions — all editor HTML. */
function rewriteBodyLinks(html: string, oldLc: string, newTitle: string): string | null {
  if (!html || (!html.includes('data-wikilink') && !html.includes('data-citation'))) return null
  const doc = parseHtml(html)
  let changed = false
  doc.querySelectorAll('a[data-wikilink]').forEach((a) => {
    if (a.getAttribute('data-title')?.trim().toLowerCase() === oldLc) {
      a.setAttribute('data-title', newTitle)
      a.textContent = newTitle
      changed = true
    }
  })
  doc.querySelectorAll('sup[data-citation]').forEach((s) => {
    if (s.getAttribute('data-target')?.trim().toLowerCase() === oldLc) {
      s.setAttribute('data-target', newTitle)
      changed = true
    }
  })
  return changed ? doc.body.innerHTML : null
}

/** Rewrite every reference to `oldTitle` into `newTitle` within one page's body
 *  and infobox. Matches titles case-insensitively. Returns only the changed fields,
 *  or null if this page referenced nothing (so untouched pages aren't re-written). */
function rewriteLinksInPage(
  page: LorePage,
  oldTitle: string,
  newTitle: string,
): Partial<LorePage> | null {
  const oldLc = oldTitle.trim().toLowerCase()
  const out: Partial<LorePage> = {}
  let changed = false

  // Body: rewrite wiki-link anchors + citation markers.
  const body = rewriteBodyLinks(page.content, oldLc, newTitle)
  if (body !== null) {
    out.content = body
    changed = true
  }

  // Infobox: field values keep raw [[Name]] tokens (covers plain AND ref fields).
  if (page.infobox) {
    let boxChanged = false
    const fields = page.infobox.fields.map((f) => {
      const v = f.value.replace(/\[\[([^\]]+)\]\]/g, (m, inner) =>
        inner.trim().toLowerCase() === oldLc ? `[[${newTitle}]]` : m,
      )
      if (v !== f.value) boxChanged = true
      return v === f.value ? f : { ...f, value: v }
    })
    if (boxChanged) {
      out.infobox = { ...page.infobox, fields }
      changed = true
    }
  }

  return changed ? out : null
}

/** Rename a page and rewrite every reference to it across all other pages, so no
 *  [[links]] break. Throws if another page already holds the new title (which would
 *  make links ambiguous). No-ops on an empty or unchanged title. */
export async function renamePage(id: string, newTitle: string): Promise<void> {
  const trimmed = newTitle.trim()
  if (!trimmed) return

  // Read the page list, run the clash check, and rewrite all references inside a
  // single transaction. Doing the read + clash check outside would let a write
  // that lands in between (autosave, a second tab) go unseen — silently reverted
  // by the rewrite from a stale snapshot, or slip a clashing title past the check.
  // Scenes and events also carry editor HTML with the same wiki-link/citation
  // anchors, so they're rewritten too (their POV/cast/location + pageId refs are
  // id-based and unaffected by a title change).
  await db.transaction('rw', db.pages, db.scenes, db.events, async () => {
    const all = await db.pages.toArray()
    const page = all.find((p) => p.id === id)
    if (!page || trimmed === page.title) return
    const oldTitle = page.title
    const oldLc = oldTitle.trim().toLowerCase()

    const clash = all.find(
      (p) => p.id !== id && p.title.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (clash) throw new Error(`A page titled "${clash.title}" already exists.`)

    await db.pages.update(id, { title: trimmed, titleLc: titleKey(trimmed), updatedAt: now() })
    for (const p of all) {
      if (p.id === id) continue
      const rewritten = rewriteLinksInPage(p, oldTitle, trimmed)
      if (rewritten) await db.pages.update(p.id, { ...rewritten, updatedAt: now() })
    }
    for (const s of await db.scenes.toArray()) {
      const body = rewriteBodyLinks(s.content, oldLc, trimmed)
      if (body !== null) await db.scenes.update(s.id, { content: body, updatedAt: now() })
    }
    for (const e of await db.events.toArray()) {
      const desc = rewriteBodyLinks(e.description, oldLc, trimmed)
      if (desc !== null) await db.events.update(e.id, { description: desc, updatedAt: now() })
    }
  })
}

// ---------------------------------------------------------------------------
// Backlinks — "which other pages link to this one"
// ---------------------------------------------------------------------------

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g

/** Every page title a page links to, in the casing the author typed, gathered
 *  from its rich-text body and its infobox field values. Deduped by lowercased
 *  title — the first occurrence wins the casing. The health dashboard creates
 *  missing pages from these strings, so the original text matters. */
export function linkedTitlesRaw(page: LorePage): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  // Body: editor wiki links render as <a data-wikilink data-title="...">.
  for (const t of wikiLinkTitles(page.content)) add(t)
  // Infobox field values keep the raw [[Name]] syntax.
  if (page.infobox) {
    for (const field of page.infobox.fields) {
      for (const m of field.value.matchAll(WIKILINK_RE)) add(m[1])
    }
  }
  return out
}

/** Every page title (lowercased) that a page links to. */
export function linkedTitles(page: LorePage): Set<string> {
  return new Set(linkedTitlesRaw(page).map((t) => t.toLowerCase()))
}

// linkedTitles(page) is a DOMParser body-parse — the expensive part of a backlink
// scan, which runs it for every page on every page view. Memoize it by
// (id, updatedAt), mirroring the search index's `store`: an unchanged page skips
// the parse entirely. Any content edit bumps updatedAt, so the cache can never
// serve stale links in practice.
interface LinkCacheEntry {
  updatedAt: number
  raw: string[]
  titles: Set<string>
}
const linkedTitlesCache = new Map<string, LinkCacheEntry>()

function linkCacheEntry(page: LorePage): LinkCacheEntry {
  const prev = linkedTitlesCache.get(page.id)
  if (prev && prev.updatedAt === page.updatedAt) return prev
  const raw = linkedTitlesRaw(page)
  const entry: LinkCacheEntry = {
    updatedAt: page.updatedAt,
    raw,
    titles: new Set(raw.map((t) => t.toLowerCase())),
  }
  linkedTitlesCache.set(page.id, entry)
  return entry
}

/** linkedTitles(page), memoized by (id, updatedAt). */
export function linkedTitlesCached(page: LorePage): Set<string> {
  return linkCacheEntry(page).titles
}

/** linkedTitlesRaw(page), memoized by (id, updatedAt). */
export function linkedTitlesRawCached(page: LorePage): string[] {
  return linkCacheEntry(page).raw
}

/** Drop the memoized linked-titles cache (tests; harmless to call otherwise). */
export function clearLinkedTitlesCache(): void {
  linkedTitlesCache.clear()
}

/** All pages that link to the page with the given id. */
export async function getBacklinks(pageId: string): Promise<LorePage[]> {
  const target = await db.pages.get(pageId)
  const targetTitle = target?.title.trim().toLowerCase()
  if (!targetTitle) return []
  const all = await db.pages.toArray()
  // Prune cache entries for pages that no longer exist, so the map stays bounded
  // by the live corpus across a long session of edits/deletes.
  const live = new Set(all.map((p) => p.id))
  for (const id of linkedTitlesCache.keys()) if (!live.has(id)) linkedTitlesCache.delete(id)
  return all
    .filter((p) => p.id !== pageId && linkedTitlesCached(p).has(targetTitle))
    .sort((a, b) => a.title.localeCompare(b.title))
}
