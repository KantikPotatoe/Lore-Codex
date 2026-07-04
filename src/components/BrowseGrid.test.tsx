import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import BrowseGrid from './BrowseGrid'
import type { LorePage } from '../db'

afterEach(cleanup)

function makePage(over: Partial<LorePage> = {}): LorePage {
  return {
    id: 'p1', title: 'Fireball', category: 'Spell', content: '', summary: '',
    status: 'Draft', tags: [], infobox: undefined, createdAt: 0, updatedAt: 0, ...over,
  }
}

const EMPTY = { icon: '📭', title: 'Nothing here', message: 'Add something.' }

function renderGrid(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>)
}

describe('BrowseGrid', () => {
  it('renders the title, a live count, and a card per page', () => {
    const pages = [makePage({ id: 'p1', title: 'Fireball' }), makePage({ id: 'p2', title: 'Frostbite' })]
    renderGrid(<BrowseGrid title="Spell" pages={pages} empty={EMPTY} />)

    expect(screen.getByRole('heading', { name: /Spell/ })).toBeTruthy()
    expect(screen.getByText('2 pages')).toBeTruthy()
    expect(screen.getByText('Fireball')).toBeTruthy()
    expect(screen.getByText('Frostbite')).toBeTruthy()
  })

  it('uses the singular for one page and renders the glyph when given', () => {
    renderGrid(<BrowseGrid title="Spell" glyph="✨" pages={[makePage()]} empty={EMPTY} />)
    expect(screen.getByText('1 page')).toBeTruthy()
    expect(screen.getByText('✨')).toBeTruthy()
  })

  it('shows the empty state (and no cards) when there are no pages', () => {
    renderGrid(<BrowseGrid title="Spell" pages={[]} empty={EMPTY} />)

    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('0 pages')).toBeTruthy()
  })

  it('renders the optional action control', () => {
    renderGrid(
      <BrowseGrid
        title="Spell"
        pages={[]}
        empty={EMPTY}
        action={<button>+ New Spell</button>}
      />,
    )
    expect(screen.getByRole('button', { name: '+ New Spell' })).toBeTruthy()
  })
})
