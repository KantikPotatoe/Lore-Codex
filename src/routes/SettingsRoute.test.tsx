import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db } from '../db'
import SettingsRoute from './SettingsRoute'
import { openTextFile } from '../platform'

// The import flow goes through the platform seam (native Open dialog in the
// shell, transient file input in the browser) — mock the seam, not the DOM.
vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  writeAppData: vi.fn(async () => false),
  saveFile: vi.fn(async () => true),
  isTauri: () => false,
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
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    expect(await screen.findByText('Auto-snapshots')).toBeTruthy()
    expect(screen.getByText('Linking')).toBeTruthy()
    expect(screen.getByText('Backup & data')).toBeTruthy()
    expect(screen.getByText('Danger zone')).toBeTruthy()
    // snapshot retention input seeded from defaults (10)
    expect(await screen.findByLabelText(/keep newest/i)).toBeTruthy()
  })

  it('shows the autolink toggle checked by default', async () => {
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    const toggle = await screen.findByLabelText(/auto-link page titles/i)
    expect((toggle as HTMLInputElement).checked).toBe(true)
  })

  it('ignores a cleared (NaN) numeric input instead of persisting NaN', async () => {
    // Clearing a number input yields NaN from valueAsNumber; a NaN threshold breaks
    // snapshot logic (changed < NaN is always false), so it must be dropped.
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
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
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    // The destructive-replace confirmation appears, driven by parseBackup counts.
    expect(await screen.findByText('Replace your codex?')).toBeTruthy()
  })

  it('does nothing when the file picker is dismissed', async () => {
    vi.mocked(openTextFile).mockResolvedValue(null)
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    await waitFor(() => expect(openTextFile).toHaveBeenCalled())
    expect(screen.queryByText('Replace your codex?')).toBeNull()
  })

  it('shows an in-app notice (not a host alert) for an unreadable file', async () => {
    vi.mocked(openTextFile).mockResolvedValue({ name: 'junk.json', text: 'not json' })
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)
    fireEvent.click(await screen.findByText(/Restore from backup/))
    expect(await screen.findByText('Could not read backup')).toBeTruthy()
    expect(screen.queryByText('Replace your codex?')).toBeNull()
  })

  it('presents the browser backup advice as three scannable steps, not a prose block', async () => {
    render(<MemoryRouter><SettingsRoute /></MemoryRouter>)

    const steps = await screen.findByRole('list', { name: 'Backup steps' })
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3)

    // Each step leads with what you DO, so the list is scannable without reading it.
    expect(within(steps).getByText('Make a synced folder.')).toBeTruthy()
    expect(within(steps).getByText('Point Firefox at it.')).toBeTruthy()
    expect(within(steps).getByText('Click "Back up now" when warned.')).toBeTruthy()
  })
})
