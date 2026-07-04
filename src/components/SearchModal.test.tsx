import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchModal from './SearchModal'
import { db, pageRepo } from '../db'
import { buildIndex } from '../search'
import { recordRecent } from '../recents'

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  localStorage.clear()
  buildIndex([]) // reset the module-level FlexSearch index between tests
})

function renderModal() {
  return render(
    <MemoryRouter>
      <SearchModal onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('SearchModal', () => {
  it('shows recently viewed pages when the query is empty', async () => {
    const id = await pageRepo.create({ title: 'Rivendell' })
    recordRecent(id)
    renderModal()
    expect(await screen.findByText('Recently viewed')).toBeTruthy()
    expect(await screen.findByText('Rivendell')).toBeTruthy()
  })

  it('offers a create row when no page has the queried title', async () => {
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('Search pages…'), { target: { value: 'Moria' } })
    expect(await screen.findByText(/Create page/)).toBeTruthy()
  })

  it('hides the create row when a page with that exact title exists', async () => {
    const page = await pageRepo.create({ title: 'Moria' })
    buildIndex([(await pageRepo.get(page))!])
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('Search pages…'), { target: { value: 'moria' } })
    await waitFor(() => expect(screen.queryByText(/Create page/)).toBeNull())
  })

  it('creates the page on Enter over the create row', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('Search pages…')
    fireEvent.change(input, { target: { value: 'Khazad-dûm' } })
    await screen.findByText(/Create page/)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      expect(await pageRepo.findIdByTitle('Khazad-dûm')).toBeTruthy()
    })
  })

  it('double Enter on the create row creates only one page', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('Search pages…')
    fireEvent.change(input, { target: { value: 'Erebor' } })
    await screen.findByText(/Create page/)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      expect(await pageRepo.findIdByTitle('Erebor')).toBeTruthy()
    })
    expect(await db.pages.count()).toBe(1)
  })
})
