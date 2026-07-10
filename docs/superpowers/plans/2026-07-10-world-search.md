# World-Wide Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend FlexSearch beyond wiki pages so `SearchModal` also finds timeline events, map pins, map regions, and manuscript scenes — one flat relevance-ranked list with a type badge per row, each row navigating to the right target.

**Architecture:** One shared FlexSearch `Index` with namespaced ids (`page:<uuid>`, `event:<uuid>`, …). `src/search.ts` owns the index and stays pure (type-only db imports); `src/searchEntries.ts` (new, pure) adapts records into index entries and holds the joins; `src/searchSync.ts` (new, runtime db) owns the `liveQuery` subscriptions. Change detection uses a cheap per-record `signature` string so the expensive `stripHtml` only runs when a record (or a field it joins to) actually changed.

**Tech Stack:** TypeScript (strict), FlexSearch 0.8, Dexie + dexie-react-hooks (`liveQuery`/`useLiveQuery`), React, Vitest + happy-dom + fake-indexeddb.

## Global Constraints

- TS `strict`. Run `npm run lint`, `npm run build`, and `npm run test:run` before claiming done (CI runs all three).
- `src/search.ts` and `src/searchEntries.ts` MUST keep **type-only** db imports (`import type { … } from './db'`). A runtime db import belongs only in `src/searchSync.ts`. (Memory: pure-module placement — a runtime db import drags in the Dexie singleton.)
- Any test that renders a component using `useLiveQuery` MUST include `afterEach(cleanup)` (else "window is not defined" at teardown).
- No `// @vitest-environment jsdom` pragma is needed here — that is only for DOMPurify, which this change does not touch. The suite default (happy-dom) is correct.
- Snippets render via `dangerouslySetInnerHTML` and MUST pass through `highlightSnippet` (which escapes every run). The new `subtitle` field MUST render as a plain React child, never `dangerouslySetInnerHTML`.
- FlexSearch `Index` has no `.clear()`; a full reset swaps in a fresh `Index` (existing pattern, `search.ts:12-13`).
- Namespaced keys split on the **first** `:` — record uuids (Dexie `uid()`) contain no colon.
- Commit after each task. PR label at the end: `version:minor`.

---

### Task 1: Rewrite the index core in `src/search.ts`

Replaces the page-only `buildIndex`/`syncIndex`/`searchPages` with the generic slice API. `search.ts` stays agnostic about record types — tests use synthetic `IndexEntry` objects.

