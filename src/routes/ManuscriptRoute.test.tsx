import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createBook, createChapter, createScene, updateScene, TYPE_COLORS } from '../db'
import ManuscriptRoute from './ManuscriptRoute'
import { coverHue } from '../bookCover'

afterEach(async () => {
  cleanup()
  await Promise.all([db.books.clear(), db.chapters.clear(), db.scenes.clear()])
})

describe('ManuscriptRoute', () => {
  it('renders the Manuscript heading', () => {
    render(
      <MemoryRouter>
        <ManuscriptRoute />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /manuscript/i })).toBeTruthy()
  })

  it('lists existing books', async () => {
    await db.books.add({ id: 'b1', title: 'The Long Road', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    render(
      <MemoryRouter>
        <ManuscriptRoute />
      </MemoryRouter>,
    )
    expect(await screen.findByText('The Long Road')).toBeTruthy()
  })

  it('shows an empty hint when there are no books', async () => {
    render(
      <MemoryRouter>
        <ManuscriptRoute />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/no books yet/i)).toBeTruthy()
  })

  it('shows a book’s scene count and word total', async () => {
    const book = await createBook('Counted')
    const ch = await createChapter(book.id, 'C')
    const sc = await createScene(book.id, ch.id, 'S')
    await updateScene(sc.id, { content: '<p>one two three</p>' })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    expect(await screen.findByText(/1 scene · 3 words/i)).toBeTruthy()
  })

  it('staggers book cards by index, capped at 12', async () => {
    const books = Array.from({ length: 15 }, (_, i) => ({
      id: `b${i}`, title: `Book ${i}`, synopsis: '', order: i, createdAt: 1, updatedAt: 1,
    }))
    await db.books.bulkAdd(books)
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    const first = (await screen.findByText('Book 0')).closest('.book-card') as HTMLElement
    const last = (await screen.findByText('Book 14')).closest('.book-card') as HTMLElement
    expect(first.style.getPropertyValue('--stagger-i')).toBe('0')
    expect(last.style.getPropertyValue('--stagger-i')).toBe('12')
  })

  it('gives each cover a deterministic hue derived from its own title', async () => {
    await db.books.bulkAdd([
      { id: 'b1', title: 'The Ashen Crown', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 },
      { id: 'b2', title: 'Salt and Iron', synopsis: '', order: 1, createdAt: 1, updatedAt: 1 },
    ])
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    for (const t of ['The Ashen Crown', 'Salt and Iron']) {
      const card = (await screen.findByText(t)).closest('.book-card') as HTMLElement
      expect(card.style.getPropertyValue('--cover-hue')).toBe(coverHue(t, TYPE_COLORS))
    }
  })

  it('renders the blurb as a reveal layer on the cover', async () => {
    await db.books.add({
      id: 'b1', title: 'Salt and Iron', synopsis: 'Two smugglers, one debt.',
      order: 0, createdAt: 1, updatedAt: 1,
    })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    const blurb = await screen.findByText('Two smugglers, one debt.')
    // It IS the reveal layer, not loose synopsis text rendered anywhere on the page.
    expect(blurb.classList.contains('book-card-blurb')).toBe(true)
    // And it lives on that book's cover.
    const cover = screen.getByText('Salt and Iron').closest('.book-card')
    expect(blurb.closest('.book-card')).toBe(cover)
  })

  it('renders no blurb layer when the book has no synopsis', async () => {
    await db.books.add({ id: 'b1', title: 'Bare', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    await screen.findByText('Bare')
    expect(document.querySelector('.book-card-blurb')).toBeNull()
  })

  it('puts the add-tile at the end of the shelf, not in the header', async () => {
    await db.books.add({ id: 'b1', title: 'One', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    await screen.findByText('One')  // wait past the empty-state's initial render
    const tile = screen.getByRole('button', { name: /new book/i })
    expect(tile.classList.contains('book-card-add')).toBe(true)

    const grid = document.querySelector('.book-grid') as HTMLElement
    expect(tile.parentElement).toBe(grid)       // on the shelf
    expect(grid.lastElementChild).toBe(tile)    // at the end of it
    expect(tile.style.getPropertyValue('--stagger-i')).toBe('1')  // joins the stagger wave

    // The old permanent header CTA is gone — this is the assertion that would
    // have gone red against the pre-shelf code.
    expect(document.querySelector('.manuscript-head button')).toBeNull()
  })

  it('shows no shelf tile when there are no books', async () => {
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    await screen.findByText(/no books yet/i)
    // The empty state carries the create CTA instead.
    expect(document.querySelector('.book-card-add')).toBeNull()
  })
})
