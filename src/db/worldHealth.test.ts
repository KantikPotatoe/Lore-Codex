import { describe, it, expect, beforeEach } from 'vitest'
import { computeWorldHealth } from './worldHealth'
import { clearLinkedTitlesCache } from './pages'
import type { LorePage } from './types'

function page(over: Partial<LorePage>): LorePage {
  return {
    id: 'p', title: 'P', titleLc: 'p', category: 'Concept', content: '',
    summary: '', status: 'Draft', tags: [], createdAt: 0, updatedAt: 0, ...over,
  }
}
const link = (t: string) => `<p><a data-wikilink data-title="${t}">${t}</a></p>`
const titles = (ps: LorePage[]) => ps.map((p) => p.title)

// computeWorldHealth reads through the (id, updatedAt) memo, so pages sharing an
// id across tests would otherwise serve each other's cached links.
beforeEach(clearLinkedTitlesCache)

describe('computeWorldHealth — broken links', () => {
  it('groups references to one missing title into a single row', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('Mordor') }),
      page({ id: 'b', title: 'B', content: link('Mordor') }),
      page({ id: 'c', title: 'C', content: link('Mordor') }),
    ]
    const { brokenLinks } = computeWorldHealth(pages)
    expect(brokenLinks).toHaveLength(1)
    expect(brokenLinks[0].title).toBe('Mordor')
    expect(titles(brokenLinks[0].sources)).toEqual(['A', 'B', 'C'])
  })

  it('orders most-referenced first, then by title', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('Rare') }),
      page({ id: 'b', title: 'B', content: link('Common') }),
      page({ id: 'c', title: 'C', content: link('Common') }),
    ]
    expect(computeWorldHealth(pages).brokenLinks.map((b) => b.title)).toEqual(['Common', 'Rare'])
  })

  it('gives the first occurrence the display casing', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('the Shire') }),
      page({ id: 'b', title: 'B', content: link('The Shire') }),
    ]
    const { brokenLinks } = computeWorldHealth(pages)
    expect(brokenLinks).toHaveLength(1)
    expect(brokenLinks[0].title).toBe('the Shire')
  })

  it('resolves links case- and whitespace-insensitively', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link(' mordor ') }),
      page({ id: 'b', title: 'Mordor' }),
    ]
    expect(computeWorldHealth(pages).brokenLinks).toEqual([])
  })

  it('does not count a self-link as broken', () => {
    const pages = [page({ id: 'a', title: 'A', content: link('A') })]
    expect(computeWorldHealth(pages).brokenLinks).toEqual([])
  })

  it('counts a broken infobox ref', () => {
    const pages = [page({
      id: 'a', title: 'A',
      infobox: {
        template: 'Character', image: null, caption: '',
        fields: [{ id: 'f1', label: 'Home', value: '[[Mordor]]', fieldType: 'ref' }],
      },
    })]
    expect(computeWorldHealth(pages).brokenLinks.map((b) => b.title)).toEqual(['Mordor'])
  })
})

describe('computeWorldHealth — orphans', () => {
  it('flags a page nothing links to, even when it links outward', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('B') }),
      page({ id: 'b', title: 'B' }),
    ]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('does not let a self-link rescue a page', () => {
    const pages = [page({ id: 'a', title: 'A', content: link('A') })]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('lets an infobox ref rescue a page', () => {
    const pages = [
      page({
        id: 'a', title: 'A',
        infobox: {
          template: 'Character', image: null, caption: '',
          fields: [{ id: 'f1', label: 'Home', value: '[[B]]', fieldType: 'ref' }],
        },
      }),
      page({ id: 'b', title: 'B' }),
    ]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('sorts orphans by title', () => {
    const pages = [page({ id: 'b', title: 'Beta' }), page({ id: 'a', title: 'Alpha' })]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['Alpha', 'Beta'])
  })
})

describe('computeWorldHealth — stubs', () => {
  it('collects pages whose status is Stub', () => {
    const pages = [
      page({ id: 'a', title: 'A', status: 'Stub' }),
      page({ id: 'b', title: 'B', status: 'Complete' }),
    ]
    expect(titles(computeWorldHealth(pages).stubs)).toEqual(['A'])
  })

  it('does not treat a page with no status as a stub (pageStatus defaults to Draft)', () => {
    const pages = [page({ id: 'a', title: 'A', status: undefined })]
    expect(computeWorldHealth(pages).stubs).toEqual([])
  })
})

describe('computeWorldHealth — empty world', () => {
  it('returns three empty lists', () => {
    expect(computeWorldHealth([])).toEqual({ brokenLinks: [], orphans: [], stubs: [] })
  })
})
