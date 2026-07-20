import { describe, it, expect } from 'vitest'
import { matchesTags, NO_TAG_FILTER, type TagFilter } from './tagFilter'

const filter = (tags: string[], mode: TagFilter['mode']): TagFilter => ({ tags, mode })

describe('matchesTags', () => {
  it('passes everything when no tags are selected', () => {
    expect(matchesTags([], NO_TAG_FILTER)).toBe(true)
    expect(matchesTags(['magic'], NO_TAG_FILTER)).toBe(true)
    expect(matchesTags([], filter([], 'all'))).toBe(true)
  })

  it('any mode matches a node carrying at least one selected tag', () => {
    expect(matchesTags(['magic', 'lore'], filter(['magic', 'norse'], 'any'))).toBe(true)
  })

  it('any mode rejects a node carrying none of them', () => {
    expect(matchesTags(['lore'], filter(['magic', 'norse'], 'any'))).toBe(false)
  })

  it('all mode requires every selected tag', () => {
    expect(matchesTags(['magic', 'norse', 'lore'], filter(['magic', 'norse'], 'all'))).toBe(true)
    expect(matchesTags(['magic'], filter(['magic', 'norse'], 'all'))).toBe(false)
  })

  it('behaves like the old single-tag filter for one tag in either mode', () => {
    expect(matchesTags(['magic'], filter(['magic'], 'any'))).toBe(true)
    expect(matchesTags(['magic'], filter(['magic'], 'all'))).toBe(true)
    expect(matchesTags(['lore'], filter(['magic'], 'any'))).toBe(false)
    expect(matchesTags(['lore'], filter(['magic'], 'all'))).toBe(false)
  })

  it('ignores duplicate node tags', () => {
    expect(matchesTags(['magic', 'magic'], filter(['magic', 'norse'], 'all'))).toBe(false)
  })
})