**Files:**
- Modify: `src/search.ts` (full rewrite of the index/query section; `extractSnippet` and `highlightSnippet` keep their current bodies)
- Test: `src/search.test.ts` (rewrite — old `buildIndex`/`syncIndex` tests are replaced)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type SearchKind = 'page' | 'event' | 'pin' | 'region' | 'scene'`
  - `interface ResultMeta` — discriminated union on `kind` (see code)
  - `type SearchResult = ResultMeta & { snippet: string }`
  - `interface IndexEntry { id: string; signature: string; build(): { text: string; snippetSource: string; meta: ResultMeta } }`
  - `function syncSlice(kind: SearchKind, entries: IndexEntry[]): void`
  - `function searchAll(query: string): SearchResult[]`
  - `function applyCaps(ranked: string[], quotas: Record<SearchKind, number>, limit: number): string[]`
  - `function resetIndex(): void` — swaps in a fresh empty index and clears the store (test reset; replaces old `buildIndex([])`)
  - `function highlightSnippet(snippet: string, query: string): string` — **unchanged**

- [ ] **Step 1: Write the failing tests**

Rewrite `src/search.test.ts` entirely:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  syncSlice, searchAll, applyCaps, resetIndex, highlightSnippet,
  type IndexEntry, type SearchKind, type ResultMeta,
} from './search'

// search.ts uses stripHtml (DOMParser), so the suite-default happy-dom env applies.

beforeEach(() => resetIndex())

// A synthetic page entry — search.ts is agnostic about real record shapes.
const pageEntry = (id: string, title: string, body = ''): IndexEntry => ({
  id,
  signature: `${title}\0${body}`,
  build: () => ({
    text: `${title} ${body}`,
    snippetSource: body || title,
    meta: { kind: 'page', id, title, category: 'Character' } as ResultMeta,
  }),
})

const keysFor = (q: string): string[] => searchAll(q).map((r) => `${r.kind}:${r.id}`)

describe('syncSlice + searchAll', () => {
  it('finds an entry by indexed text and returns a composed result', () => {
    syncSlice('page', [pageEntry('a', 'Gandalf', 'a wizard of the realm')])
    const results = searchAll('wizard')
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ kind: 'page', id: 'a', title: 'Gandalf' })
    expect(results[0].snippet).toContain('wizard')
  })

  it('returns [] for an empty query and before any sync', () => {
    expect(searchAll('')).toEqual([])
    resetIndex()
    expect(searchAll('anything')).toEqual([])
  })

  it('adds, updates, and removes within a slice', () => {
    syncSlice('page', [pageEntry('a', 'Strider')])
    expect(keysFor('Strider')).toEqual(['page:a'])
    syncSlice('page', [pageEntry('a', 'Aragorn')])
    expect(keysFor('Aragorn')).toEqual(['page:a'])
    expect(keysFor('Strider')).toEqual([])
    syncSlice('page', []) // 'a' dropped
    expect(keysFor('Aragorn')).toEqual([])
  })

  it('isolates slices: clearing events leaves pages searchable', () => {
    syncSlice('page', [pageEntry('p', 'Rivendell')])
    syncSlice('event', [{
      id: 'e', signature: 'v1',
      build: () => ({ text: 'Council of Elrond', snippetSource: '', meta: { kind: 'event', id: 'e', title: 'Council', subtitle: '' } }),
    }])
    expect(keysFor('Council')).toEqual(['event:e'])
    syncSlice('event', []) // clear only the event slice
    expect(keysFor('Council')).toEqual([])
    expect(keysFor('Rivendell')).toEqual(['page:p']) // page slice untouched
  })

  it('skips build() when the signature is unchanged, reruns it when it changes', () => {
    const build = vi.fn(() => ({
      text: 'Legolas', snippetSource: '', meta: { kind: 'page', id: 'a', title: 'Legolas', category: 'Character' } as ResultMeta,
    }))
    const entry = (sig: string): IndexEntry => ({ id: 'a', signature: sig, build })

    syncSlice('page', [entry('sig-1')])
    expect(build).toHaveBeenCalledTimes(1)
    syncSlice('page', [entry('sig-1')]) // unchanged → gated
    expect(build).toHaveBeenCalledTimes(1)
    syncSlice('page', [entry('sig-2')]) // changed → rebuilds
    expect(build).toHaveBeenCalledTimes(2)
  })
})

const QUOTAS: Record<SearchKind, number> = { page: 8, event: 5, scene: 5, pin: 4, region: 4 }

describe('applyCaps', () => {
  it('returns all hits, in rank order, when only one kind matches (no regression vs page-only search)', () => {
    const ranked = Array.from({ length: 30 }, (_, i) => `page:p${i}`)
    const kept = applyCaps(ranked, QUOTAS, 20)
    expect(kept).toEqual(ranked.slice(0, 20)) // 20 pages, original order
  })

  it('guarantees each competing kind its reserved seats, total = limit, order preserved', () => {
    // 10 pages, then 10 events, then 10 scenes, all lower-ranked than the pages.
    const ranked = [
      ...Array.from({ length: 10 }, (_, i) => `page:p${i}`),
      ...Array.from({ length: 10 }, (_, i) => `event:e${i}`),
      ...Array.from({ length: 10 }, (_, i) => `scene:s${i}`),
    ]
    const kept = applyCaps(ranked, QUOTAS, 20)
    expect(kept).toHaveLength(20)
    const kind = (k: string) => k.split(':')[0]
    expect(kept.filter((k) => kind(k) === 'event').length).toBeGreaterThanOrEqual(5)
    expect(kept.filter((k) => kind(k) === 'scene').length).toBeGreaterThanOrEqual(5)
    // output is a subsequence of the input (relative order preserved)
    let last = -1
    for (const k of kept) {
      const idx = ranked.indexOf(k)
      expect(idx).toBeGreaterThan(last)
      last = idx
    }
  })

  it('returns everything when there are fewer hits than the limit, with no padding', () => {
    const ranked = ['page:a', 'event:b', 'pin:c']
    expect(applyCaps(ranked, QUOTAS, 20)).toEqual(ranked)
  })
})

describe('highlightSnippet', () => {
  it('wraps every occurrence of the first query word in <mark>', () => {
    expect(highlightSnippet('the grey wizard', 'wizard')).toBe('the grey <mark>wizard</mark>')
    expect(highlightSnippet('Wizard vs wizard', 'wizard')).toBe('<mark>Wizard</mark> vs <mark>wizard</mark>')
  })

  it('escapes HTML in the snippet so stored text cannot become live markup', () => {
    expect(highlightSnippet('<img src=x onerror=alert(1)>', 'img')).toBe(
      '&lt;<mark>img</mark> src=x onerror=alert(1)&gt;',
    )
  })

  it('escapes the snippet even when the query does not match', () => {
    expect(highlightSnippet('<script>alert(1)</script>', 'zzz')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    )
  })

  it('escapes the snippet when the query is empty', () => {
    expect(highlightSnippet('a < b & c', '')).toBe('a &lt; b &amp; c')
  })

  it('treats regex metacharacters in the query as literals', () => {
    expect(highlightSnippet('cost (a+b)', '(a+b)')).toBe('cost <mark>(a+b)</mark>')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/search.test.ts`
Expected: FAIL — `syncSlice`, `searchAll`, `applyCaps`, `resetIndex` are not exported.

- [ ] **Step 3: Rewrite `src/search.ts`**

