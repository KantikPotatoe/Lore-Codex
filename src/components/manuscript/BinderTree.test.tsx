import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { db, createChapter, createScene } from '../../db'
import BinderTree from './BinderTree'

afterEach(async () => {
  cleanup()
  await Promise.all([db.chapters.clear(), db.scenes.clear()])
})

describe('BinderTree', () => {
  it('renders chapters and their scenes', async () => {
    const ch = await createChapter('b1', 'Chapter One')
    await createScene('b1', ch.id, 'The Opening')
    render(<BinderTree bookId="b1" selectedSceneId={null} onSelectScene={() => {}} />)
    expect(await screen.findByText('Chapter One')).toBeTruthy()
    expect(await screen.findByText('The Opening')).toBeTruthy()
  })

  it('selects a scene on click', async () => {
    const ch = await createChapter('b1', 'Chapter One')
    const sc = await createScene('b1', ch.id, 'The Opening')
    const onSelect = vi.fn()
    render(<BinderTree bookId="b1" selectedSceneId={null} onSelectScene={onSelect} />)
    fireEvent.click(await screen.findByText('The Opening'))
    expect(onSelect).toHaveBeenCalledWith(sc.id)
  })

  it('renames a chapter via double-click', async () => {
    const ch = await createChapter('b1', 'Chapter One')
    render(<BinderTree bookId="b1" selectedSceneId={null} onSelectScene={() => {}} />)
    fireEvent.doubleClick(await screen.findByText('Chapter One'))
    const input = await screen.findByLabelText('Chapter title') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'The Beginning' } })
    fireEvent.blur(input)
    await waitFor(async () => expect((await db.chapters.get(ch.id))?.title).toBe('The Beginning'))
  })

  it('adds a chapter via the button', async () => {
    render(<BinderTree bookId="b1" selectedSceneId={null} onSelectScene={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /chapter/i }))
    await waitFor(async () => expect(await db.chapters.where('bookId').equals('b1').count()).toBe(1))
  })
})
