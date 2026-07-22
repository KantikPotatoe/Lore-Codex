import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db } from '../db'
import SettingsRoute from './SettingsRoute'
import { UpdateCheckProvider } from '../UpdateCheckContext'

// #174 I4: the "World file" status line only renders anything meaningful in
// the desktop shell — SettingsRoute.test.tsx runs entirely with isTauri
// forced false, so the healthy/never/failed readouts need their own suite
// with isTauri forced true.
vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  writeAppData: vi.fn(async () => false),
  saveFile: vi.fn(async () => true),
  pickDirectory: vi.fn(async () => null),
  appVersion: vi.fn(async () => '1.2.3'),
  checkForUpdate: vi.fn(async () => null),
  isTauri: vi.fn(() => true),
}))

vi.mock('../worldMirrorSync', () => ({
  withMirroringSuspended: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  getMirrorHealth: vi.fn(),
  mirrorFilePath: vi.fn(() => 'worlds/default.lore'),
}))

import { getMirrorHealth } from '../worldMirrorSync'

function renderSettings() {
  return render(
    <MemoryRouter>
      <UpdateCheckProvider>
        <SettingsRoute />
      </UpdateCheckProvider>
    </MemoryRouter>,
  )
}

describe('SettingsRoute — world mirror health (#174 I4)', () => {
  beforeEach(async () => {
    await db.meta.clear()
    await db.snapshots.clear()
    vi.clearAllMocks()
  })
  afterEach(() => cleanup())

  it('shows "never" on a fresh launch without wording it as a failure', async () => {
    vi.mocked(getMirrorHealth).mockReturnValue({ lastSuccessAt: null, lastError: null })

    renderSettings()

    expect(await screen.findByText('worlds/default.lore')).toBeTruthy()
    // "never" reads as the expected, not-yet-happened state, not a problem —
    // there must be no "failed"/error line accompanying it.
    expect(screen.getByText(/last written: never/i)).toBeTruthy()
    expect(screen.queryByText(/failed/i)).toBeNull()
    expect(document.querySelector('.settings-hint-danger')).toBeNull()
  })

  it('shows the last-written time when the mirror is healthy', async () => {
    vi.mocked(getMirrorHealth).mockReturnValue({
      lastSuccessAt: Date.now() - 5_000,
      lastError: null,
    })

    renderSettings()

    expect(await screen.findByText(/just now/i)).toBeTruthy()
    expect(screen.queryByText(/failed/i)).toBeNull()
    expect(document.querySelector('.settings-hint-danger')).toBeNull()
  })

  it('surfaces the last error as a problem, styled with --danger, not buried in muted text', async () => {
    vi.mocked(getMirrorHealth).mockReturnValue({
      lastSuccessAt: Date.now() - 10 * 60_000,
      lastError: { message: 'permission denied', at: Date.now() - 30_000 },
    })

    renderSettings()

    const errorLine = await screen.findByText(/permission denied/i)
    expect(errorLine.className).toContain('settings-hint-danger')
    // The healthy last-written line is still shown alongside the error —
    // the error doesn't replace the "where/when" information.
    expect(screen.getByText('worlds/default.lore')).toBeTruthy()
  })
})
