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