Replace the entire file with:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/search.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add src/search.ts src/search.test.ts
git commit -m "feat: generic multi-slice search index core (#176)"
```

---

### Task 2: Record adapters in `src/searchEntries.ts`

The pure boundary that turns Dexie records into `IndexEntry[]`. Home of the joins, `calendarSignature`, `stripHtml`, and `resultHref`. No index, no db runtime import, no React.

**Files:**
- Create: `src/searchEntries.ts`
- Test: `src/searchEntries.test.ts` (new; pure — no db, no index)
- Modify: `src/db/import-sanitize.test.ts` (migrate a stale `buildIndex` call — Task 1 removed that export; this is the one consumer outside SearchModal, which Task 5 handles)

**Interfaces:**
- Consumes (Task 1): `IndexEntry`, `ResultMeta`, `syncSlice`, `resetIndex` from `./search`.
- Produces:
  - `function calendarSignature(cal: Calendar): string`
  - `function pageEntries(pages: LorePage[]): IndexEntry[]`
  - `function eventEntries(events: TimelineEvent[], calendars: Calendar[]): IndexEntry[]`
  - `function pinEntries(pins: MapPin[], pageTitles: Map<string, string>, mapNames: Map<string, string>): IndexEntry[]`
  - `function regionEntries(regions: MapRegion[], pageTitles: Map<string, string>, mapNames: Map<string, string>): IndexEntry[]`
  - `function sceneEntries(scenes: Scene[], chapters: Chapter[]): IndexEntry[]`
  - `function resultHref(r: ResultMeta): string`

- [ ] **Step 1: Write the failing tests**

Create `src/searchEntries.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  calendarSignature, pageEntries, eventEntries, pinEntries, regionEntries, sceneEntries, resultHref,
} from './searchEntries'
import type { Calendar, TimelineEvent, MapPin, MapRegion, Scene, Chapter, LorePage } from './db'

// searchEntries uses stripHtml (DOMParser) inside build(); happy-dom default env applies.

const cal = (over: Partial<Calendar> = {}): Calendar => ({
  id: 'c1', name: 'Reckoning', anchor: 0,
  months: [{ name: 'Seedfall', days: 30 }, { name: 'Highsun', days: 30 }],
  weekdays: [], eras: [{ id: 'e', name: 'Imperial Era', startYear: 0 }],
  createdAt: 1, ...over,
})

const event = (over: Partial<TimelineEvent> & { id: string }): TimelineEvent => ({
  calendarId: 'c1', title: '', description: '', category: '', pageId: null,
  startYear: 412, startMonth: 0, startDay: 9, startAbsolute: 0, createdAt: 1, updatedAt: 1, ...over,
})

describe('calendarSignature', () => {
  it('changes when a month is renamed, so an event re-indexes though its own record is untouched', () => {
    const a = calendarSignature(cal())
    const b = calendarSignature(cal({ months: [{ name: 'Ashfall', days: 30 }, { name: 'Highsun', days: 30 }] }))
    expect(a).not.toBe(b)
  })
  it('changes when an era is renamed', () => {
    const a = calendarSignature(cal())
    const b = calendarSignature(cal({ eras: [{ id: 'e', name: 'Dark Era', startYear: 0 }] }))
    expect(a).not.toBe(b)
  })
})

describe('eventEntries', () => {
  it('indexes title, stripped description, category, and formatted date from the right calendar', () => {
    const [entry] = eventEntries([event({ id: 'e', title: 'Ashfall begins', description: '<p>the <b>sky</b> darkened</p>', category: 'Battle' })], [cal()])
    const built = entry.build()
    expect(built.text).toContain('Ashfall begins')
    expect(built.text).toContain('sky') // HTML stripped
    expect(built.text).toContain('Battle')
    expect(built.text).toContain('Seedfall') // month name from the calendar
    expect(built.meta).toMatchObject({ kind: 'event', id: 'e', title: 'Ashfall begins' })
    expect(built.meta.kind === 'event' && built.meta.subtitle).toContain('Year 412')
  })
  it('folds the calendar signature into the event signature', () => {
    const [a] = eventEntries([event({ id: 'e' })], [cal()])
    const [b] = eventEntries([event({ id: 'e' })], [cal({ months: [{ name: 'Ashfall', days: 30 }, { name: 'Highsun', days: 30 }] })])
    expect(a.signature).not.toBe(b.signature)
  })
  it('indexes an event whose calendar is missing (no date text, empty subtitle)', () => {
    const [entry] = eventEntries([event({ id: 'e', title: 'Orphan', calendarId: 'gone' })], [])
    const built = entry.build()
    expect(built.text).toContain('Orphan')
    expect(built.meta.kind === 'event' && built.meta.subtitle).toBe('')
  })
})

describe('pinEntries / regionEntries', () => {
  const pin = (over: Partial<MapPin> & { id: string }): MapPin => ({ mapId: 'm1', lat: 0, lng: 0, label: '', pageId: null, ...over })
  const pageTitles = new Map([['p1', 'Ashfall Crater']])
  const mapNames = new Map([['m1', 'Northern Reach']])

  it('indexes label + linked page title; map name goes to subtitle, not text', () => {
    const [entry] = pinEntries([pin({ id: 'x', label: 'crater', pageId: 'p1' })], pageTitles, mapNames)
    const built = entry.build()
    expect(built.text).toContain('crater')
    expect(built.text).toContain('Ashfall Crater') // linked page title indexed
    expect(built.text).not.toContain('Northern Reach') // map name is display-only
    expect(built.meta.kind === 'pin' && built.meta.subtitle).toBe('Northern Reach')
  })
  it('indexes a pin whose linked page was deleted (findable by label)', () => {
    const [entry] = pinEntries([pin({ id: 'x', label: 'crater', pageId: 'gone' })], pageTitles, mapNames)
    expect(entry.build().text).toContain('crater')
  })
  it('regionEntries mirrors pinEntries and emits kind region', () => {
    const region: MapRegion = { id: 'r', mapId: 'm1', points: [[0, 0]], label: 'reach', pageId: 'p1' }
    const [entry] = regionEntries([region], pageTitles, mapNames)
    expect(entry.build().meta.kind).toBe('region')
  })
})

