import { describe, it, expect } from 'vitest'
import { tagCounts, orderTagChips } from './tags'
import type { LorePage } from './db'

function page(tags: string[]): LorePage {
  return {
    id: 'p', title: 't', category: 'Character', content: '', summary: '',
    status: 'Draft', tags, infobox: undefined, createdAt: 0, updatedAt: 0,
  }
}

describe('tagCounts', () => {
  it('returns an empty array for no pages', () => {
    expect(tagCounts([])).toEqual([])
  })

  it('tallies a tag across pages and dedupes', () => {
    const result = tagCounts([page(['magic']), page(['magic', 'lore']), page(['lore'])])
    expect(result).toEqual([
      { tag: 'lore', count: 2 },
      { tag: 'magic', count: 2 },
    ])
  })

  it('orders by count descending, then alphabetically', () => {
    const result = tagCounts([page(['magic']), page(['magic']), page(['lore'])])
    expect(result).toEqual([
      { tag: 'magic', count: 2 },
      { tag: 'lore', count: 1 },
    ])
  })

  it('breaks count ties alphabetically', () => {
    expect(tagCounts([page(['zebra', 'apple'])])).toEqual([
      { tag: 'apple', count: 1 },
      { tag: 'zebra', count: 1 },
    ])
  })
})

describe('orderTagChips', () => {
  const counts = [
    { tag: 'a', count: 5 },
    { tag: 'b', count: 4 },
    { tag: 'c', count: 3 },
    { tag: 'd', count: 2 },
  ]

  it('shows everything when the limit exceeds the tag count', () => {
    expect(orderTagChips(counts, new Set(), 10)).toEqual({
      shown: ['a', 'b', 'c', 'd'],
      hiddenCount: 0,
    })
  })

  it('truncates to the limit, keeping count order', () => {
    expect(orderTagChips(counts, new Set(), 2)).toEqual({
      shown: ['a', 'b'],
      hiddenCount: 2,
    })
  })

  it('promotes a selected tag that would otherwise be truncated', () => {
    expect(orderTagChips(counts, new Set(['d']), 2)).toEqual({
      shown: ['a', 'd'],
      hiddenCount: 2,
    })
  })

  it('never grows the row past the limit when promoting', () => {
    const { shown } = orderTagChips(counts, new Set(['c', 'd']), 2)
    expect(shown).toEqual(['c', 'd'])
  })

  it('shows every selected tag even past the limit', () => {
    expect(orderTagChips(counts, new Set(['b', 'c', 'd']), 2)).toEqual({
      shown: ['b', 'c', 'd'],
      hiddenCount: 1,
    })
  })

  it('handles no tags at all', () => {
    expect(orderTagChips([], new Set(), 12)).toEqual({ shown: [], hiddenCount: 0 })
  })
})
