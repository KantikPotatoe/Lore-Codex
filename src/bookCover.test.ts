import { describe, expect, it } from 'vitest'
import { coverHue } from './bookCover'

const PALETTE = ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd'] as const

describe('coverHue', () => {
  it('returns a colour from the supplied palette', () => {
    expect(PALETTE).toContain(coverHue('The Ashen Crown', PALETTE))
  })

  it('is deterministic — the same title always yields the same colour', () => {
    expect(coverHue('Salt and Iron', PALETTE)).toBe(coverHue('Salt and Iron', PALETTE))
  })

  it('spreads different titles across the palette rather than collapsing to one bucket', () => {
    const titles = [
      'The Ashen Crown', 'Salt and Iron', 'The Long Thaw',
      'Vespers', 'Tidewrack', 'The Gilded Hour',
    ]
    const hues = new Set(titles.map((t) => coverHue(t, PALETTE)))
    expect(hues.size).toBeGreaterThan(1)
  })

  it('handles an empty title (a book created but not yet named)', () => {
    expect(PALETTE).toContain(coverHue('', PALETTE))
  })
})
