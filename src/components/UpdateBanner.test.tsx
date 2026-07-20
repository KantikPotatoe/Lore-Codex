import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { CHECK_DELAY_MS } from '../updater'
import type { UpdateState } from '../useUpdateCheck'

const check = vi.fn(async () => {})
const download = vi.fn(async () => {})
const install = vi.fn(async () => {})
const dismiss = vi.fn(async () => {})
let state: UpdateState = { status: 'idle' }

vi.mock('../useUpdateCheck', () => ({
  useUpdateCheck: () => ({ state, check, download, install, dismiss }),
}))
vi.mock('../platform', () => ({ isTauri: vi.fn(() => true) }))

import { isTauri } from '../platform'
import UpdateBanner from './UpdateBanner'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isTauri).mockReturnValue(true)
  state = { status: 'idle' }
})
afterEach(() => cleanup())

describe('UpdateBanner', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing in a plain browser and never checks', () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('runs an automatic check on mount in the shell, after a delay', async () => {
    // Fake timers, because the banner deliberately waits CHECK_DELAY_MS before
    // checking so it never competes with loading a world — longer than
    // waitFor's default 1s patience.
    vi.useFakeTimers()
    try {
      render(<UpdateBanner />)
      expect(check).not.toHaveBeenCalled() // not immediately
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS) })
      expect(check).toHaveBeenCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending check if unmounted first', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(<UpdateBanner />)
      unmount()
      vi.advanceTimersByTime(CHECK_DELAY_MS)
      expect(check).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the update when one is available', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    expect(screen.getByText(/0\.39\.0 is available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /download/i })).toBeTruthy()
  })

  it('downloads when asked', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(download).toHaveBeenCalledOnce()
  })

  it('shows a determinate percentage while downloading', () => {
    state = { status: 'downloading', version: '0.39.0', pct: 42 }
    render(<UpdateBanner />)
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('shows indeterminate progress when there is no percentage', () => {
    state = { status: 'downloading', version: '0.39.0', pct: null }
    render(<UpdateBanner />)
    expect(screen.getByText(/Downloading…/)).toBeTruthy()
  })

  it('warns that restarting closes the app, and installs on click', () => {
    state = { status: 'ready', version: '0.39.0' }
    render(<UpdateBanner />)
    expect(screen.getByText(/close/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(install).toHaveBeenCalledOnce()
  })

  it('offers no dismiss once the update is downloaded', () => {
    // The hook refuses to dismiss from `ready` (it would strand the installer
    // and hide the version from automatic checks), so the banner must not
    // render a control that would do nothing.
    state = { status: 'ready', version: '0.39.0' }
    render(<UpdateBanner />)
    expect(screen.queryByTitle(/dismiss/i)).toBeNull()
  })

  it('dismisses on the close button', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    // The × carries title="Dismiss until the next version", which is its
    // accessible name — there is no visible label to match on.
    fireEvent.click(screen.getByTitle(/dismiss/i))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('stays silent on an error — Settings is where errors belong', () => {
    state = { status: 'error', message: 'offline' }
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })
})
