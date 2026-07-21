import { createElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { shouldBackupOnExit } from './backup'
import { registry } from './registryDb'

describe('shouldBackupOnExit', () => {
  it('does nothing when the setting is off', () => {
    expect(shouldBackupOnExit(false, null, 500)).toBe(false)
  })

  it('backs up when enabled and there are unbacked changes', () => {
    expect(shouldBackupOnExit(true, 100, 500)).toBe(true)
  })

  it('skips the write when everything is already backed up', () => {
    // Closing the app ten times in a row must not litter ten identical files.
    expect(shouldBackupOnExit(true, 500, 100)).toBe(false)
  })

  it('skips an empty world', () => {
    expect(shouldBackupOnExit(true, null, 0)).toBe(false)
  })
})

// The close-handler wiring lives in App.tsx's onCloseRequested effect, which
// isn't exercised by any pure-function test above. There is no pre-existing
// render harness for it anywhere in the repo (checked: no App*.test.* file),
// so this builds a minimal one — render the real App at "/" (the lightest
// route: no Sidebar/UpdateCheckProvider/lazy routes), capture the handler
// onCloseRequested was called with, and invoke it directly rather than going
// through the real Tauri close event.
vi.mock('./platform', () => ({
  onCloseRequested: vi.fn(async () => () => {}),
  openTextFile: vi.fn(),
  isTauri: () => false,
}))
vi.mock('./worldMirrorSync', () => ({
  flushWorldMirror: vi.fn(async () => {}),
  startMirrorLoop: vi.fn(() => () => {}),
  withMirroringSuspended: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

import { onCloseRequested } from './platform'
import { flushWorldMirror } from './worldMirrorSync'
import App from './App'

describe('App — close handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Default AppSettings has backupOnExit: false — clearing appMeta keeps
    // shouldBackupOnExit's `enabled` false, so this test never exercises the
    // real backupOnExit()/writeAppData path, only the mirror flush.
    await registry.appMeta.clear()
  })
  afterEach(() => cleanup())

  it('flushes the world mirror as the window closes', async () => {
    // No JSX here on purpose — this file is .ts, not .tsx (kept matching the
    // brief's target filename), so the tree is built with createElement.
    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    // LoreSelectorRoute renders at "/"; its presence confirms App mounted
    // past the initial suspense/loading state before we grab the handler.
    await screen.findByText('Lore Codex')

    await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
    const handler = vi.mocked(onCloseRequested).mock.calls[0][0]

    await handler()

    expect(flushWorldMirror).toHaveBeenCalled()
  })
})
