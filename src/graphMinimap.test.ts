import { describe, it, expect } from 'vitest'
import { nodeBounds, fitMapping, toMini, toGraph, viewportRect } from './graphMinimap'

describe('graphMinimap', () => {
  it('nodeBounds spans positioned nodes and ignores unpositioned ones', () => {
    expect(nodeBounds([{ x: -10, y: 5 }, { x: 30, y: -20 }, {}])).toEqual({
      minX: -10, minY: -20, maxX: 30, maxY: 5,
    })
  })

  it('nodeBounds is null before the simulation has placed anything', () => {
    expect(nodeBounds([])).toBeNull()
    expect(nodeBounds([{}, {}])).toBeNull()
  })

  it('fitMapping fits the tight axis to the padded box and centres the loose one', () => {
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    const m = fitMapping(b, 180, 130, 8)
    const tl = toMini(m, 0, 0)
    const br = toMini(m, 100, 50)
    expect(tl.x).toBeCloseTo(8)        // horizontal is tight: hits the padding
    expect(br.x).toBeCloseTo(172)
    expect((tl.y + br.y) / 2).toBeCloseTo(65) // vertical is loose: centred
  })

  it('toGraph inverts toMini', () => {
    const m = fitMapping({ minX: -50, minY: -50, maxX: 50, maxY: 50 }, 180, 130)
    const p = toMini(m, 12, -34)
    const g = toGraph(m, p.x, p.y)
    expect(g.x).toBeCloseTo(12)
    expect(g.y).toBeCloseTo(-34)
  })

  it('viewportRect is centred on the camera and shrinks as zoom grows', () => {
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const m = fitMapping(b, 100, 100, 0) // identity: scale 1, no offset
    const r = viewportRect(m, { k: 2, cx: 50, cy: 50 }, 100, 100)
    expect(r.x).toBeCloseTo(25)
    expect(r.y).toBeCloseTo(25)
    expect(r.w).toBeCloseTo(50)
    expect(r.h).toBeCloseTo(50)
  })

  it('degenerate bounds (single node) still produce a finite mapping', () => {
    const m = fitMapping({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 180, 130)
    const p = toMini(m, 5, 5)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })
})
