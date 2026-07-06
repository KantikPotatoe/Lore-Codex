import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushableDebounce } from './debounce'

describe('flushableDebounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('does not run until the delay elapses, then runs once with the latest args', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    d.call('a')
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(499)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('a')
  })

  it('coalesces rapid calls into a single trailing run with the last args', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    d.call('a')
    vi.advanceTimersByTime(200)
    d.call('b')
    vi.advanceTimersByTime(200)
    d.call('c')
    vi.advanceTimersByTime(500)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('flush runs the pending call immediately with the latest args and clears the timer', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    d.call('x')
    d.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('x')

    // No second run when the original timer would have fired.
    vi.advanceTimersByTime(500)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('flush with nothing pending is a no-op', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    d.flush()
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel drops the pending call', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    d.call('a')
    d.cancel()
    vi.advanceTimersByTime(500)
    expect(fn).not.toHaveBeenCalled()
  })

  it('pending() reports whether a call is scheduled', () => {
    const fn = vi.fn()
    const d = flushableDebounce(fn, 500)

    expect(d.pending()).toBe(false)
    d.call('a')
    expect(d.pending()).toBe(true)
    d.flush()
    expect(d.pending()).toBe(false)
  })
})
