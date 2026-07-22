// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Relations from './Relations'
import { db, seedRelationshipTypes, addRelationship, type LorePage } from '../db'

const uther: LorePage = {
  id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
  content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
}

beforeEach(async () => {
  await db.relationships.clear()
  await db.relationshipTypes.clear()
  await db.pages.clear()
  await seedRelationshipTypes()
  await db.pages.bulkAdd([
    uther,
    { ...uther, id: 'arthur', title: 'Arthur', titleLc: 'arthur' },
  ])
})

// useLiveQuery components need this, or teardown throws "window is not defined".
afterEach(cleanup)

function renderPanel(editable: boolean) {
  return render(
    <MemoryRouter>
      <Relations page={uther} editable={editable} />
    </MemoryRouter>,
  )
}

describe('Relations', () => {
  it('renders nothing in view mode when the page has no relations', async () => {
    const { container } = renderPanel(false)
    // Let the useLiveQuery resolve before asserting emptiness.
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.relations')).toBeNull()
  })

  it('shows the add form in edit mode even with no relations', async () => {
    renderPanel(true)
    expect(await screen.findByText('Relations')).toBeTruthy()
  })

  it('renders the inverse label when the viewer is the `to` end', async () => {
    await addRelationship('arthur', 'uther', 'parent-of') // Uther is the `to`
    renderPanel(false)
    expect(await screen.findByText('Child of')).toBeTruthy()
    expect(await screen.findByText('Arthur')).toBeTruthy()
  })

  it('shows the note beside the row', async () => {
    await addRelationship('uther', 'arthur', 'spouse-of', 'm. 1042–1067')
    renderPanel(false)
    expect(await screen.findByText('m. 1042–1067')).toBeTruthy()
  })
})
