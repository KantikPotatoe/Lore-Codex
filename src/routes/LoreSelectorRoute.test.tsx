import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import LoreSelectorRoute from './LoreSelectorRoute'
import { openTextFile } from '../platform'
import { importLoreFromBackup, switchLore } from '../lores'

// The wizard is the first-run migration path from the browser version (desktop
// transition Phase 1): pick a backup file → confirm name + counts → a new
// world is created and switched to. The world-creation internals are covered
// by lores.test.ts; here we pin the component flow, so both seams are mocked.

vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  isTauri: () => false,
}))

vi.mock('../lores', () => ({
  listLores: vi.fn(async () => []),
  currentLoreId: () => 'default',
  switchLore: vi.fn(),
  createLore: vi.fn(),
  renameLore: vi.fn(),
  deleteLore: vi.fn(),
  setLoreBanner: vi.fn(),
  importLoreFromBackup: vi.fn(async () => 'new-world-id'),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const backupJson = JSON.stringify({ pages: [{ id: 'p1' }] })

describe('LoreSelectorRoute — import-world wizard', () => {
  it('imports a picked backup as a new world and switches to it', async () => {
    vi.mocked(openTextFile).mockResolvedValue({ name: 'middle-earth.json', text: backupJson })
    render(<LoreSelectorRoute />)

    fireEvent.click(await screen.findByRole('button', { name: /Import World/ }))

    // Confirmation shows the file-derived default name, editable.
    const nameInput = (await screen.findByLabelText(/World name/i)) as HTMLInputElement
    expect(nameInput.value).toBe('middle-earth')
    fireEvent.change(nameInput, { target: { value: 'Middle-earth' } })

    fireEvent.click(screen.getByText('Import world'))

    await waitFor(() => expect(importLoreFromBackup).toHaveBeenCalledWith('Middle-earth', backupJson))
    expect(switchLore).toHaveBeenCalledWith('new-world-id')
  })

  it('falls back to a generic name for timestamped backup filenames', async () => {
    vi.mocked(openTextFile).mockResolvedValue({
      name: 'lore-backup-2026-07-03_18-30.json',
      text: backupJson,
    })
    render(<LoreSelectorRoute />)
    fireEvent.click(await screen.findByRole('button', { name: /Import World/ }))
    const nameInput = (await screen.findByLabelText(/World name/i)) as HTMLInputElement
    expect(nameInput.value).toBe('Imported World')
  })

  it('shows an in-app notice for an invalid file and creates nothing', async () => {
    vi.mocked(openTextFile).mockResolvedValue({ name: 'junk.json', text: 'not json' })
    render(<LoreSelectorRoute />)
    fireEvent.click(await screen.findByRole('button', { name: /Import World/ }))

    expect(await screen.findByText(/Could not import/)).toBeTruthy()
    expect(importLoreFromBackup).not.toHaveBeenCalled()
  })

  it('does nothing when the picker is dismissed', async () => {
    vi.mocked(openTextFile).mockResolvedValue(null)
    render(<LoreSelectorRoute />)
    fireEvent.click(await screen.findByRole('button', { name: /Import World/ }))
    await waitFor(() => expect(openTextFile).toHaveBeenCalled())
    expect(screen.queryByLabelText(/World name/i)).toBeNull()
  })
})
