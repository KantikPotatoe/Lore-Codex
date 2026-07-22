// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import RelationshipTypesPanel from './RelationshipTypesPanel'
import { db, seedRelationshipTypes } from '../db'

beforeEach(async () => {
  await db.relationshipTypes.clear()
  await db.relationships.clear()
  await seedRelationshipTypes()
})

afterEach(cleanup)

describe('RelationshipTypesPanel', () => {
  it('lists the seeded vocabulary with both labels', async () => {
    render(<RelationshipTypesPanel />)
    expect(await screen.findByDisplayValue('Parent of')).toBeTruthy()
    expect(await screen.findByDisplayValue('Child of')).toBeTruthy()
  })

  it('marks a type whose labels match as symmetric', async () => {
    render(<RelationshipTypesPanel />)
    // ally-of ships as "Ally of" / "Ally of".
    const hints = await screen.findAllByText('symmetric')
    expect(hints.length).toBeGreaterThan(0)
  })

  it('offers Reset but no Delete for a built-in', async () => {
    render(<RelationshipTypesPanel />)
    await screen.findByDisplayValue('Parent of')
    expect(screen.queryAllByTitle('Delete type')).toHaveLength(0)
    expect(screen.getAllByTitle('Restore shipped labels and colour').length).toBeGreaterThan(0)
  })

  it('adds a custom type, which does offer Delete', async () => {
    render(<RelationshipTypesPanel />)
    fireEvent.click(await screen.findByText('＋ Add type'))
    // The new type's label and inverse both default to "New relationship" (it
    // ships symmetric), so this must match both the label and inverse inputs.
    expect((await screen.findAllByDisplayValue('New relationship')).length).toBe(2)
    expect((await screen.findAllByTitle('Delete type')).length).toBe(1)
  })
})
