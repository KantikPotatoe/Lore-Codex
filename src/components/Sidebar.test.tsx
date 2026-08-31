import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { db, createPage, seedTemplates } from '../db'
import Sidebar from './Sidebar'

afterEach(cleanup)

function renderSidebar(path = '/home') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar onOpenSearch={() => {}} />
    </MemoryRouter>,
  )
}

describe('Sidebar tags group', () => {
  beforeEach(async () => {
    await db.pages.clear()
  })

  it('lists tags with counts linking to the tag route', async () => {
    await createPage({ title: 'Fireball', tags: ['magic'] })
    await createPage({ title: 'Wizard Tower', tags: ['magic', 'places'] })

    renderSidebar()

    const link = await screen.findByRole('link', { name: /#magic/ })
    expect(link.getAttribute('href')).toBe('/tag/magic')
    expect(link.textContent).toContain('2') // magic is on 2 pages
  })

  it('omits the tags group when no page has tags', async () => {
    await createPage({ title: 'Untagged' })

    renderSidebar()

    await screen.findByText('Untagged') // wait for the page list to load
    expect(screen.queryByText('Tags')).toBeNull()
  })
})

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

describe('Sidebar random page', () => {
  beforeEach(async () => { await db.pages.clear() })

  it('navigates to a page when clicked', async () => {
    await createPage({ title: 'Solo Page' })
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Sidebar onOpenSearch={() => {}} />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByText('Solo Page') // the live query must resolve before the button has a candidate
    const btn = await screen.findByRole('button', { name: /random page/i })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toMatch(/^\/page\//),
    )
  })

  it('disables the button when there are no pages', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Sidebar onOpenSearch={() => {}} />
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: /random page/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  it('never navigates to the current page when another page exists', async () => {
    const id1 = await createPage({ title: 'Page One' })
    const id2 = await createPage({ title: 'Page Two' })
    render(
      <MemoryRouter initialEntries={[`/page/${id1}`]}>
        <Sidebar onOpenSearch={() => {}} />
        <LocationProbe />
      </MemoryRouter>,
    )
    await screen.findByText('Page Two') // wait for pages to load so the button isn't stuck disabled
    const btn = await screen.findByRole('button', { name: /random page/i })
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(btn)
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toBe(`/page/${id2}`),
    )
  })
})

describe('Sidebar type groups', () => {
  beforeEach(async () => {
    await db.pages.clear()
    await db.templates.clear()
    await seedTemplates()
  })

  it('nests a grouped type under its group header with a total count', async () => {
    await createPage({ title: 'Eldoria', category: 'Settlement' })
    await createPage({ title: 'Valmara', category: 'Country' })

    renderSidebar()

    // "Places" groups Country + Settlement, so its total is 2. Matched by regex
    // because the header's text content is "Places 2" (label + count span).
    const group = await screen.findByText(/^Places/)
    expect(group.textContent).toContain('2')

    // A group header is not a link; the type header still is.
    expect(group.closest('a')).toBeNull()
    const typeLink = await screen.findByRole('link', { name: /Settlement/ })
    expect(typeLink.getAttribute('href')).toBe('/browse/Settlement')
  })

  it('collapsing a group hides its child types', async () => {
    await createPage({ title: 'Eldoria', category: 'Settlement' })

    renderSidebar()
    await screen.findByText('Eldoria')

    // Target the "Places" group's own toggle, not whichever button happens to
    // be first — Recent and Tags are collapsible too.
    const header = (await screen.findByText(/^Places/)).closest('.group-head')!
    fireEvent.click(header.querySelector('button')!)

    await waitFor(() => expect(screen.queryByText('Eldoria')).toBeNull())
    // The type header went with it.
    expect(screen.queryByRole('link', { name: /Settlement/ })).toBeNull()
  })
})
