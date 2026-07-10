import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchModal from './SearchModal'
import WikiLinkPopover from './WikiLinkPopover'
import { db, pageRepo } from '../db'
import { resetIndex, syncSlice } from '../search'
import { pageEntries, eventEntries } from '../searchEntries'
import { recordRecent } from '../recents'

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  localStorage.clear()
  resetIndex() // reset the module-level FlexSearch index between tests
})

function renderModal() {
  return render(
    <MemoryRouter>
      <SearchModal onClose={() => {}} />
    </MemoryRouter>,
  )
}

// showPageHover/showWikiHover only take effect once WikiLinkPopover (mounted
// globally by App.tsx) is in the tree, so the hover-discrimination tests below
// render it alongside SearchModal to make hover behavior actually observable.
function renderModalWithHover() {
  return render(
    <MemoryRouter>
      <SearchModal onClose={() => {}} />
      <WikiLinkPopover />
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
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Moria' } })
    expect(await screen.findByText(/Create page/)).toBeTruthy()
  })

  it('hides the create row when a page with that exact title exists', async () => {
    const page = await pageRepo.create({ title: 'Moria' })
    syncSlice('page', pageEntries([(await pageRepo.get(page))!]))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'moria' } })
    await waitFor(() => expect(screen.queryByText(/Create page/)).toBeNull())
  })

  it('creates the page on Enter over the create row', async () => {
    renderModal()
    const input = screen.getByPlaceholderText(/Search/)
    fireEvent.change(input, { target: { value: 'Khazad-dûm' } })
    await screen.findByText(/Create page/)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      expect(await pageRepo.findIdByTitle('Khazad-dûm')).toBeTruthy()
    })
  })

  it('double Enter on the create row creates only one page', async () => {
    renderModal()
    const input = screen.getByPlaceholderText(/Search/)
    fireEvent.change(input, { target: { value: 'Erebor' } })
    await screen.findByText(/Create page/)
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      expect(await pageRepo.findIdByTitle('Erebor')).toBeTruthy()
    })
    expect(await db.pages.count()).toBe(1)
  })

  it('renders a type badge and navigates to the timeline for an event hit', async () => {
    syncSlice('event', eventEntries(
      [{ id: 'e1', calendarId: 'c1', title: 'Ashfall begins', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Ashfall' } })
    const row = await screen.findByText('Ashfall begins')
    expect(screen.getByText('Event')).toBeTruthy() // badge
    const link = row.closest('a')
    expect(link?.getAttribute('href')).toContain('/timeline?event=e1')
  })

  it('wires page-hover on a page row in the same harness (control for the next test)', async () => {
    const id = await pageRepo.create({ title: 'Gondor' })
    syncSlice('page', pageEntries([(await pageRepo.get(id))!]))
    renderModalWithHover()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Gondor' } })
    const row = await screen.findByText('Gondor')
    fireEvent.mouseEnter(row.closest('.search-result')!)
    // showPageHover has a 300ms open delay (src/wikiLinkHover.ts); wait past it.
    await waitFor(() => expect(document.querySelector('.wiki-hover-popover')).not.toBeNull(), { timeout: 1000 })
  })

  it('does not fire the page hover for a non-page row', async () => {
    // A page row wires onMouseEnter → showPageHover; an event row must not.
    // The previous test proves this harness DOES surface the popover for a
    // page row, so absence here is a meaningful, non-vacuous assertion.
    syncSlice('event', eventEntries(
      [{ id: 'e2', calendarId: 'c1', title: 'Founding', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModalWithHover()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Founding' } })
    // Select via the badge rather than the title text: the highlighted
    // snippet also renders a bare "Founding" <mark>, which would otherwise
    // make a plain findByText('Founding') ambiguous (multiple matches).
    const badge = await screen.findByText('Event')
    const row = badge.closest('.search-result')!
    fireEvent.mouseEnter(row)
    // Wait past showPageHover's 300ms open delay — if it had fired, the
    // popover would be mounted by now.
    await new Promise((r) => setTimeout(r, 400))
    expect(document.querySelector('.wiki-hover-popover')).toBeNull()
  })

  it('still offers the create row when non-page hits are present but no page title matches', async () => {
    syncSlice('event', eventEntries(
      [{ id: 'e3', calendarId: 'c1', title: 'Moria falls', description: '', category: '', pageId: null,
         startYear: 1, startMonth: 0, startDay: 1, startAbsolute: 0, createdAt: 1, updatedAt: 1 }],
      [{ id: 'c1', name: 'R', anchor: 0, months: [{ name: 'Seedfall', days: 30 }], weekdays: [], eras: [], createdAt: 1 }],
    ))
    renderModal()
    fireEvent.change(screen.getByPlaceholderText(/Search/), { target: { value: 'Moria' } })
    expect(await screen.findByText(/Create page/)).toBeTruthy()
  })
})
