import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BrowseCard from './BrowseCard'
import type { LorePage } from '../db'

afterEach(cleanup)

function makePage(over: Partial<LorePage> = {}): LorePage {
  return {
    id: 'p1', title: 'Fireball', category: 'Spell', content: '', summary: 'A fiery blast',
    status: 'Draft', tags: [], infobox: undefined, createdAt: 0, updatedAt: 0, ...over,
  }
}

describe('BrowseCard', () => {
  it('links to the page and shows its name, summary, and status', () => {
    render(<MemoryRouter><BrowseCard page={makePage()} /></MemoryRouter>)
    const link = screen.getByRole('link')
    expect(link.getAttribute('href')).toBe('/page/p1')
    expect(screen.getByText('Fireball')).toBeTruthy()
    expect(screen.getByText('A fiery blast')).toBeTruthy()
    expect(screen.getByText('Draft')).toBeTruthy()
  })

  it('falls back to a placeholder initial when there is no infobox image', () => {
    render(<MemoryRouter><BrowseCard page={makePage({ title: 'Zephyr' })} /></MemoryRouter>)
    expect(screen.getByText('Z')).toBeTruthy()
  })

  it('renders a meta note beside the status when given one', () => {
    render(
      <MemoryRouter>
        <BrowseCard page={makePage()} meta="3 months ago" />
      </MemoryRouter>,
    )
    expect(screen.getByText('3 months ago')).toBeTruthy()
  })

  it('omits the meta element entirely when not given one', () => {
    // Without this, every /browse and /tag card would carry an empty node.
    const { container } = render(<MemoryRouter><BrowseCard page={makePage()} /></MemoryRouter>)
    expect(container.querySelector('.browse-card-meta')).toBeNull()
  })
})
