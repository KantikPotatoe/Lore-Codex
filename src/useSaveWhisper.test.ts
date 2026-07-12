import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useSaveWhisper } from './useSaveWhisper'

afterEach(cleanup)

describe('useSaveWhisper', () => {
  it('stays quiet when a page first loads', () => {
    // The first `updatedAt` we ever see is the page arriving, not a save.
    const { result } = renderHook(() => useSaveWhisper('p1', 1000, true))
    expect(result.current).toBeNull()
  })

  it('stays quiet while the page is still loading', () => {
    const { result } = renderHook(() => useSaveWhisper('p1', undefined, true))
    expect(result.current).toBeNull()
  })

  it('whispers when a write advances updatedAt while editing', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    expect(result.current).toBeNull()

    rerender({ at: 2000 })
    expect(result.current).toBe(2000)
  })

  it('reports each successive save, so the marker can re-key', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    expect(result.current).toBe(2000)

    rerender({ at: 3000 })
    expect(result.current).toBe(3000)
  })

  it('holds its value across a re-render with no new write', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    rerender({ at: 2000 })
    expect(result.current).toBe(2000)
  })

  it('says nothing in view mode, even when a write lands', () => {
    // A cross-tab write must not whisper at someone who is only reading.
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, false),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    expect(result.current).toBeNull()
  })

  it('does not whisper on arrival at a different page', () => {
    // Switching pages must not read as "your edit was saved".
    const { result, rerender } = renderHook(
      ({ id, at }) => useSaveWhisper(id, at, true),
      { initialProps: { id: 'p1', at: 1000 as number | undefined } },
    )
    rerender({ id: 'p1', at: 2000 })
    expect(result.current).toBe(2000)

    rerender({ id: 'p2', at: 5000 })
    expect(result.current).toBeNull()
  })

  it('whispers again after a write on the newly-opened page', () => {
    const { result, rerender } = renderHook(
      ({ id, at }) => useSaveWhisper(id, at, true),
      { initialProps: { id: 'p1', at: 1000 as number | undefined } },
    )
    rerender({ id: 'p2', at: 5000 })
    expect(result.current).toBeNull()

    rerender({ id: 'p2', at: 6000 })
    expect(result.current).toBe(6000)
  })

  it('does not whisper about a background write when entering edit mode with no further write', () => {
    // A write lands while the user is only reading. Later they click Edit,
    // with no new write since — the reading-period write must not whisper.
    const { result, rerender } = renderHook(
      ({ at, editing }) => useSaveWhisper('p1', at, editing),
      { initialProps: { at: 1000 as number | undefined, editing: false } },
    )
    expect(result.current).toBeNull() // first load

    rerender({ at: 2000, editing: false }) // background write, still reading
    expect(result.current).toBeNull()

    rerender({ at: 2000, editing: true }) // enters edit mode, no further write
    expect(result.current).toBeNull()
  })

  it('does not re-whisper an old save when re-entering edit mode with no further write', () => {
    const { result, rerender } = renderHook(
      ({ at, editing }) => useSaveWhisper('p1', at, editing),
      { initialProps: { at: 1000 as number | undefined, editing: true } },
    )
    expect(result.current).toBeNull() // first load, already editing

    rerender({ at: 2000, editing: true }) // write while editing
    expect(result.current).toBe(2000)

    rerender({ at: 2000, editing: false }) // leaves edit mode
    expect(result.current).toBeNull()

    rerender({ at: 2000, editing: true }) // re-enters, no further write
    expect(result.current).toBeNull()
  })

  it('still whispers a write that lands after entering edit mode', () => {
    // Proves the fix doesn't just disable the feature: a genuinely new write
    // made after the edit-mode baseline is established must still whisper.
    const { result, rerender } = renderHook(
      ({ at, editing }) => useSaveWhisper('p1', at, editing),
      { initialProps: { at: 1000 as number | undefined, editing: false } },
    )
    rerender({ at: 1000, editing: true }) // enters edit mode, no write yet
    expect(result.current).toBeNull()

    rerender({ at: 2000, editing: true }) // a real write while editing
    expect(result.current).toBe(2000)
  })
})
