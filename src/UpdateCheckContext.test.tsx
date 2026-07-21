import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, act, waitFor } from '@testing-library/react'
import { registry } from './registryDb'

vi.mock('./platform', () => ({ checkForUpdate: vi.fn(), isTauri: vi.fn(() => true) }))
import { checkForUpdate } from './platform'
import { UpdateCheckProvider, useSharedUpdateCheck } from './UpdateCheckContext'

function Consumer({ label }: { label: string }) {
  const { state, check } = useSharedUpdateCheck()
  return (
    <div>
      <span data-testid={label}>{state.status}</span>
      <button onClick={() => void check(true)}>check-{label}</button>
    </div>
  )
}

beforeEach(async () => {
  vi.clearAllMocks()
  await registry.appMeta.clear()
})
afterEach(() => cleanup())

describe('UpdateCheckProvider', () => {
  it('gives every consumer the same state machine', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', notes: '',
      download: vi.fn(), install: vi.fn(),
    } as never)

    render(
      <UpdateCheckProvider>
        <Consumer label="banner" />
        <Consumer label="settings" />
      </UpdateCheckProvider>,
    )

    expect(screen.getByTestId('banner').textContent).toBe('idle')
    expect(screen.getByTestId('settings').textContent).toBe('idle')

    // One consumer checks; BOTH must observe the result. Two instances would
    // leave the other stuck on 'idle' — the split that stranded downloads.
    await act(async () => { screen.getByText('check-settings').click() })

    // `check` awaits an async settings read, so the resolution lands a tick
    // after the click; waitFor is the settle, not the assertion. The `banner`
    // line below is the load-bearing one — with two instances it reads 'idle'.
    await waitFor(() => expect(screen.getByTestId('settings').textContent).toBe('available'))
    expect(screen.getByTestId('banner').textContent).toBe('available')
    expect(checkForUpdate).toHaveBeenCalledOnce()
  })

  it('throws when used outside the provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Consumer label="orphan" />)).toThrow(/UpdateCheckProvider/)
    } finally {
      quiet.mockRestore()
    }
  })
})
