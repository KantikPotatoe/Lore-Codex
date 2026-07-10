import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createCalendar, addEvent } from '../db'
import PageHistory, { COLLAPSED_COUNT } from './PageHistory'

const PAGE_ID = 'page-ashfall'
const TITLE = 'Ashfall'

afterEach(cleanup)
beforeEach(async () => {
  await Promise.all([db.events.clear(), db.calendars.clear()])
})

function renderHistory(pageId = PAGE_ID, title = TITLE) {
  return render(
    <MemoryRouter>
      <PageHistory pageId={pageId} title={title} />
    </MemoryRouter>,
  )
}

/** One linked event in `calendarId`, dated year `year` so the sort is stable. */
function seedEvent(calendarId: string, title: string, year: number, pageId: string | null = PAGE_ID) {
  return addEvent({
    calendarId,
    title,
    description: '',
    category: '',
    pageId,
    startYear: year,
    startMonth: 0,
    startDay: 1,
  })
}

/** The rendered rows, once the live queries have filled in. */
async function rows() {
  const list = await screen.findByRole('list')
  return within(list).getAllByRole('listitem')
}

describe('PageHistory — which events surface', () => {
  it('lists events referencing the page and omits the rest', async () => {
    const cal = await createCalendar('Imperial')
    await seedEvent(cal, 'The Sundering', 412)
    await seedEvent(cal, 'Unrelated Coronation', 500, 'some-other-page')

    renderHistory()
    expect(await screen.findByText('The Sundering')).toBeTruthy()
    expect(screen.queryByText('Unrelated Coronation')).toBeNull()
  })

  it('renders nothing at all when no event references the page', async () => {
    const cal = await createCalendar('Imperial')
    await seedEvent(cal, 'Unrelated Coronation', 500, 'some-other-page')

    const { container } = renderHistory()
    // Give the live queries a round-trip to settle before asserting absence.
    await waitFor(async () => expect(await db.events.count()).toBe(1))
    expect(container.querySelector('.page-history')).toBeNull()
  })
})

describe('PageHistory — collapsing', () => {
  it(`shows the first ${COLLAPSED_COUNT} rows and expands on "Show all"`, async () => {
    const cal = await createCalendar('Imperial')
    const total = COLLAPSED_COUNT + 2
    for (let i = 0; i < total; i++) {
      await seedEvent(cal, `Event ${String(i).padStart(2, '0')}`, i)
    }

    renderHistory()
    expect(await rows()).toHaveLength(COLLAPSED_COUNT)
    // The count badge reports the whole chronology, not the visible slice.
    expect(screen.getByText(String(total), { selector: '.backlinks-count' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: `Show all ${total}` }))

    expect(await rows()).toHaveLength(total)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it(`offers no "Show all" at exactly ${COLLAPSED_COUNT} rows`, async () => {
    const cal = await createCalendar('Imperial')
    for (let i = 0; i < COLLAPSED_COUNT; i++) {
      await seedEvent(cal, `Event ${String(i).padStart(2, '0')}`, i)
    }

    renderHistory()
    expect(await rows()).toHaveLength(COLLAPSED_COUNT)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })
})

describe('PageHistory — the multi-calendar gate', () => {
  it('names the reckoning on each row when the chronology spans two calendars', async () => {
    const imperial = await createCalendar('Imperial')
    const elven = await createCalendar('Elven Reckoning')
    await seedEvent(imperial, 'The Sundering', 412)
    await seedEvent(elven, 'The Long Silence', 500)

    renderHistory()
    await screen.findByText('The Sundering')
    expect(screen.getByText('Imperial')).toBeTruthy()
    expect(screen.getByText('Elven Reckoning')).toBeTruthy()
  })

  it('stays quiet about the reckoning when every event shares one calendar', async () => {
    const imperial = await createCalendar('Imperial')
    await seedEvent(imperial, 'The Sundering', 412)
    await seedEvent(imperial, 'The Long Silence', 500)

    renderHistory()
    await screen.findByText('The Sundering')
    expect(screen.queryByText('Imperial')).toBeNull()
  })
})
