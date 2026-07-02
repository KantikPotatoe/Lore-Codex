import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { db, pageRepo } from './db'
import { useWikiLinkNavigation } from './useWikiLinkNavigation'

// useNavigate needs Router context; mock it so we can assert where the hook
// tried to navigate without mounting a whole router.
const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))
vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }))

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  navigateMock.mockClear()
})

describe('useWikiLinkNavigation', () => {
  it('follow opens an existing page without prompting', async () => {
    const id = await pageRepo.create({ title: 'Rohan' })
    const { result } = renderHook(() => useWikiLinkNavigation())

    await act(async () => { await result.current.follow('rohan') })

    expect(navigateMock).toHaveBeenCalledWith(`/page/${id}`)
    expect(result.current.pendingTitle).toBeNull()
  })

  it('follow stages a missing title for creation instead of navigating', async () => {
    const { result } = renderHook(() => useWikiLinkNavigation())

    await act(async () => { await result.current.follow('  Osgiliath  ') })

    expect(navigateMock).not.toHaveBeenCalled()
    await waitFor(() => expect(result.current.pendingTitle).toBe('Osgiliath'))
  })

  it('stageCreate stages a title directly (ghost-node path)', async () => {
    const { result } = renderHook(() => useWikiLinkNavigation())
    act(() => result.current.stageCreate('Minas Tirith'))
    await waitFor(() => expect(result.current.pendingTitle).toBe('Minas Tirith'))
  })

  it('confirmCreate creates a stub and navigates to it', async () => {
    const { result } = renderHook(() => useWikiLinkNavigation())
    act(() => result.current.stageCreate('Isengard'))
    await waitFor(() => expect(result.current.pendingTitle).toBe('Isengard'))

    await act(async () => { await result.current.confirmCreate() })

    const newId = await pageRepo.findIdByTitle('Isengard')
    expect(newId).not.toBeNull()
    expect(navigateMock).toHaveBeenCalledWith(`/page/${newId}`)
    expect(result.current.pendingTitle).toBeNull()
  })

  it('confirmCreate reuses a page created since staging (no duplicate)', async () => {
    const { result } = renderHook(() => useWikiLinkNavigation())
    act(() => result.current.stageCreate('Fangorn'))
    await waitFor(() => expect(result.current.pendingTitle).toBe('Fangorn'))

    // The page appears between staging and confirming.
    const existing = await pageRepo.create({ title: 'Fangorn' })
    await act(async () => { await result.current.confirmCreate() })

    expect((await pageRepo.list()).filter((p) => p.title === 'Fangorn')).toHaveLength(1)
    expect(navigateMock).toHaveBeenCalledWith(`/page/${existing}`)
  })

  it('cancelCreate clears the prompt without creating anything', async () => {
    const { result } = renderHook(() => useWikiLinkNavigation())
    act(() => result.current.stageCreate('Nowhere'))
    await waitFor(() => expect(result.current.pendingTitle).toBe('Nowhere'))

    act(() => result.current.cancelCreate())

    await waitFor(() => expect(result.current.pendingTitle).toBeNull())
    expect(await pageRepo.findIdByTitle('Nowhere')).toBeNull()
    expect(navigateMock).not.toHaveBeenCalled()
  })
})
