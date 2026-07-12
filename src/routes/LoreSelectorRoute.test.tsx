import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import LoreSelectorRoute from './LoreSelectorRoute'
import { openTextFile } from '../platform'
import { importLoreFromBackup, switchLore, listLores, type Lore } from '../lores'

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
  // clearAllMocks() clears calls but NOT implementations, so a mockResolvedValue
  // set by one test would leak into the next. Put the world list back to empty.
  vi.mocked(listLores).mockResolvedValue([])
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

function world(over: Partial<Lore> = {}): Lore {
  const created = Date.UTC(2026, 2, 3)
  return { id: 'w1', name: 'The Westerlands', banner: null, createdAt: created, updatedAt: created, ...over }
}

describe('LoreSelectorRoute — gateway cards', () => {
  it('names each corner control after its world', async () => {
    // The controls are icon-only (✎ 🖼 ✕), so aria-label is their ONLY accessible
    // name — and it must identify the world, because N cards render at once.
    vi.mocked(listLores).mockResolvedValue([world()])
    render(<LoreSelectorRoute />)

    expect(await screen.findByRole('button', { name: /^rename the westerlands$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^change banner for the westerlands$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^delete the westerlands$/i })).toBeTruthy()
  })

  it('engraves the founding date on the mat', async () => {
    vi.mocked(listLores).mockResolvedValue([world()])
    render(<LoreSelectorRoute />)
    expect(await screen.findByText(/^Founded /)).toBeTruthy()
  })

  // DELIBERATE GREEN-FOREVER GUARD — read this before "fixing" it.
  // This test passes against the OLD code too, and that is the point: it pins a
  // property that must NOT change. The mat uppercases via CSS text-transform,
  // which is presentational, so the accessible name stays what the user typed.
  // It goes red only if someone later "helpfully" uppercases in the TSX with
  // .toUpperCase(), which would corrupt the name for screen readers.
  // It is a regression guard, not a discriminating test for this task — the two
  // tests above are the ones that must go RED before Step 3.
  it('keeps the world name button exposing the true mixed-case name', async () => {
    vi.mocked(listLores).mockResolvedValue([world({ name: 'The Westerlands' })])
    render(<LoreSelectorRoute />)
    expect(await screen.findByRole('button', { name: 'The Westerlands' })).toBeTruthy()
  })

  it('shows the add-tile beside existing worlds, and the empty state when there are none', async () => {
    vi.mocked(listLores).mockResolvedValue([world()])
    const { unmount } = render(<LoreSelectorRoute />)

    // Two "New World" buttons with a world present: the hero's, and the add-tile.
    await waitFor(() => expect(screen.getAllByRole('button', { name: /new world/i })).toHaveLength(2))
    expect(screen.queryByText(/no worlds yet/i)).toBeNull()
    unmount()

    // With none, the add-tile is gone (only the hero's button) and the empty state
    // carries the CTA, so the affordance is never absent.
    vi.mocked(listLores).mockResolvedValue([])
    render(<LoreSelectorRoute />)

    expect(await screen.findByText(/no worlds yet — your stories await/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /create your first world/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /new world/i })).toHaveLength(1)
  })
})
