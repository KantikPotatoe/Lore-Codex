import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db } from '../db'
import PagePicker from './PagePicker'

afterEach(async () => {
  cleanup()
  await db.pages.clear()
})

async function seedPage(id: string, title: string, category = 'Character') {
  await db.pages.add({
    id, title, category, content: '', summary: '', tags: [],
    createdAt: 1, updatedAt: 1,
  } as never)
}

describe('PagePicker', () => {
  it('adds a page id when a suggestion is chosen', async () => {
    await seedPage('p1', 'Alice')
    const onChange = vi.fn()
    render(<PagePicker value={[]} onChange={onChange} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ali' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Alice' }))
    expect(onChange).toHaveBeenCalledWith(['p1'])
  })

  it('renders selected ids as titled chips', async () => {
    await seedPage('p1', 'Alice')
    render(<PagePicker value={['p1']} onChange={() => {}} />)
    expect(await screen.findByText('Alice')).toBeTruthy()
  })

  it('single-select replaces the previous value', async () => {
    await seedPage('p1', 'Alice')
    await seedPage('p2', 'Bob')
    const onChange = vi.fn()
    render(<PagePicker value={['p1']} onChange={onChange} multiple={false} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Bob' } })
    await waitFor(() => screen.getByRole('button', { name: 'Bob' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bob' }))
    expect(onChange).toHaveBeenCalledWith(['p2'])
  })

  it('excludeIds keeps a page out of the suggestion list entirely', async () => {
    await seedPage('p1', 'Alice')
    await seedPage('p2', 'Alicia')
    render(<PagePicker value={[]} onChange={() => {}} excludeIds={['p1']} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ali' } })
    expect(await screen.findByRole('button', { name: 'Alicia' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Alice' })).toBeNull()
  })
})
