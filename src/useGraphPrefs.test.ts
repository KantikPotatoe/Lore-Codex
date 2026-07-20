import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { db, setMeta, getMeta } from './db'
import { useGraphPrefs, migrateView } from './useGraphPrefs'

afterEach(cleanup)

beforeEach(async () => {
  await db.meta.clear()
})

describe('migrateView', () => {
  const base = {
    hidden: [], hiddenStatuses: [], showArrows: false, showGhosts: true, threeD: false,
    panelOpen: false, tags: [], tagMode: 'any' as const, minDegree: 0, depth: 0,
    colorBy: 'type' as const, cam: null,
  }

  it('folds a legacy tag into tags and drops the field', () => {
    expect(migrateView({ ...base, tag: 'magic' })).toEqual({ ...base, tags: ['magic'] })
  })

  it('leaves a row with no legacy tag alone', () => {
    expect(migrateView(base)).toEqual(base)
  })

  it('ignores an empty legacy tag', () => {
    expect(migrateView({ ...base, tag: '' })).toEqual({ ...base, tag: '' })
  })

  it('prefers an existing tags selection over the legacy field', () => {
    const row = { ...base, tags: ['norse'], tag: 'magic' }
    expect(migrateView(row)).toEqual(row)
  })
})

describe('useGraphPrefs', () => {
  it('uses defaults when no meta row exists', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    // Wait past the hydration tick.
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current.showGhosts).toBe(true)
    expect(result.current.showArrows).toBe(false)
    expect(result.current.panelOpen).toBe(false)
    expect(result.current.tags).toEqual([])
    expect(result.current.tagMode).toBe('any')
    expect(result.current.cam).toBeNull()
    expect(result.current.minDegree).toBe(0)
    expect(result.current.depth).toBe(0)
    expect(result.current.colorBy).toBe('type')
    expect([...result.current.hidden]).toEqual([])
    expect([...result.current.hiddenStatuses]).toEqual([])
    expect(result.current.threeD).toBe(false)
    expect(result.current.pins).toEqual({})
  })

  it('persists the min-degree and depth sliders to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    // Hydration (even to "no row") is an async round-trip; a write attempted
    // before it resolves is now dropped by design, so retry the write inside
    // the poll until it lands rather than firing it once before hydration.
    await waitFor(() => {
      act(() => result.current.setMinDegree(2))
      expect(result.current.minDegree).toBe(2)
    })
    act(() => result.current.setDepth(3))
    await waitFor(() => expect(result.current.depth).toBe(3))
    const v = await getMeta<{ minDegree: number; depth: number }>('graph-view')
    expect(v?.minDegree).toBe(2)
    expect(v?.depth).toBe(3)
  })

  it('toggleStatus hides then reveals a status, persisting to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.toggleStatus('Stub'))
      expect([...result.current.hiddenStatuses]).toEqual(['Stub'])
    })
    const v = await getMeta<{ hiddenStatuses: string[] }>('graph-view')
    expect(v?.hiddenStatuses).toEqual(['Stub'])
    act(() => result.current.toggleStatus('Stub'))
    await waitFor(() => expect([...result.current.hiddenStatuses]).toEqual([]))
  })

  it('persists the 3D toggle to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.setThreeD(true))
      expect(result.current.threeD).toBe(true)
    })
    const v = await getMeta<{ threeD: boolean }>('graph-view')
    expect(v?.threeD).toBe(true)
  })

  it('backfills tag/cam defaults for older view rows missing them', async () => {
    // A row written before tag/cam existed must hydrate without throwing.
    await setMeta('graph-view', { hidden: [], showArrows: false, showGhosts: true, panelOpen: false })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current.tags).toEqual([])
    expect(result.current.cam).toBeNull()
  })

  it('persists a multi-tag selection and match mode to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.setTags(['magic', 'norse']))
      expect(result.current.tags).toEqual(['magic', 'norse'])
    })
    act(() => result.current.setTagMode('all'))
    await waitFor(() => expect(result.current.tagMode).toBe('all'))
    const v = await getMeta<{ tags: string[]; tagMode: string }>('graph-view')
    expect(v?.tags).toEqual(['magic', 'norse'])
    expect(v?.tagMode).toBe('all')
  })

  it('toggleTag adds then removes a tag', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.toggleTag('magic'))
      expect(result.current.tags).toEqual(['magic'])
    })
    act(() => result.current.toggleTag('norse'))
    await waitFor(() => expect(result.current.tags).toEqual(['magic', 'norse']))
    act(() => result.current.toggleTag('magic'))
    await waitFor(() => expect(result.current.tags).toEqual(['norse']))
  })

  it('migrates a legacy single-tag row into the multi-tag shape', async () => {
    await setMeta('graph-view', { hidden: [], showArrows: false, showGhosts: true, panelOpen: false, tag: 'magic' })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.tags).toEqual(['magic']))
    expect(result.current.tagMode).toBe('any')
  })

  it('drops the legacy tag field on the next write', async () => {
    await setMeta('graph-view', { hidden: [], showArrows: false, showGhosts: true, panelOpen: false, tag: 'magic' })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.tags).toEqual(['magic']))
    act(() => result.current.toggleTag('norse'))
    await waitFor(() => expect(result.current.tags).toEqual(['magic', 'norse']))
    const v = await getMeta<{ tag?: string }>('graph-view')
    expect(v?.tag).toBeUndefined()
  })

  it('persists the colour-by mode to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.setColorBy('status'))
      expect(result.current.colorBy).toBe('status')
    })
    const v = await getMeta<{ colorBy: string }>('graph-view')
    expect(v?.colorBy).toBe('status')
  })

  it('persists the camera transform to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.setCam({ k: 2, x: 100, y: -50 }))
      expect(result.current.cam).toEqual({ k: 2, x: 100, y: -50 })
    })
    const v = await getMeta<{ cam: { k: number } }>('graph-view')
    expect(v?.cam).toEqual({ k: 2, x: 100, y: -50 })
  })

  it('hydrates view + pins from existing meta rows', async () => {
    await setMeta('graph-view', { hidden: ['Character'], showArrows: true, showGhosts: false, panelOpen: true })
    await setMeta('graph-pins', { p1: { x: 10, y: 20 } })

    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.showArrows).toBe(true))
    expect([...result.current.hidden]).toEqual(['Character'])
    expect(result.current.showGhosts).toBe(false)
    expect(result.current.panelOpen).toBe(true)
    expect(result.current.pins).toEqual({ p1: { x: 10, y: 20 } })
  })

  it('does not clobber a stored row with defaults on first load', async () => {
    await setMeta('graph-view', { hidden: ['Item'], showArrows: false, showGhosts: false, panelOpen: false })
    const { unmount } = renderHook(() => useGraphPrefs())
    // Give effects time to run; the stored row must survive untouched.
    await waitFor(async () => {
      const v = await getMeta<{ showGhosts: boolean }>('graph-view')
      expect(v?.showGhosts).toBe(false)
    })
    unmount()
  })

  it('persists a toggle change to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.setShowArrows(true))
      expect(result.current.showArrows).toBe(true)
    })
    const v = await getMeta<{ showArrows: boolean }>('graph-view')
    expect(v?.showArrows).toBe(true)
  })

  it('pinNode adds a pin and clearPins empties them', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.pinNode('p1', 5, 6))
      expect(result.current.pins).toEqual({ p1: { x: 5, y: 6 } })
    })
    act(() => result.current.clearPins())
    await waitFor(() => expect(result.current.pins).toEqual({}))
  })

  it('does not let a write attempted before hydration clobber a stored row', async () => {
    await setMeta('graph-view', {
      hidden: ['Character'], hiddenStatuses: [], showArrows: true, showGhosts: true,
      threeD: false, panelOpen: false, tags: ['magic'], tagMode: 'all', minDegree: 0,
      depth: 0, colorBy: 'type', cam: null,
    })
    const { result } = renderHook(() => useGraphPrefs())
    // Fire immediately, without awaiting hydration — this is the initial
    // zoomToFit camera report racing the async useLiveQuery.
    act(() => result.current.setCam({ k: 3, x: 1, y: 2 }))
    await waitFor(() => expect(result.current.hidden.has('Character')).toBe(true))
    expect(result.current.showArrows).toBe(true)
    expect(result.current.tags).toEqual(['magic'])
    expect(result.current.tagMode).toBe('all')
    const v = await getMeta<{ hidden: string[]; showArrows: boolean; tags: string[]; tagMode: string; cam: unknown }>('graph-view')
    expect(v?.hidden).toEqual(['Character'])
    expect(v?.showArrows).toBe(true)
    expect(v?.tags).toEqual(['magic'])
    expect(v?.tagMode).toBe('all')
    expect(v?.cam).toBeNull()
  })

  it('still persists a camera write made after hydration', async () => {
    // Seed a marker that differs from any default, so waiting for it to
    // appear proves genuine hydration completed — not just that the hook
    // rendered — before the write below is attempted.
    await setMeta('graph-view', {
      hidden: ['Marker'], hiddenStatuses: [], showArrows: false, showGhosts: true,
      threeD: false, panelOpen: false, tags: [], tagMode: 'any', minDegree: 0,
      depth: 0, colorBy: 'type', cam: null,
    })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.hidden.has('Marker')).toBe(true))
    act(() => result.current.setCam({ k: 2, x: 100, y: -50 }))
    // Post-hydration, the write is immediate — no retry needed.
    expect(result.current.cam).toEqual({ k: 2, x: 100, y: -50 })
    const v = await getMeta<{ cam: { k: number } }>('graph-view')
    expect(v?.cam).toEqual({ k: 2, x: 100, y: -50 })
  })

  it('prunePins drops pins whose id is not in the valid set', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => {
      act(() => result.current.pinNode('keep', 1, 1))
      act(() => result.current.pinNode('drop', 2, 2))
      expect(Object.keys(result.current.pins)).toHaveLength(2)
    })
    act(() => result.current.prunePins(new Set(['keep'])))
    await waitFor(() => expect(result.current.pins).toEqual({ keep: { x: 1, y: 1 } }))
  })
})
