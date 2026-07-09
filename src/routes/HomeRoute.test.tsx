import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createPage } from '../db'
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
})
