import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { db, pageRepo, type InfoboxTemplate } from './db'
import { usePage } from './usePage'

// usePage lifts PageRoute's record + mutations out of the component. These tests
// render the hook against the in-memory DB and pin the mutation semantics the
// route relied on: the tag add-guard, category re-seeding, and rename/remove.

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  await db.templates.clear()
})

async function seedPage(): Promise<string> {
  return pageRepo.create({ title: 'Gondor', category: 'Country', tags: ['realm'] })
}

describe('usePage', () => {
  it('loads the page reactively; a missing id stays undefined', async () => {
    const missing = renderHook(() => usePage('nope'))
    // pageRepo.get resolves to undefined for an absent id (same as loading).
    await waitFor(() => expect(missing.result.current.templates).toEqual([]))
    expect(missing.result.current.page).toBeUndefined()

    const id = await seedPage()
    const { result } = renderHook(() => usePage(id))
    await waitFor(() => expect(result.current.page?.title).toBe('Gondor'))
  })

  it('addTag ignores blanks and duplicates, else appends', async () => {
    const id = await seedPage()
    const { result } = renderHook(() => usePage(id))
    await waitFor(() => expect(result.current.page?.title).toBe('Gondor'))

    await act(async () => { await result.current.addTag('  ') })
    await act(async () => { await result.current.addTag('realm') }) // dup
    expect((await pageRepo.get(id))?.tags).toEqual(['realm'])

    await act(async () => { await result.current.addTag('kingdom') })
    await waitFor(async () => expect((await pageRepo.get(id))?.tags).toEqual(['realm', 'kingdom']))
  })

  it('removeTag drops the tag', async () => {
    const id = await seedPage()
    const { result } = renderHook(() => usePage(id))
    await waitFor(() => expect(result.current.page?.title).toBe('Gondor'))

    await act(async () => { await result.current.removeTag('realm') })
    await waitFor(async () => expect((await pageRepo.get(id))?.tags).toEqual([]))
  })

  it('changeCategory sets the type and re-seeds the infobox from its template', async () => {
    const id = await seedPage()
    const tpl: InfoboxTemplate = {
      id: 't1',
      name: 'City',
      color: '#123456',
      items: [{ label: 'Population', fieldType: 'number' }],
      builtin: false,
    }
    await db.templates.add(tpl)

    const { result } = renderHook(() => usePage(id))
    await waitFor(() => expect(result.current.templates.map((t) => t.name)).toEqual(['City']))

    await act(async () => { await result.current.changeCategory('City') })
    const updated = await pageRepo.get(id)
    expect(updated?.category).toBe('City')
    expect(updated?.infobox?.fields.some((f) => f.label === 'Population')).toBe(true)
  })

  it('update patches fields; rename retitles; remove deletes', async () => {
    const id = await seedPage()
    const { result } = renderHook(() => usePage(id))
    await waitFor(() => expect(result.current.page?.title).toBe('Gondor'))

    await act(async () => { await result.current.update({ summary: 'A kingdom' }) })
    await waitFor(async () => expect((await pageRepo.get(id))?.summary).toBe('A kingdom'))

    await act(async () => { await result.current.rename('Reunited Kingdom') })
    await waitFor(async () => expect((await pageRepo.get(id))?.title).toBe('Reunited Kingdom'))

    await act(async () => { await result.current.remove() })
    await waitFor(async () => expect(await pageRepo.get(id)).toBeUndefined())
  })
})
