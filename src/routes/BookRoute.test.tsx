import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { db } from '../db'
import BookRoute from './BookRoute'

afterEach(async () => {
  cleanup()
  await Promise.all([db.books.clear(), db.chapters.clear(), db.scenes.clear()])
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/book/:bookId" element={<BookRoute />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('BookRoute', () => {
  it('shows the book title and Write/Grid toggle', async () => {
    await db.books.add({ id: 'b1', title: 'My Novel', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    renderAt('/book/b1')
    expect(await screen.findByDisplayValue('My Novel')).toBeTruthy()
    expect(screen.getByRole('button', { name: /write/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /grid/i })).toBeTruthy()
  })

  it('renames the book via the title input', async () => {
    await db.books.add({ id: 'b1', title: 'My Novel', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    renderAt('/book/b1')
    const input = await screen.findByLabelText('Book title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed Novel' } })
    await waitFor(async () => expect((await db.books.get('b1'))?.title).toBe('Renamed Novel'))
  })

  it('switches to the grid view', async () => {
    await db.books.add({ id: 'b1', title: 'My Novel', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    renderAt('/book/b1')
    fireEvent.click(await screen.findByRole('button', { name: /grid/i }))
    expect(await screen.findByText(/no plotlines yet/i)).toBeTruthy()
  })

  it('shows compile buttons (EPUB + Print)', async () => {
    await db.books.add({ id: 'b1', title: 'My Novel', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    renderAt('/book/b1')
    expect(await screen.findByRole('button', { name: /epub/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /print|pdf/i })).toBeTruthy()
  })
})
