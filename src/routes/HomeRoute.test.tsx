import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createPage, createCalendar, addEvent } from '../db'
import HomeRoute from './HomeRoute'

const DAY = 86_400_000

afterEach(cleanup)
beforeEach(async () => {
  await Promise.all([db.pages.clear(), db.events.clear(), db.calendars.clear(), db.meta.clear()])
})

function renderHome() {
  return render(<MemoryRouter initialEntries={['/home']}><HomeRoute /></MemoryRouter>)
}

describe('HomeRoute — Dusty corners', () => {
  it('surfaces a page untouched beyond the threshold', async () => {
    const id = await createPage({ title: 'Forgotten Ruin' })
    await db.pages.update(id, { updatedAt: Date.now() - 200 * DAY })
    renderHome()
    const heading = await screen.findByText('Dusty corners')
    // The lone page also legitimately shows in "Recently edited" (it's the
    // only page, so trivially the most recent one) — scope to the Dusty
    // corners section so the two occurrences don't collide.
    const section = heading.closest('section')!
    expect(within(section).getByText('Forgotten Ruin')).toBeTruthy()
  })

  it('hides the panel when every page is fresh', async () => {
    await createPage({ title: 'Fresh Page' })
    renderHome()
    await screen.findByText('Fresh Page') // in Recently edited
    expect(screen.queryByText('Dusty corners')).toBeNull()
  })

  it('shows how long a dusty page has been neglected', async () => {
    // The one piece of information the shared card does not carry on its own —
    // it rides in via BrowseCard's `meta` slot, so it is worth pinning down.
    const id = await createPage({ title: 'Forgotten Ruin' })
    await db.pages.update(id, { updatedAt: Date.now() - 200 * DAY })
    renderHome()
    const heading = await screen.findByText('Dusty corners')
    const section = heading.closest('section')!
    expect(within(section).getByText('6 months ago')).toBeTruthy()
  })
})

describe('HomeRoute — On this day', () => {
  it('features an event with its in-world date', async () => {
    const calId = await createCalendar('Imperial')
    await addEvent({
      calendarId: calId,
      title: 'The Sundering',
      description: '<p>The world cracked in two.</p>',
      category: 'Cataclysm',
      pageId: null,
      startYear: 412, startMonth: 0, startDay: 3,
    })
    renderHome()
    expect(await screen.findByText('On this day')).toBeTruthy()
    expect(await screen.findByText('The Sundering')).toBeTruthy()
    expect(screen.getByText(/The world cracked in two/)).toBeTruthy()
  })

  it('hides the panel when there are no events', async () => {
    await createPage({ title: 'Anything' })
    renderHome()
    await screen.findByText('Anything')
    expect(screen.queryByText('On this day')).toBeNull()
  })
})

describe('HomeRoute — World health', () => {
  it('is suppressed on an empty world', async () => {
    renderHome()
    await screen.findByText('Your world is unwritten')
    expect(screen.queryByText('World health')).toBeNull()
  })

  it('shows the all-clear line when there are no problems', async () => {
    // Two pages linking to each other so neither is an orphan, and no broken
    // links or stubs — a genuinely clean world.
    const link = (t: string) => `<p><a data-wikilink data-title="${t}">${t}</a></p>`
    await createPage({ title: 'Alpha', content: link('Beta') })
    await createPage({ title: 'Beta', content: link('Alpha') })
    renderHome()
    await screen.findByText('World health')
    expect(screen.getByText(/Nothing dangling/)).toBeTruthy()
  })

  it('shows counts when there are problems', async () => {
    await createPage({ title: 'Stubby', status: 'Stub' })
    renderHome()
    await screen.findByText('World health')
    // A lone page with no inbound links is also an orphan, alongside the stub.
    expect(screen.getByText('0 broken links')).toBeTruthy()
    expect(screen.getByText('1 orphan')).toBeTruthy()
    expect(screen.getByText('1 stub')).toBeTruthy()
  })
})
