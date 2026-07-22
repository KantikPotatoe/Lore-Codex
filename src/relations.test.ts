import { describe, it, expect } from 'vitest'
import { isSymmetric, resolveRelation } from './relations'
import type { Relationship, RelationshipType } from './db'

const parentOf: RelationshipType = {
  id: 'parent-of', label: 'Parent of', inverse: 'Child of',
  color: '#e0a458', group: 'kin', order: 0, builtin: true,
}
const allyOf: RelationshipType = {
  id: 'ally-of', label: 'Ally of', inverse: 'Ally of',
  color: '#7eb09b', group: 'faction', order: 3, builtin: true,
}

const row: Relationship = {
  id: 'r1', fromId: 'uther', toId: 'arthur',
  typeId: 'parent-of', note: '', createdAt: 1,
}

describe('isSymmetric', () => {
  it('is true when both ends read the same', () => {
    expect(isSymmetric(allyOf)).toBe(true)
  })

  it('is false when the ends differ', () => {
    expect(isSymmetric(parentOf)).toBe(false)
  })

  it('ignores surrounding whitespace and case', () => {
    expect(isSymmetric({ ...allyOf, inverse: '  ally of  ' })).toBe(true)
  })
})

describe('resolveRelation', () => {
  it('reads the label from the `from` end', () => {
    const r = resolveRelation(row, parentOf, 'uther')
    expect(r).toEqual({ row, type: parentOf, label: 'Parent of', otherId: 'arthur' })
  })

  it('reads the inverse from the `to` end', () => {
    const r = resolveRelation(row, parentOf, 'arthur')
    expect(r?.label).toBe('Child of')
    expect(r?.otherId).toBe('uther')
  })

  it('reads the same label from either end of a symmetric type', () => {
    const sym: Relationship = { ...row, typeId: 'ally-of' }
    expect(resolveRelation(sym, allyOf, 'uther')?.label).toBe('Ally of')
    expect(resolveRelation(sym, allyOf, 'arthur')?.label).toBe('Ally of')
  })

  it('returns null when the viewer is on neither end', () => {
    expect(resolveRelation(row, parentOf, 'merlin')).toBeNull()
  })
})
