import { Index } from 'flexsearch'
import { escapeHtml } from './html'

export type SearchKind = 'page' | 'event' | 'pin' | 'region' | 'scene'

/** Everything a result row renders except the query-dependent snippet. */
export type ResultMeta =
  | { kind: 'page'; id: string; title: string; category: string }
  | { kind: 'event'; id: string; title: string; subtitle: string }
  | { kind: 'pin'; id: string; title: string; subtitle: string }
  | { kind: 'region'; id: string; title: string; subtitle: string }
  | { kind: 'scene'; id: string; title: string; subtitle: string; bookId: string }

export type SearchResult = ResultMeta & { snippet: string }

/**
 * One record's contribution to the index. `signature` is a cheap change signal
 * (a string compare, never an HTML parse); `build()` runs the expensive work
 * (stripHtml, joins) and is called ONLY when the signature differs from the
 * stored one — so an unchanged record costs one string comparison.
 */
export interface IndexEntry {
  id: string
  signature: string
  build(): { text: string; snippetSource: string; meta: ResultMeta }
}

// FlexSearch Index has no .clear(); we swap the reference on a full reset.
let activeIdx: Index | null = null

interface StoreEntry {
  signature: string
  snippetSource: string
  meta: ResultMeta
}
// Keyed by namespaced key `${kind}:${id}` so one index holds every entity type.
const store = new Map<string, StoreEntry>()

// Per-type reservations and the pool/limit for a query. Quotas sum above the
// limit deliberately — they are reservations honoured only when types compete,
// not a budget (see applyCaps).
const QUOTAS: Record<SearchKind, number> = { page: 8, event: 5, scene: 5, pin: 4, region: 4 }
const POOL = 60
const LIMIT = 20

function keyKind(key: string): SearchKind {
  return key.slice(0, key.indexOf(':')) as SearchKind
}

function ensureIndex(): Index {
  if (!activeIdx) activeIdx = new Index({ tokenize: 'forward', resolution: 5 })
  return activeIdx
}

/** Swap in a fresh empty index and clear the store. Used by tests. */
export function resetIndex(): void {
  activeIdx = new Index({ tokenize: 'forward', resolution: 5 })
  store.clear()
}

/**
 * Reconcile one kind's slice against the index, touching only what changed and
 * never crossing into another kind's keys. An unchanged entry (same signature)
 * skips build() — the expensive path. Removed entries (present in the store's
 * slice but absent from `entries`) are dropped. Because the loop is scoped to
 * this kind's prefix, concurrent slices can write the shared index without racing.
 */
export function syncSlice(kind: SearchKind, entries: IndexEntry[]): void {
  const idx = ensureIndex()
  const prefix = `${kind}:`
  const incoming = new Set<string>()
  for (const entry of entries) {
    const key = prefix + entry.id
    incoming.add(key)
    const prev = store.get(key)
    if (prev && prev.signature === entry.signature) continue // unchanged — gated
    const { text, snippetSource, meta } = entry.build()
    if (prev) idx.update(key, text)
    else idx.add(key, text)
    store.set(key, { signature: entry.signature, snippetSource, meta })
  }
  for (const key of store.keys()) {
    if (key.startsWith(prefix) && !incoming.has(key)) {
      idx.remove(key)
      store.delete(key)
    }
  }
}

/**
 * Two-pass merge that preserves the index's relevance order while guaranteeing
 * each competing kind its reserved seats:
 *   1. Reservation — keep a hit if its kind is still under quota and we're under limit.
 *   2. Backfill    — if still under limit, keep anything not yet kept.
 * Both passes only decide keep/skip; the final emit walks in rank order, so the
 * output is always a subsequence of the input (rank never re-sorted). A query
 * matching one kind backfills to `limit` of that kind — identical to the old
 * page-only behaviour.
 */
export function applyCaps(ranked: string[], quotas: Record<SearchKind, number>, limit: number): string[] {
  const used: Record<SearchKind, number> = { page: 0, event: 0, pin: 0, region: 0, scene: 0 }
  const keep = new Set<number>()
  for (let i = 0; i < ranked.length && keep.size < limit; i++) {
    const k = keyKind(ranked[i])
    if (used[k] < quotas[k]) {
      keep.add(i)
      used[k]++
    }
  }
  for (let i = 0; i < ranked.length && keep.size < limit; i++) {
    if (!keep.has(i)) keep.add(i)
  }
  return ranked.filter((_, i) => keep.has(i))
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

// The snippet is plain text but SearchModal injects it via dangerouslySetInnerHTML,
// so every text run must be escaped (via escapeHtml) or stored text like
// "<img onerror=…>" (typed as visible text, or carried by an imported backup)
// would render as live markup.
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

export function searchAll(query: string): SearchResult[] {
  if (!query.trim() || !activeIdx) return []
  // flexsearch types results as Id[] = (string|number)[]; our keys are strings.
  const pool = activeIdx.search(query, POOL) as string[]
  const kept = applyCaps(pool, QUOTAS, LIMIT)
  return kept
    .map((key): SearchResult | null => {
      const entry = store.get(key)
      if (!entry) return null
      return { ...entry.meta, snippet: extractSnippet(entry.snippetSource, query) }
    })
    .filter((r): r is SearchResult => r !== null)
}
