import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createBook, createChapter, createScene, updateScene } from '../db'
import ManuscriptRoute from './ManuscriptRoute'

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
})
