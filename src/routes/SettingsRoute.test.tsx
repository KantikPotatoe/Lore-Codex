import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db } from '../db'
import SettingsRoute from './SettingsRoute'
// Mirrors App.tsx: the route is always mounted inside the shared update provider.
import { UpdateCheckProvider } from '../UpdateCheckContext'
import { openTextFile } from '../platform'
import { registry } from '../registryDb'
import { getAppSettings } from '../appSettings'
import { withMirroringSuspended } from '../worldMirrorSync'

// The import flow goes through the platform seam (native Open dialog in the
// shell, transient file input in the browser) — mock the seam, not the DOM.
vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  writeAppData: vi.fn(async () => false),
  saveFile: vi.fn(async () => true),
  pickDirectory: vi.fn(async () => null),
  appVersion: vi.fn(async () => null),
  checkForUpdate: vi.fn(async () => null), // reached via useUpdateCheck in the Updates section
  isTauri: () => false, // the suite runs as the browser build
  // Gated behind isTauri() in SettingsRoute (#174 task r3, item 3) — never
  // actually called in this browser-mode suite, but the named import must
  // resolve to something.
  readRegistryMirror: vi.fn(async () => ({ status: 'absent' })),
}))

// Both restore branches of confirmImport must run inside the mirror
// suspension guard (#174) — spy on it (pass-through) rather than mocking it
// away, so the wrapped call still actually executes against the real db.
vi.mock('../worldMirrorSync', () => ({
  withMirroringSuspended: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  // Desktop-only in the UI (this suite runs isTauri: () => false throughout),
  // so these are never actually called here — see
  // SettingsRoute.mirrorHealth.test.tsx for the desktop-mode readout itself.
  getMirrorHealth: vi.fn(() => ({ lastSuccessAt: null, lastError: null })),
  mirrorFilePath: vi.fn(() => 'worlds/default.lore'),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SettingsRoute', () => {
  beforeEach(async () => {
    await db.meta.clear()
    await db.snapshots.clear()
  })

  it('renders the sections and the snapshot policy control', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    expect(await screen.findByText('Auto-snapshots')).toBeTruthy()
    // Settings rework (#173): the old "Linking" section was absorbed into "Editor".
    expect(screen.getByText('Editor')).toBeTruthy()
    expect(screen.getByText('Backup & data')).toBeTruthy()
    expect(screen.getByText('Danger zone')).toBeTruthy()
    // snapshot retention input seeded from defaults (10)
    expect(await screen.findByLabelText(/keep newest/i)).toBeTruthy()
  })

  it('shows the autolink toggle checked by default', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    const toggle = await screen.findByLabelText(/auto-link page titles/i)
    expect((toggle as HTMLInputElement).checked).toBe(true)
  })

  it('ignores a cleared (NaN) numeric input instead of persisting NaN', async () => {
    // Clearing a number input yields NaN from valueAsNumber; a NaN threshold breaks
    // snapshot logic (changed < NaN is always false), so it must be dropped.
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    const input = (await screen.findByLabelText(/Snapshot after this many changes/)) as HTMLInputElement
    fireEvent.change(input, { target: { value: '7' } })
    expect(input.value).toBe('7')
    fireEvent.change(input, { target: { value: '' } })
    // The NaN write is dropped, so the field keeps its last valid value.
    expect(input.value).toBe('7')
  })

  it('restore goes through the platform seam and shows the counts confirmation', async () => {
    vi.mocked(openTextFile).mockResolvedValue({
      name: 'lore-backup.json',
      text: JSON.stringify({ pages: [] }),
    })
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    // The destructive-replace confirmation appears, driven by parseBackup counts.
    expect(await screen.findByText('Replace your codex?')).toBeTruthy()
  })

  it('does nothing when the file picker is dismissed', async () => {
    vi.mocked(openTextFile).mockResolvedValue(null)
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    await waitFor(() => expect(openTextFile).toHaveBeenCalled())
    expect(screen.queryByText('Replace your codex?')).toBeNull()
  })

  it('shows an in-app notice (not a host alert) for an unreadable file', async () => {
    vi.mocked(openTextFile).mockResolvedValue({ name: 'junk.json', text: 'not json' })
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    expect(await screen.findByText('Could not read backup')).toBeTruthy()
    expect(screen.queryByText('Replace your codex?')).toBeNull()
  })

  it('presents the browser backup advice as three scannable steps, not a prose block', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)

    const steps = await screen.findByRole('list', { name: 'Backup steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)

    // Each step leads with what you DO, so the list is scannable without reading it.
    expect(within(steps).getByText('Make a synced folder.')).toBeTruthy()
    expect(within(steps).getByText('Point Firefox at it.')).toBeTruthy()
    expect(within(steps).getByText('Click "Back up now" when warned.')).toBeTruthy()
  })
})

describe('SettingsRoute app-level options', () => {
  beforeEach(async () => { await registry.appMeta.clear() })

  it('toggles "open the last world on launch"', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    const box = await screen.findByLabelText(/open the last world/i)
    expect((box as HTMLInputElement).checked).toBe(false) // today's behaviour
    fireEvent.click(box)
    await waitFor(async () => {
      expect((await getAppSettings()).openLastWorld).toBe(true)
    })
  })

  it('picks a spellcheck language', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    const select = await screen.findByLabelText(/spellcheck language/i)
    fireEvent.change(select, { target: { value: 'fr' } })
    await waitFor(async () => {
      expect((await getAppSettings()).spellcheckLang).toBe('fr')
    })
  })

  it('disables the desktop-only options in the browser', async () => {
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    const exit = await screen.findByLabelText(/back up when I close/i)
    expect((exit as HTMLInputElement).disabled).toBe(true)
    expect(screen.getAllByText(/desktop app only/i).length).toBeGreaterThan(0)
  })
})

// Both branches of confirmImport clear-and-repopulate the active DB, the
// hazard withMirroringSuspended exists to guard (#174) — a mirror write
// landing mid-restore would export a half-empty world and rename it over a
// good mirror. The two branches must be treated symmetrically.
describe('SettingsRoute — mirror suspension across a restore (#174)', () => {
  beforeEach(async () => {
    await db.meta.clear()
    await db.snapshots.clear()
  })

  it('suspends mirroring across a backup import', async () => {
    vi.mocked(openTextFile).mockResolvedValue({
      name: 'lore-backup.json',
      text: JSON.stringify({ pages: [] }),
    })
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    fireEvent.click(await screen.findByText('Replace everything'))
    await waitFor(() => expect(withMirroringSuspended).toHaveBeenCalled())
  })

  it('suspends mirroring across a snapshot restore too', async () => {
    await db.snapshots.add({ timestamp: Date.now(), editCount: 3, data: JSON.stringify({ pages: [] }) })
    render(<MemoryRouter><UpdateCheckProvider><SettingsRoute /></UpdateCheckProvider></MemoryRouter>)
    fireEvent.click(await screen.findByText('Restore'))
    fireEvent.click(await screen.findByText('Restore text'))
    await waitFor(() => expect(withMirroringSuspended).toHaveBeenCalled())
  })
})
