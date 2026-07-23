// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Relations from './Relations'
import { db, seedRelationshipTypes, addRelationship, relationshipRepo, type LorePage } from '../db'

const uther: LorePage = {
  id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
  content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
}
const arthur: LorePage = { ...uther, id: 'arthur', title: 'Arthur', titleLc: 'arthur' }
// A third, unrelated page — used as the "genuinely has no relations" contrast
// below. Reusing uther/arthur for that would only prove the *other* end of a
// relationship it does have.
const igraine: LorePage = { ...uther, id: 'igraine', title: 'Igraine', titleLc: 'igraine' }

beforeEach(async () => {
  await db.relationships.clear()
  await db.relationshipTypes.clear()
  await db.pages.clear()
  await seedRelationshipTypes()
  await db.pages.bulkAdd([uther, arthur, igraine])
})

// useLiveQuery components need this, or teardown throws "window is not defined".
afterEach(cleanup)

function renderPanel(editable: boolean, page: LorePage = uther) {
  return render(
    <MemoryRouter>
      <Relations page={page} editable={editable} />
    </MemoryRouter>,
  )
}

describe('Relations', () => {
  it('renders nothing in view mode for a page with no relations, contrasted against one that does', async () => {
    await addRelationship('uther', 'arthur', 'spouse-of')
    const listForSpy = vi.spyOn(relationshipRepo, 'listFor')

    // First prove the harness actually resolves useLiveQuery and renders real
    // data — otherwise the negative assertion below can't be trusted; both
    // "never awaited" and "swallowed a throw" would render the same nothing
    // that an unresolved query does.
    renderPanel(false)
    await screen.findByText('Arthur')

    // Now render a page with zero relationship rows, and — rather than
    // guessing at a delay — await the *actual* promise the component's own
    // query made for this exact page id, so "renders nothing" is proven to
    // follow a real resolved-empty result rather than an unresolved default.
    const { container } = renderPanel(false, igraine)
    await waitFor(() => {
      expect(listForSpy.mock.calls.some(([id]) => id === igraine.id)).toBe(true)
    })
    const callIndex = listForSpy.mock.calls.findIndex(([id]) => id === igraine.id)
    const resolved = await listForSpy.mock.results[callIndex].value
    expect(resolved).toEqual([])
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
