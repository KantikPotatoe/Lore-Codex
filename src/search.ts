import { Index } from 'flexsearch'
import type { LorePage } from './db'
import { escapeHtml, stripHtml } from './html'

export interface SearchResult {
  id: string
  title: string
  category: string
  snippet: string
}

// FlexSearch Index has no .clear(); we swap the reference on a full rebuild.
let activeIdx: Index | null = null

interface StoreEntry {
  title: string
  category: string
  body: string
  summary: string
  updatedAt: number // change signal: lets syncIndex skip re-parsing unchanged pages
}
const store = new Map<string, StoreEntry>()

/** Compose the searchable text for a page (title + summary + tags + stripped body). */
function indexText(page: LorePage, body: string): string {
  return [page.title, page.summary, page.tags.join(' '), body].join(' ')
}

function extractSnippet(text: string, query: string, maxLen = 160): string {
  if (!text) return ''
  const q = query.trim().toLowerCase().split(/\s+/)[0] ?? ''
  const lower = text.toLowerCase()
  const pos = q ? lower.indexOf(q) : -1
  if (pos === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const start = Math.max(0, pos - 60)
  const end = Math.min(text.length, start + maxLen)
  return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
}

// The snippet is plain text (stripHtml decodes entities), but SearchModal injects
// the result via dangerouslySetInnerHTML, so every text run must be escaped (via
// the shared escapeHtml, src/html.ts) or stored text like "<img onerror=…>" (typed
// as visible text, or carried by an imported backup) would render as live markup.

export function highlightSnippet(snippet: string, query: string): string {
  const q = query.trim().split(/\s+/)[0] ?? ''
  if (!q) return escapeHtml(snippet)
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  let out = ''
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(snippet)) !== null) {
    out += escapeHtml(snippet.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>'
    last = m.index + m[0].length
  }
  return out + escapeHtml(snippet.slice(last))
}

/** Full rebuild from scratch: discard the index and re-add every page. Used for the
 *  initial build; thereafter syncIndex() applies just the deltas (see below). */
export function buildIndex(pages: LorePage[]): void {
  activeIdx = new Index({ tokenize: 'forward', resolution: 5 })
  store.clear()
  for (const page of pages) {
    const body = stripHtml(page.content)
    activeIdx.add(page.id, indexText(page, body))
    store.set(page.id, { title: page.title, category: page.category, body, summary: page.summary, updatedAt: page.updatedAt })
  }
}

/**
 * Reconcile the index against the current set of pages, touching only what changed
 * (roadmap #6). The page liveQuery in App.tsx emits the whole table on every edit,
 * but rebuilding from scratch is O(n) per keystroke-save — measured at ~100ms for a
 * 500-page world, since each page costs a DOMParser strip. Instead we diff:
 *   - unchanged page (same `updatedAt`)  → skip entirely (no re-parse, the costly bit)
 *   - new page                           → add
 *   - changed page                       → update (FlexSearch update = remove + add)
 *   - page no longer present             → remove
 * so a single-page edit does one strip + one index.update, not n. The first call
 * (empty index) falls back to a full build.
 */
export function syncIndex(pages: LorePage[]): void {
  if (!activeIdx) {
    buildIndex(pages)
    return
  }
  const incoming = new Set<string>()
  for (const page of pages) {
    incoming.add(page.id)
    const prev = store.get(page.id)
    if (prev && prev.updatedAt === page.updatedAt) continue // unchanged — skip the parse
    const body = stripHtml(page.content)
    const text = indexText(page, body)
    if (prev) activeIdx.update(page.id, text)
    else activeIdx.add(page.id, text)
    store.set(page.id, { title: page.title, category: page.category, body, summary: page.summary, updatedAt: page.updatedAt })
  }
  for (const id of store.keys()) {
    if (!incoming.has(id)) {
      activeIdx.remove(id)
      store.delete(id)
    }
  }
}

export function searchPages(query: string): SearchResult[] {
  if (!query.trim() || !activeIdx) return []
  const ids = activeIdx.search(query, 20) as string[]
  return ids
    .map((id) => {
      const entry = store.get(id)
      if (!entry) return null
      return { id, title: entry.title, category: entry.category, snippet: extractSnippet(entry.body || entry.summary, query) }
    })
    .filter((r): r is SearchResult => r !== null)
}