describe('sceneEntries', () => {
  const scene = (over: Partial<Scene> & { id: string }): Scene => ({
    bookId: 'b1', chapterId: 'ch1', title: '', content: '', synopsis: '', notes: '',
    status: 'draft', order: 0, wordCount: 0, povPageId: null, castPageIds: [], locationPageIds: [],
    createdAt: 1, updatedAt: 1, ...over,
  })
  const chapters: Chapter[] = [{ id: 'ch1', bookId: 'b1', title: 'The Ash Falls', order: 2, createdAt: 1, updatedAt: 1 }]

  it('indexes title + synopsis + notes + stripped content and carries bookId + chapter subtitle', () => {
    const [entry] = sceneEntries([scene({ id: 's', title: 'Descent', synopsis: 'she flees', notes: 'foreshadow', content: '<p>the <i>ashfall</i> settled</p>' })], chapters)
    const built = entry.build()
    expect(built.text).toContain('Descent')
    expect(built.text).toContain('she flees')
    expect(built.text).toContain('foreshadow')
    expect(built.text).toContain('ashfall') // HTML stripped
    expect(built.meta).toMatchObject({ kind: 'scene', id: 's', bookId: 'b1' })
    expect(built.meta.kind === 'scene' && built.meta.subtitle).toBe('The Ash Falls')
  })
  it('indexes a scene whose chapter is missing (empty subtitle)', () => {
    const [entry] = sceneEntries([scene({ id: 's', title: 'Lost', chapterId: 'gone' })], chapters)
    const built = entry.build()
    expect(built.text).toContain('Lost')
    expect(built.meta.kind === 'scene' && built.meta.subtitle).toBe('')
  })
})

