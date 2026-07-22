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
  isTauri: vi.fn(() => false),
  // LoreSelectorRoute (#174 recovery panel) reads these on mount; App renders
  // it at "/" in every test in this file, so they need a default no-op here
  // too, not just in LoreSelectorRoute.test.tsx's own mock.
  readRegistryMirror: vi.fn(async () => ({ status: 'absent' })),
  readWorldMirror: vi.fn(async () => null),
}))
vi.mock('./worldMirrorSync', () => ({
  flushWorldMirror: vi.fn(async () => {}),
  startMirrorLoop: vi.fn(() => () => {}),
  withMirroringSuspended: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))
vi.mock('./lores', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lores')>()),
  syncRegistryMirror: vi.fn(async () => {}),
}))
// I5: the ordering test needs backupOnExit itself to be a spy (to record when
// it ran relative to the mirror flush) while keeping shouldBackupOnExit and
// latestChangeTime's *other* callers real — this is the same module the
// 'shouldBackupOnExit' pure-function describe block below imports directly.
vi.mock('./backup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./backup')>()),
  backupOnExit: vi.fn(async () => true),
  latestChangeTime: vi.fn(async () => 0),
}))

import { onCloseRequested, isTauri } from './platform'
import { flushWorldMirror, startMirrorLoop } from './worldMirrorSync'
import { syncRegistryMirror } from './lores'
import { backupOnExit, latestChangeTime } from './backup'
import { updateAppSettings } from './appSettings'
import App from './App'

describe('App — close handler', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // isTauri is mocked with a default implementation (`() => false`), which
    // survives clearAllMocks (that only clears call history, not
    // mockReturnValue overrides) — but a test that calls mockReturnValue(true)
    // would otherwise leak into later tests, so pin the default here too.
    vi.mocked(isTauri).mockReturnValue(false)
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

  it('resolves even when the mirror flush hangs past the 5s close budget', async () => {
    // Finding 3: pin that flushWorldMirror() runs *inside* withTimeout's race,
    // not after it — a hung write must never leave the window unclosable.
    vi.mocked(flushWorldMirror).mockReturnValue(new Promise<void>(() => {})) // never resolves

    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')
    await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
    const handler = vi.mocked(onCloseRequested).mock.calls[0][0]

    vi.useFakeTimers()
    try {
      let resolved = false
      const done = handler().then(() => {
        resolved = true
      })
      await vi.advanceTimersByTimeAsync(5000)
      await done
      expect(resolved).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

// #174 I5: the mirror is the atomic, durable write; backupOnExit's is direct
// and truncatable by its own doc comment above. Two full exportAll()s share
// one 5s budget, so whichever runs second is the one a tight budget cuts —
// this pins that the mirror goes first, not backupOnExit.
describe('App — close handler order (#174 I5)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    await registry.appMeta.clear()
  })
  afterEach(() => cleanup())

  it('flushes the world mirror before writing the exit backup', async () => {
    const order: string[] = []
    vi.mocked(flushWorldMirror).mockImplementation(async () => {
      order.push('mirror')
    })
    vi.mocked(backupOnExit).mockImplementation(async () => {
      order.push('backup')
      return true
    })
    // shouldBackupOnExit(enabled, lastBackup, latestChange) must actually
    // decide to back up, or backupOnExit is never called and the ordering
    // assertion below would pass vacuously.
    await updateAppSettings({ backupOnExit: true })
    vi.mocked(latestChangeTime).mockResolvedValue(123) // > 0, no prior backup ⇒ due

    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')
    await waitFor(() => expect(onCloseRequested).toHaveBeenCalled())
    const handler = vi.mocked(onCloseRequested).mock.calls[0][0]

    await handler()

    expect(order).toEqual(['mirror', 'backup'])
  })
})

describe('App — mirror loop startup (#174)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })
  afterEach(() => cleanup())

  it('starts the mirror loop in the desktop shell', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')

    expect(startMirrorLoop).toHaveBeenCalled()
  })

  it('does not start the mirror loop in a plain browser', async () => {
    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')

    expect(startMirrorLoop).not.toHaveBeenCalled()
  })
})

describe('App — registry index reconciliation on startup (#174)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
  })
  afterEach(() => cleanup())

  it('refreshes worlds/registry.json in the desktop shell', async () => {
    vi.mocked(isTauri).mockReturnValue(true)

    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')

    await waitFor(() => expect(syncRegistryMirror).toHaveBeenCalled())
  })

  it('does not touch the registry index in a plain browser', async () => {
    render(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(App)))
    await screen.findByText('Lore Codex')

    expect(syncRegistryMirror).not.toHaveBeenCalled()
  })
})
