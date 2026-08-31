import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createPage, defaultInfobox, seedTemplates } from '../db'
import TemplatesRoute from './TemplatesRoute'

afterEach(cleanup)

describe('TemplatesRoute - apply-changes prompt', () => {
  beforeEach(async () => {
    await db.pages.clear()
    await db.templates.clear()
    // One custom template used by two pages.
    await db.templates.add({
      id: 'tpl-hero', name: 'Hero', color: '#888', builtin: false,
      items: [{ label: 'Title' }],
    })
    await createPage({ title: 'Alice', category: 'Hero', infobox: await defaultInfobox('Hero') })
    await createPage({ title: 'Bob', category: 'Hero', infobox: await defaultInfobox('Hero') })
  })

  it('hides the prompt until a row is edited, then applies and collapses it', async () => {
    render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)

    // The "Hero" template is auto-selected (only one). Wait for it to render.
    await screen.findByDisplayValue('Hero')

    // Initially quiet: no "you changed this type's rows" message.
    expect(screen.queryByText(/you changed this type's rows/i)).toBeNull()

    // Edit a row: add a field. The prompt should appear with the page count.
    fireEvent.click(screen.getByText('＋ Add field'))
    expect(await screen.findByText(/you changed this type's rows/i)).toBeTruthy()
    const applyBtn = screen.getByRole('button', { name: /apply to 2 existing pages/i })

    // Apply: prompt collapses and a success note appears.
    fireEvent.click(applyBtn)
    await waitFor(() =>
      expect(screen.queryByText(/you changed this type's rows/i)).toBeNull(),
    )
    expect(screen.getByText(/updated 2 pages/i)).toBeTruthy()
  })
})

describe('TemplatesRoute - sidebar group', () => {
  beforeEach(async () => {
    await db.templates.clear()
    await seedTemplates()
  })

  it('saves a group onto the selected type and suggests existing groups', async () => {
    render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)

    // Wait for Settlement to appear, then click it
    const settlementBtn = await screen.findByRole('button', { name: /Settlement/ })
    fireEvent.click(settlementBtn)

    // Task 1 backfilled Settlement into "Places".
    const input = await screen.findByLabelText('Group')
    expect((input as HTMLInputElement).value).toBe('Places')

    fireEvent.change(input, { target: { value: 'Realms' } })

    await waitFor(async () => {
      const all = await db.templates.toArray()
      expect(all.find((t) => t.name === 'Settlement')!.group).toBe('Realms')
    })

    // The datalist offers the groups currently in use.
    expect(document.querySelectorAll('#template-groups option').length).toBeGreaterThan(0)
  })

  it('clearing the field stores the deliberately-ungrouped sentinel', async () => {
    render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)

    const spellBtn = await screen.findByRole('button', { name: /Spell/ })
    fireEvent.click(spellBtn)
    fireEvent.change(await screen.findByLabelText('Group'), { target: { value: '' } })

    await waitFor(async () => {
      const all = await db.templates.toArray()
      expect(all.find((t) => t.name === 'Spell')!.group).toBe('')
    })
  })
})