describe('resultHref', () => {
  it('routes each kind to its target', () => {
    expect(resultHref({ kind: 'page', id: 'a', title: '', category: '' })).toBe('/page/a')
    expect(resultHref({ kind: 'event', id: 'e', title: '', subtitle: '' })).toBe('/timeline?event=e')
    expect(resultHref({ kind: 'pin', id: 'p', title: '', subtitle: '' })).toBe('/map?pin=p')
    expect(resultHref({ kind: 'region', id: 'r', title: '', subtitle: '' })).toBe('/map?region=r')
    expect(resultHref({ kind: 'scene', id: 's', title: '', subtitle: '', bookId: 'b' })).toBe('/book/b?scene=s')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/searchEntries.test.ts`
Expected: FAIL — `src/searchEntries.ts` does not exist.

- [ ] **Step 3: Create `src/searchEntries.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/searchEntries.test.ts`
Expected: PASS.

- [ ] **Step 5: Migrate the stale `buildIndex` consumer in `import-sanitize.test.ts`**

Task 1 removed `buildIndex`, but `src/db/import-sanitize.test.ts` still imports it (line 9) and calls it at line 124 to assert that indexing a malformed imported page does not throw. Migrate it to the new API — `pageEntries` (this task) now exists, and running it through `syncSlice` exercises the same `build()`/`stripHtml` path the old call did.

Change the import at `src/db/import-sanitize.test.ts:9` from:

```ts
import { buildIndex } from '../search'
```
to:
```ts
import { syncSlice, resetIndex } from '../search'
import { pageEntries } from '../searchEntries'
```

Change the assertion at `src/db/import-sanitize.test.ts:124` from:

```ts
    expect(() => buildIndex(pages)).not.toThrow()
```
to:
```ts
    expect(() => { resetIndex(); syncSlice('page', pageEntries(pages)) }).not.toThrow()
```

Run: `npm run test:run -- src/db/import-sanitize.test.ts`
Expected: PASS (the malformed-row test still asserts indexing does not throw, now via the real page adapter).

- [ ] **Step 6: Lint, verify slices, then commit**

Run: `npm run lint`
Expected: clean.

Run: `npm run test:run -- src/searchEntries.test.ts src/db/import-sanitize.test.ts`
Expected: both PASS.

> Note: a full `npm run build` / whole-suite run still fails at this point — `App.tsx` and `SearchModal.tsx(.test)` reference the removed `syncIndex`/`searchPages`, which Tasks 3 and 5 migrate. That is expected mid-plan; do not try to fix those here. `searchEntries.ts` staying type-only for its `./db` import is confirmed by lint + the fact it type-checks against the `import type` line.

```bash
git add src/searchEntries.ts src/searchEntries.test.ts src/db/import-sanitize.test.ts
git commit -m "feat: record→index adapters with join-aware signatures (#176)"
```

---

### Task 3: Subscription wiring in `src/searchSync.ts` + `App.tsx`

The one module that touches Dexie at runtime. Four `liveQuery` subscriptions feed the adapters into `syncSlice`. `App.tsx`'s existing page-only effect is replaced by one `installSearchIndex()` call.

**Files:**
- Create: `src/searchSync.ts`
- Modify: `src/App.tsx` (`src/App.tsx:29` import; `src/App.tsx:70-78` effect)
- Test: `src/searchSync.test.ts` (new; integration via fake-indexeddb)

**Interfaces:**
- Consumes (Tasks 1-2): `syncSlice` from `./search`; `pageEntries`/`eventEntries`/`pinEntries`/`regionEntries`/`sceneEntries` from `./searchEntries`.
- Produces: `function installSearchIndex(): () => void` — subscribes and returns an unsubscribe-all.

- [ ] **Step 1: Write the failing test**

Create `src/searchSync.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { db, pageRepo } from './db'
import { installSearchIndex } from './searchSync'
import { searchAll, resetIndex } from './search'

// fake-indexeddb + happy-dom (suite defaults). liveQuery emits async, so we poll.

async function waitFor(predicate: () => boolean, ms = 1000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for index')
    await new Promise((r) => setTimeout(r, 10))
  }
}

let teardown: (() => void) | null = null

beforeEach(async () => {
  resetIndex()
  await db.pages.clear()
  await db.events.clear()
  await db.calendars.clear()
  await db.pins.clear()
  await db.regions.clear()
  await db.scenes.clear()
  await db.chapters.clear()
})

afterEach(() => { teardown?.(); teardown = null })

describe('installSearchIndex', () => {
  it('indexes pages as they change and stops on teardown', async () => {
    teardown = installSearchIndex()
    const id = await pageRepo.create({ title: 'Rivendell' })
    await waitFor(() => searchAll('Rivendell').length === 1)
    expect(searchAll('Rivendell')[0].id).toBe(id)
  })

  it('indexes events, pins, and scenes across their tables', async () => {
    teardown = installSearchIndex()
    const calId = await db.calendars.add({
      id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1,
    } as never)
    await db.events.add({
      id: 'e1', calendarId: calId, title: 'Council of Elrond', description: '', category: '', pageId: null,
      startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1,
    } as never)
    const mapId = await db.maps.add({ id: 'm1', name: 'Eriador', image: '', width: 1, height: 1, createdAt: 1 } as never)
    await db.pins.add({ id: 'pin1', mapId, lat: 0, lng: 0, label: 'Weathertop', pageId: null } as never)

    await waitFor(() => searchAll('Elrond').length === 1 && searchAll('Weathertop').length === 1)
    expect(searchAll('Elrond')[0].kind).toBe('event')
    expect(searchAll('Weathertop')[0].kind).toBe('pin')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/searchSync.test.ts`
Expected: FAIL — `src/searchSync.ts` does not exist.

- [ ] **Step 3: Create `src/searchSync.ts`**

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/searchSync.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `App.tsx`**

Three import edits in `App.tsx` (verified: `liveQuery` and `pageRepo` are used *only* in the effect being replaced, so both become unused):

1. Remove `import { liveQuery } from 'dexie'` (line 3).
2. Change line 27 from
   `import { seedTemplates, seedDefaultCalendar, migrateInlineBodyImages, pageRepo, activeLoreId } from './db'`
   to drop `pageRepo`:
   `import { seedTemplates, seedDefaultCalendar, migrateInlineBodyImages, activeLoreId } from './db'`
3. Change line 29 from `import { syncIndex } from './search'` to
   `import { installSearchIndex } from './searchSync'`

Replace the effect at `src/App.tsx:70-78`:

```tsx
  // Keep the search index in sync as any searchable table changes. installSearchIndex
  // owns one liveQuery per table and re-indexes only deltas (see searchSync.ts).
  useEffect(() => {
    const teardown = installSearchIndex()
    return teardown
  }, [])
```

- [ ] **Step 6: Verify the app builds and the whole suite is green**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass. (`App.tsx` no longer references `syncIndex`.)

- [ ] **Step 7: Commit**

```bash
git add src/searchSync.ts src/searchSync.test.ts src/App.tsx
git commit -m "feat: subscribe search index to events, pins, regions, scenes (#176)"
```

---

### Task 4: `?region=` deep link + `mapRepo.getRegion`

Adds the one missing navigation target so region results land somewhere, mirroring the existing `?pin=` effect. Includes the small repo-seam addition its effect needs.

**Files:**
- Modify: `src/db/repositories.ts` (interface `MapRepository` ~line 97; impl `mapRepo` ~line 123)
- Modify: `src/routes/MapRoute.tsx` (add `focusRegionId` param + effect next to the existing `?pin=` effect at `src/routes/MapRoute.tsx:35-49`)
- Test: `src/routes/MapRoute.test.tsx` (new)

**Interfaces:**
- Consumes: existing `focusRegion(id)` and `FocusTarget { kind: 'region' }` in MapRoute/MapView.
- Produces: `mapRepo.getRegion(id: string): Promise<MapRegion | undefined>`.

- [ ] **Step 1: Write the failing test**

Create `src/routes/MapRoute.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MapRoute from './MapRoute'
import { db, mapRepo } from '../db'

afterEach(cleanup)

beforeEach(async () => {
  await db.maps.clear()
  await db.regions.clear()
  await db.pins.clear()
})

async function seedMapWithRegion() {
  const mapId = await db.maps.add({ id: 'm1', name: 'Eriador', image: '', width: 100, height: 100, createdAt: 1 } as never)
  const regionId = await db.regions.add({ id: 'r1', mapId, points: [[0, 0], [0, 10], [10, 10]], label: 'The Shire', pageId: null } as never)
  return { mapId, regionId }
}

describe('MapRoute ?region= deep link', () => {
  it('exposes getRegion on the repo seam', async () => {
    const { regionId } = await seedMapWithRegion()
    const region = await mapRepo.getRegion(regionId)
    expect(region?.label).toBe('The Shire')
    expect(await mapRepo.getRegion('nope')).toBeUndefined()
  })

  it('selects the region named in ?region= (shows its label in the panel)', async () => {
    const { regionId } = await seedMapWithRegion()
    render(
      <MemoryRouter initialEntries={[`/map?region=${regionId}`]}>
        <MapRoute />
      </MemoryRouter>,
    )
    expect(await screen.findByText('The Shire')).toBeTruthy()
  })

  it('is a silent no-op for a stale region id', async () => {
    await seedMapWithRegion()
    render(
      <MemoryRouter initialEntries={['/map?region=deleted']}>
        <MapRoute />
      </MemoryRouter>,
    )
    // The map still renders; no throw. Give the effect a tick to resolve undefined.
    await waitFor(() => expect(screen.queryByText('The Shire')).toBeNull())
  })
})
```

> Note for the implementer: if `MapView` (Leaflet) fails to render under happy-dom in this suite, assert the seam and selection at the state level instead — but try the render path first; other route tests in this repo render successfully.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/routes/MapRoute.test.tsx`
Expected: FAIL — `mapRepo.getRegion` is not a function.

- [ ] **Step 3: Add `getRegion` to the repo seam**

In `src/db/repositories.ts`, add to the `MapRepository` interface next to `listRegions` (~line 109):

```ts
  getRegion(id: string): Promise<MapRegion | undefined>
```

And to the `mapRepo` implementation next to `listRegions` (~line 139):

```ts
  getRegion: (id) => db.regions.get(id),
```

- [ ] **Step 4: Add the `?region=` effect in MapRoute**

In `src/routes/MapRoute.tsx`, alongside `const focusPinId = searchParams.get('pin')`:

```tsx
  const focusRegionId = searchParams.get('region')
```

And after the existing `?pin=` effect (`src/routes/MapRoute.tsx:39-49`), add the mirror:

```tsx
  // A deep link (#/map?region=<id>) switches to that region's map and selects it.
  // MapView fits its bounds. A stale/deleted id is a harmless no-op.
  useEffect(() => {
    if (!focusRegionId) return
    let cancelled = false
    mapRepo.getRegion(focusRegionId).then((region) => {
      if (cancelled || !region) return
      setActiveId(region.mapId)
      focusRegion(region.id)
      setPanelMode('preview')
    })
    return () => { cancelled = true }
  }, [focusRegionId])
```

> `focusRegion` is defined later in the component (`function focusRegion(id)` at ~line 198). Function declarations hoist, so referencing it in the effect is fine. If lint flags `react-hooks/exhaustive-deps`, add `focusRegion` to the dependency array (it's a stable in-component function; the existing `?pin=` effect omits its setters by the same local convention — match whichever the file already does).

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/routes/MapRoute.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories.ts src/routes/MapRoute.tsx src/routes/MapRoute.test.tsx
git commit -m "feat: /map?region= deep link + mapRepo.getRegion (#176)"
```

---

### Task 5: `SearchModal` — badges, subtitles, per-kind navigation

Renders the multi-kind results and routes each to `resultHref`. The flat `rows` array and keyboard nav survive; only the row-rendering and `activate`/`go` gain kind-awareness.

**Files:**
- Modify: `src/components/SearchModal.tsx`
- Modify: `src/index.css` (add `.search-result-badge`, `.search-result-subtitle` near `src/index.css:1451`)
- Test: `src/components/SearchModal.test.tsx` (extend; migrate the `buildIndex` reset)

**Interfaces:**
- Consumes: `searchAll`, `resetIndex`, `type SearchResult` from `../search`; `pageEntries`, `resultHref` from `../searchEntries`; `syncSlice` from `../search`.

- [ ] **Step 1: Write the failing tests**

Rewrite the top of `src/components/SearchModal.test.tsx` to use the new reset/seed API, and add per-kind cases. Replace the imports and `beforeEach`, and the `hides the create row` seeding:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchModal from './SearchModal'
import { db, pageRepo } from '../db'
import { resetIndex, syncSlice } from '../search'
import { pageEntries, eventEntries } from '../searchEntries'
import { recordRecent } from '../recents'

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  localStorage.clear()
  resetIndex() // reset the module-level FlexSearch index between tests
})
```

Update the `hides the create row` test's seed line from `buildIndex([...])` to:

```ts
    syncSlice('page', pageEntries([(await pageRepo.get(page))!]))
```

Add these new tests inside the `describe('SearchModal', …)` block:

```ts
  it('renders a type badge and navigates to the timeline for an event hit', async () => {
    syncSlice('event', eventEntries(
      [{ id: 'e1', calendarId: 'c1', title: 'Ashfall begins', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Ashfall' } })
    const row = await screen.findByText('Ashfall begins')
    expect(screen.getByText('Event')).toBeTruthy() // badge
    const link = row.closest('a')
    expect(link?.getAttribute('href')).toContain('/timeline?event=e1')
  })

  it('does not fire the page hover for a non-page row', async () => {
    // A page row wires onMouseEnter → showPageHover; an event row must not.
    syncSlice('event', eventEntries(
      [{ id: 'e2', calendarId: 'c1', title: 'Founding', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Founding' } })
    const row = await screen.findByText('Founding')
    fireEvent.mouseEnter(row.closest('.search-result')!)
    // No page-hover popover appears (it only mounts for page rows).
    expect(document.querySelector('.wiki-hover-popover')).toBeNull()
  })

  it('still offers the create row when non-page hits are present but no page title matches', async () => {
    syncSlice('event', eventEntries(
      [{ id: 'e3', calendarId: 'c1', title: 'Moria falls', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Moria' } })
    expect(await screen.findByText(/Create page/)).toBeTruthy()
  })
```

> The placeholder text becomes "Search your world…" in Step 3; the tests use `/Search/` to stay robust to that copy change.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/components/SearchModal.test.tsx`
Expected: FAIL — `resetIndex`/`syncSlice` seeding compiles, but rows render no badge/link yet (and old `buildIndex` import is gone).

- [ ] **Step 3: Update `SearchModal.tsx`**

Change the imports:

```ts
import { searchAll, highlightSnippet, type SearchResult } from '../search'
import { resultHref } from '../searchEntries'
import { db, pageRepo, categoryColor, type LorePage } from '../db'
```

Change the results memo (`searchPages` → `searchAll`):

```ts
  const results = useMemo(() => searchAll(query), [query])
```

Replace the `Row` type:

```ts
type Row = SearchResult | { kind: 'create'; title: string }
```

Add a badge-label helper near the top of the module (after `NO_PAGES`):

```ts
const BADGE: Record<SearchResult['kind'], string> = {
  page: 'Page', event: 'Event', pin: 'Pin', region: 'Region', scene: 'Scene',
}
```

Update the empty-query recents mapping in `rows` — recents are pages, so give them the page shape:

```ts
    if (!q) {
      return recent.map((p): Row => ({
        kind: 'page', id: p.id, title: p.title, category: p.category, snippet: '',
      }))
    }
    const pageRows: Row[] = results
    if (!titleExists) pageRows.push({ kind: 'create', title: q })
    return pageRows
```

Replace `go`/`activate` to route by kind. `go` becomes href-based:

```ts
  function go(row: SearchResult) {
    navigate(resultHref(row))
    onClose()
  }

  async function activate(row: Row) {
    if (row.kind === 'create') {
      if (creating.current) return
      creating.current = true
      try {
        const id = await pageRepo.create({ title: row.title })
        navigate(`/page/${id}`)
        onClose()
      } catch {
        const existing = await pageRepo.findIdByTitle(row.title)
        if (existing) { navigate(`/page/${existing}`); onClose() }
      } finally {
        creating.current = false
      }
      return
    }
    go(row)
  }
```

Update `handleKey`'s Enter arm — it already calls `activate(rows[selected])`, which now handles every kind, so no change needed there.

Replace the row rendering. A page row keeps the category dot + hover; every other kind shows a badge + subtitle and no page hover. Render each result inside an `<a href={resultHref(row)}>` so the test can read the target and users get real links (call `e.preventDefault()` and route via `go` to keep SPA navigation):

```tsx
            {rows.map((row, i) => {
              if (row.kind === 'create') {
                return (
                  <div
                    key="__create__"
                    className={`search-result search-create${i === selected ? ' is-selected' : ''}`}
                    onClick={() => void activate(row)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    ＋ Create page "{row.title}"
                  </div>
                )
              }
              const isPage = row.kind === 'page'
              return (
                <a
                  key={`${row.kind}:${row.id}`}
                  href={resultHref(row)}
                  className={`search-result${i === selected ? ' is-selected' : ''}`}
                  onClick={(e) => { e.preventDefault(); go(row) }}
                  onMouseEnter={(e) => {
                    setSelected(i)
                    if (isPage) showPageHover(row.id, row.title, e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseLeave={isPage ? scheduleWikiHoverClose : undefined}
                >
                  <div className="search-result-title">
                    {isPage ? (
                      <span className="search-result-dot" style={{ background: categoryColor(row.category) }} />
                    ) : (
                      <span className="search-result-badge">{BADGE[row.kind]}</span>
                    )}
                    {row.title}
                    {!isPage && row.subtitle && (
                      <span className="search-result-subtitle">{row.subtitle}</span>
                    )}
                  </div>
                  {row.snippet && (
                    <div
                      className="search-result-snippet"
                      dangerouslySetInnerHTML={{ __html: highlightSnippet(row.snippet, query) }}
                    />
                  )}
                </a>
              )
            })}
```

Update the input placeholder to reflect the wider scope:

```tsx
          placeholder="Search your world…"
```

> `subtitle` renders as a plain React child (`{row.subtitle}`) — React escapes it. Do NOT route it through `dangerouslySetInnerHTML`. Only `snippet` uses the escaping `highlightSnippet`.

- [ ] **Step 4: Add badge/subtitle CSS**

In `src/index.css`, after `.search-result-dot` (line 1451):

```css
.search-result-badge {
  font-family: var(--display); font-size: 9px; letter-spacing: 0.5px;
  text-transform: uppercase; color: var(--ink-faint);
  border: 1px solid var(--border); border-radius: 4px;
  padding: 1px 5px; flex-shrink: 0;
}
.search-result-subtitle { font-size: 0.75rem; color: var(--ink-faint); font-weight: 400; }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test:run -- src/components/SearchModal.test.tsx`
Expected: PASS (existing page tests + new per-kind tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/SearchModal.tsx src/index.css src/components/SearchModal.test.tsx
git commit -m "feat: multi-kind results with badges in SearchModal (#176)"
```

---

### Task 6: Full verification + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the full CI triplet**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass, zero failures.

- [ ] **Step 2: Manual smoke via the verify skill**

Invoke the `verify` skill (or `npm run dev` on port 5174). In a world that has at least one event, one pin, one region, and one scene: open the search modal (focus the sidebar search box), type a term that appears in each, and confirm:
- each kind shows with its badge,
- clicking an event goes to `/timeline?event=…` and flashes the row,
- clicking a pin goes to `/map?pin=…`, a region to `/map?region=…` (fits its bounds),
- clicking a scene opens `/book/<id>?scene=…`,
- a page-only query still returns up to 20 pages (no regression).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/176-world-search
gh pr create --title "feat: search the whole world — events, pins, regions, scenes (#176)" \
  --label version:minor \
  --body "$(cat <<'EOF'
Closes #176.

Extends FlexSearch beyond wiki pages to timeline events, map pins, map
regions, and manuscript scenes. Results present as one flat relevance-ranked
list with a type badge per row; each navigates to its target (?event=, ?pin=,
?region=, ?scene=).

## Design
docs/superpowers/specs/2026-07-10-world-search-design.md

## Notes
- One shared index, namespaced ids — the only topology that yields a single
  globally-comparable ranking for a flat list.
- Change detection uses a cheap per-record signature + lazy build(), so the
  expensive stripHtml only runs when a record (or a joined field — a renamed
  calendar month, a renamed linked page) actually changed. No schema bump.
- Per-type reservations (two-pass merge) keep manuscript prose from crowding
  out pages, while a page-only query still returns 20 pages unchanged.
- Adds mapRepo.getRegion + a /map?region= deep link (the one target that
  didn't exist).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm CI is green on the PR**

Run: `gh pr checks --watch`
Expected: lint + build + test all pass.

---

## Self-Review

**Spec coverage:**
- Events/pins/regions/scenes indexed → Tasks 2 (adapters) + 3 (subscriptions). ✓
- One shared index, namespaced ids → Task 1. ✓
- Signature + lazy build → Task 1 (`IndexEntry`, gating test) + Task 2 (signatures incl. `calendarSignature`). ✓
- Per-type caps, two-pass, rank preserved, no page-only regression → Task 1 `applyCaps` + tests. ✓
- Discriminated-union `SearchResult`, `resultHref` per kind → Tasks 1 + 2. ✓
- `?region=` + `mapRepo.getRegion` → Task 4. ✓
- Badges + subtitle-as-React-child + page-only hover → Task 5. ✓
- Security: snippet via `highlightSnippet`, subtitle escaped → Task 1 (tests) + Task 5 (rendering note). ✓
- Broken-join fallbacks (orphan event, dangling pageId, missing chapter) → Task 2 tests. ✓
- Slice isolation → Task 1 test. ✓
- Tests: `search.test.ts`, `searchEntries.test.ts`, `SearchModal.test.tsx`, new `MapRoute.test.tsx` → Tasks 1,2,4,5. Plus `searchSync.test.ts` integration (Task 3). ✓
- `buildIndex`/`syncIndex`/`searchPages` removed and consumers migrated → Tasks 1,3,5. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `SearchKind`, `ResultMeta`, `IndexEntry`, `SearchResult`, `syncSlice`, `searchAll`, `applyCaps`, `resetIndex` are defined in Task 1 and consumed with matching signatures in Tasks 2/3/5. Adapter names (`pageEntries`/`eventEntries`/`pinEntries`/`regionEntries`/`sceneEntries`/`calendarSignature`/`resultHref`) are consistent between Task 2 (produce) and Tasks 3/5 (consume). `mapRepo.getRegion` defined and consumed in Task 4. ✓

**One risk flagged for execution:** Task 4 and Task 5 both render Leaflet/route components under happy-dom. If `MapView` won't mount in the test env, the plan's Task 4 note says to fall back to state-level assertions; the SearchModal tests don't render MapView so they're unaffected.
