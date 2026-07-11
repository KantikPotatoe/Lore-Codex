import { describe, it, expect } from 'vitest'
import { navDirection } from './navDirection'

describe('navDirection', () => {
  it('is forward when the history index increases', () => {
    expect(navDirection(0, 1, 'PUSH')).toBe('forward')
    expect(navDirection(3, 5, 'POP')).toBe('forward')
  })

  it('is back when the history index decreases', () => {
    expect(navDirection(2, 1, 'POP')).toBe('back')
    expect(navDirection(5, 0, 'POP')).toBe('back')
  })

  it('is forward on equal indices (replace / re-render)', () => {
    expect(navDirection(2, 2, 'REPLACE')).toBe('forward')
    expect(navDirection(0, 0, 'PUSH')).toBe('forward')
  })

  it('is forward on the first navigation when no previous index is known', () => {
    expect(navDirection(undefined, 0, 'POP')).toBe('forward')
    expect(navDirection(undefined, 4, 'PUSH')).toBe('forward')
  })

  // The session's first history entry predates the router and has no idx, so a
  // navigation TO it can't be settled by index alone. navType breaks the tie.
  it('is back when POPping to an idx-less entry from a known one', () => {
    expect(navDirection(1, undefined, 'POP')).toBe('back')
  })

  it('is forward when a PUSH lands on an idx-less entry', () => {
    expect(navDirection(1, undefined, 'PUSH')).toBe('forward')
  })

  it('is forward when both indices are unknown, whatever the navType', () => {
    // No previous entry to go back to → neutral forward even on POP.
    expect(navDirection(undefined, undefined, 'POP')).toBe('forward')
    expect(navDirection(undefined, undefined, 'PUSH')).toBe('forward')
  })
})
