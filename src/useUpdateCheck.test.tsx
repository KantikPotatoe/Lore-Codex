import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { registry } from './registryDb'
import { updateAppSettings } from './appSettings'

vi.mock('./platform', () => ({ checkForUpdate: vi.fn() }))
import { checkForUpdate } from './platform'
import { useUpdateCheck } from './useUpdateCheck'

function fakeUpdate(over: Partial<{ download: unknown; install: unknown }> = {}) {
  return {
    version: '0.39.0',
    currentVersion: '0.38.0',
    notes: 'Notes',
    download: vi.fn(async (onProgress: (pct: number | null) => void) => { onProgress(100) }),
    install: vi.fn(async () => {}),
    ...over,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await registry.appMeta.clear()
})

// useLiveQuery-adjacent hooks leave subscriptions alive without this.
afterEach(() => cleanup())

describe('useUpdateCheck', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useUpdateCheck())
    expect(result.current.state.status).toBe('idle')
  })

  it('reports no update when the shell says there is none', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state.status).toBe('none')
  })

  it('surfaces an available update', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state).toEqual({ status: 'available', version: '0.39.0', notes: 'Notes' })
  })

  it('stamps lastUpdateCheckAt after a check', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await waitFor(async () => {
      const { lastUpdateCheckAt } = await (await import('./appSettings')).getAppSettings()
      expect(typeof lastUpdateCheckAt).toBe('number')
    })
  })

  it('skips an automatic check that the throttle rejects', async () => {
    await updateAppSettings({ lastUpdateCheckAt: Date.now() })
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(checkForUpdate).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('idle')
  })

  it('runs a manual check even when the throttle would reject it', async () => {
    await updateAppSettings({ lastUpdateCheckAt: Date.now() })
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(checkForUpdate).toHaveBeenCalledOnce()
  })

  it('skips an automatic check when the pref is off', async () => {
    await updateAppSettings({ autoUpdateCheck: false })
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(checkForUpdate).not.toHaveBeenCalled()
  })

  it('hides a dismissed version on an automatic check', async () => {
    await updateAppSettings({ dismissedUpdateVersion: '0.39.0' })
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(result.current.state.status).toBe('none')
  })

  it('shows a dismissed version anyway on a manual check', async () => {
    await updateAppSettings({ dismissedUpdateVersion: '0.39.0' })
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state.status).toBe('available')
  })

  it('swallows an automatic check failure', async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(result.current.state.status).toBe('idle')
  })

  it('surfaces a manual check failure', async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state).toEqual({ status: 'error', message: 'offline' })
  })

  it('moves through downloading to ready', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.download() })
    expect(result.current.state).toEqual({ status: 'ready', version: '0.39.0' })
  })

  it('surfaces a download failure', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(
      fakeUpdate({ download: vi.fn(async () => { throw new Error('disk full') }) }) as never,
    )
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.download() })
    expect(result.current.state).toEqual({ status: 'error', message: 'disk full' })
  })

  it('records the dismissed version', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.dismiss() })
    expect(result.current.state.status).toBe('none')
    const { getAppSettings } = await import('./appSettings')
    expect((await getAppSettings()).dismissedUpdateVersion).toBe('0.39.0')
  })
})
