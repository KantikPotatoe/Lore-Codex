import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { db, createPage } from '../db'
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
    const btn = await screen.findByRole('button', { name: /random page/i })
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
})
