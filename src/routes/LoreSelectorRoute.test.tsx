import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import LoreSelectorRoute from './LoreSelectorRoute'
import { openTextFile, readRegistryMirror, readWorldMirror } from '../platform'
import { importLoreFromBackup, switchLore, listLores, type Lore } from '../lores'
import { withMirroringSuspended } from '../worldMirrorSync'
import { CURRENT_LORE_KEY } from '../loreId'

// The wizard is the first-run migration path from the browser version (desktop
// transition Phase 1): pick a backup file → confirm name + counts → a new
// world is created and switched to. The world-creation internals are covered
// by lores.test.ts; here we pin the component flow, so both seams are mocked.

vi.mock('../platform', () => ({
  openTextFile: vi.fn(),
  isTauri: () => false,
  readRegistryMirror: vi.fn(async () => ({ status: 'absent' })),
  readWorldMirror: vi.fn(async () => null),
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

// #174 task 3, I-B: restoreWorld must suspend mirroring for the duration of
// its import (id reuse means it can target the active db). Calls its `fn`
// through by default, like every other consumer of this seam mocks it.
vi.mock('../worldMirrorSync', () => ({
  withMirroringSuspended: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}))

vi.mock('../appSettings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../appSettings')>()),
  getAppSettings: vi.fn(async () => ({
    openLastWorld: false, // the picker's own suite must always see the picker
    spellcheck: true,
    spellcheckLang: '',
    backupOnExit: false,
    defaultBackupDir: null,
    autoUpdateCheck: true,
    lastUpdateCheckAt: null,
    dismissedUpdateVersion: null,
  })),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // clearAllMocks() clears calls but NOT implementations, so a mockResolvedValue
  // set by one test would leak into the next. Put the world list back to empty.
  vi.mocked(listLores).mockResolvedValue([])
  vi.mocked(readRegistryMirror).mockResolvedValue({ status: 'absent' })
  vi.mocked(readWorldMirror).mockResolvedValue(null)
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

describe('LoreSelectorRoute — open last world on launch', () => {
  // `startupHandled` lives at module scope in LoreSelectorRoute.tsx so it
  // survives a remount within the same page life — that's the point, it's
  // what makes guard (a) below work. The flip side: it LEAKS BETWEEN TESTS
  // in this file, since the module is only loaded once for the whole suite.
  // Every test in this block calls vi.resetModules() and re-imports the
  // route (and its mocked collaborators) fresh, so the outcome of either
  // test never depends on what ran before it, in this file or any other.
  afterEach(() => {
    localStorage.removeItem(CURRENT_LORE_KEY)
  })

  const openLastWorldSettings = {
    openLastWorld: true,
    spellcheck: true,
    spellcheckLang: '',
    backupOnExit: false,
    defaultBackupDir: null,
    autoUpdateCheck: true,
    lastUpdateCheckAt: null,
    dismissedUpdateVersion: null,
  }

  function renderAtRoot(RouteComponent: typeof LoreSelectorRoute) {
    return render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<RouteComponent />} />
          <Route path="/home" element={<div>HOME STUB</div>} />
        </Routes>
      </MemoryRouter>,
    )
  }

  it('redirects to /home on the first arrival at "/" when the pref is on and the remembered world exists', async () => {
    vi.resetModules()
    const { default: FreshLoreSelectorRoute } = await import('./LoreSelectorRoute')
    const { listLores: freshListLores } = await import('../lores')
    const { getAppSettings: freshGetAppSettings } = await import('../appSettings')
    vi.mocked(freshListLores).mockResolvedValue([world()])
    vi.mocked(freshGetAppSettings).mockResolvedValue(openLastWorldSettings)
    localStorage.setItem(CURRENT_LORE_KEY, world().id)

    renderAtRoot(FreshLoreSelectorRoute)

    expect(await screen.findByText('HOME STUB')).toBeTruthy()
  })

  it('does not redirect again on a second visit in the same page life (guard a: the picker stays reachable)', async () => {
    vi.resetModules()
    const { default: FreshLoreSelectorRoute } = await import('./LoreSelectorRoute')
    const { listLores: freshListLores } = await import('../lores')
    const { getAppSettings: freshGetAppSettings } = await import('../appSettings')
    vi.mocked(freshListLores).mockResolvedValue([world()])
    vi.mocked(freshGetAppSettings).mockResolvedValue(openLastWorldSettings)
    localStorage.setItem(CURRENT_LORE_KEY, world().id)

    // First arrival: redirects away (same behaviour proven above).
    renderAtRoot(FreshLoreSelectorRoute)
    await screen.findByText('HOME STUB')
    cleanup()

    // Second arrival at "/" in the same page life — e.g. a "Switch World"
    // link that navigates client-side without a reload. Must show the
    // picker, not bounce straight back to /home (which would make the
    // picker unreachable).
    renderAtRoot(FreshLoreSelectorRoute)
    expect(await screen.findByText(/Choose a world to enter/i)).toBeTruthy()
    expect(screen.queryByText('HOME STUB')).toBeNull()
  })

  it('shows the picker (does not bounce back) on the first "/" arrival after the page loaded elsewhere — the "Switch world" dead-click bug', async () => {
    // switchLore() reloads to #/home, and so does any plain F5 on a page. In
    // that case LoreSelectorRoute never mounts on load, so a mount-based
    // "startup" guard stays false — and the user's deliberate later click on
    // Sidebar's "Switch world" (a client-side <Link to="/">) gets misread as
    // a cold launch and redirected straight back to /home: a dead click.
    // The fix must key "startup" off how the PAGE loaded, not off whether
    // this route has mounted before.
    vi.resetModules()
    window.location.hash = '#/home'
    try {
      const { default: FreshLoreSelectorRoute } = await import('./LoreSelectorRoute')
      const { listLores: freshListLores } = await import('../lores')
      const { getAppSettings: freshGetAppSettings } = await import('../appSettings')
      vi.mocked(freshListLores).mockResolvedValue([world()])
      vi.mocked(freshGetAppSettings).mockResolvedValue(openLastWorldSettings)
      localStorage.setItem(CURRENT_LORE_KEY, world().id)

      // First-ever mount of this route in this (simulated) page life, but the
      // page itself loaded at #/home, not at the picker — i.e. this arrival at
      // "/" is a deliberate client-side navigation (Switch world), not a launch.
      renderAtRoot(FreshLoreSelectorRoute)

      expect(await screen.findByText(/Choose a world to enter/i)).toBeTruthy()
      expect(screen.queryByText('HOME STUB')).toBeNull()
    } finally {
      window.location.hash = ''
    }
  })
})

describe('LoreSelectorRoute — recovery panel', () => {
  // #174: worlds mirrored to disk that the registry DB doesn't know about
  // (the storage-was-wiped case). The panel offers to restore them, but must
  // never write anything without a click, and must not render at all when
  // there's nothing to recover — the normal case for every healthy install.

  // `toHaveBeenCalled()` is true the instant the effect fires the read on
  // mount — synchronously, in the same act() flush as render(). It says
  // nothing about whether the read has *resolved* or whether React has
  // applied the setDiskWorlds() update that follows it, so a negative
  // assertion right after it races a pending state update and passes
  // vacuously either way. Instead, await the exact promise the effect
  // itself is chained off of (the mock's own return value for that call),
  // wrapped in act() so React flushes the resulting render before we go on
  // to assert its absence.
  async function settleDiskRead() {
    await waitFor(() => expect(readRegistryMirror).toHaveBeenCalled())
    const pending = vi.mocked(readRegistryMirror).mock.results[0]?.value
    await act(async () => {
      await pending
    })
  }

  it('stays hidden when there is nothing on disk to recover', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({ status: 'absent' })
    render(<LoreSelectorRoute />)
    await settleDiskRead()
    expect(screen.queryByText(/found on disk/i)).toBeNull()
  })

  // #174 Defect 1: an unreadable index (not absent) must also stay hidden —
  // this route never writes, so degrading to "offer nothing" here is safe
  // (unlike the writers in lores.ts / worldMirrorSync.ts, which must refuse
  // to write instead).
  it('stays hidden when the disk index is unreadable', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({ status: 'error' })
    render(<LoreSelectorRoute />)
    await settleDiskRead()
    expect(screen.queryByText(/found on disk/i)).toBeNull()
  })

  it('offers worlds present on disk but missing from the registry', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'lost', name: 'Aethel', mirroredAt: Date.now(), appVersion: '1.0.0' }]),
    })
    render(<LoreSelectorRoute />)
    expect(await screen.findByText(/found on disk/i)).toBeTruthy()
    expect(screen.getByText('Aethel')).toBeTruthy()
  })

  it('restores a world through the existing import path', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'lost', name: 'Aethel', mirroredAt: Date.now(), appVersion: '1.0.0' }]),
    })
    vi.mocked(readWorldMirror).mockResolvedValue('{"pages":[]}')
    render(<LoreSelectorRoute />)

    fireEvent.click(await screen.findByRole('button', { name: /restore/i }))

    // Nothing is written without this click, and the restore reuses the
    // migration wizard's path rather than a second import implementation.
    // It must pass the disk entry's own id ('lost') — not omit it — or the
    // restored world gets a fresh uuid and the original disk entry (still
    // absent from the registry) keeps satisfying plannedRecovery forever,
    // offering the same restore again on every launch (#174).
    await waitFor(() =>
      expect(importLoreFromBackup).toHaveBeenCalledWith('Aethel', '{"pages":[]}', 'lost'),
    )
  })

  // #174 task 3, I-B: id reuse means a restore can target the ACTIVE database
  // (e.g. restoring 'default' after an eviction that reset currentLoreId()
  // back to 'default'), and importBackupInto is a clear()-then-bulkAdd
  // transaction — exactly the mid-import hazard withMirroringSuspended
  // exists to guard, the same as SettingsRoute's import/restore-snapshot
  // branches already do.
  it('suspends mirroring for the duration of the restore', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'lost', name: 'Aethel', mirroredAt: Date.now(), appVersion: '1.0.0' }]),
    })
    vi.mocked(readWorldMirror).mockResolvedValue('{"pages":[]}')
    render(<LoreSelectorRoute />)

    fireEvent.click(await screen.findByRole('button', { name: /restore/i }))

    await waitFor(() => expect(importLoreFromBackup).toHaveBeenCalled())
    expect(withMirroringSuspended).toHaveBeenCalled()
  })

  it('does not offer a world whose registry entry already exists', async () => {
    // Make the disk entry's id match a world listLores already reports, so
    // plannedRecovery filters it out and the panel stays hidden.
    vi.mocked(listLores).mockResolvedValue([world({ id: 'default' })])
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'default', name: 'Aethel' }]),
    })
    render(<LoreSelectorRoute />)
    await settleDiskRead()
    expect(screen.queryByText(/found on disk/i)).toBeNull()
  })
})

// #174 task r3, item 4: a world named in the index with mirroredAt: null and
// absent from the registry has no .lore file at all — nothing to restore —
// but silently dropping it from view means the app knows the names of the
// worlds it just lost and says nothing.
describe('never-mirrored worlds (#174 task r3, item 4)', () => {
  async function settleDiskRead() {
    await waitFor(() => expect(readRegistryMirror).toHaveBeenCalled())
    const pending = vi.mocked(readRegistryMirror).mock.results[0]?.value
    await act(async () => {
      await pending
    })
  }

  it('lists a never-mirrored world separately, with no Restore button', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'ghost', name: 'Unmirrored World', mirroredAt: null, appVersion: null }]),
    })
    render(<LoreSelectorRoute />)

    expect(await screen.findByText(/lost, with no copy on disk/i)).toBeTruthy()
    expect(screen.getByText('Unmirrored World')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /restore/i })).toBeNull()
    // Never mixed into the recoverable-worlds panel.
    expect(screen.queryByText(/found on disk/i)).toBeNull()
  })

  it('stays hidden when there is nothing never-mirrored', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({ status: 'absent' })
    render(<LoreSelectorRoute />)
    await settleDiskRead()
    expect(screen.queryByText(/lost, with no copy on disk/i)).toBeNull()
  })

  it('separates a mixed disk index into recoverable and never-mirrored sections', async () => {
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([
        { id: 'recoverable', name: 'Aethel', mirroredAt: Date.now(), appVersion: '1.0.0' },
        { id: 'ghost', name: 'Unmirrored World', mirroredAt: null, appVersion: null },
      ]),
    })
    render(<LoreSelectorRoute />)

    expect(await screen.findByText(/found on disk/i)).toBeTruthy()
    expect(await screen.findByText(/lost, with no copy on disk/i)).toBeTruthy()
    expect(screen.getByText('Aethel')).toBeTruthy()
    expect(screen.getByText('Unmirrored World')).toBeTruthy()
    // Exactly one Restore button — for the recoverable world only.
    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(1)
  })

  it('does not offer a never-mirrored world whose registry entry already exists', async () => {
    vi.mocked(listLores).mockResolvedValue([world({ id: 'ghost' })])
    vi.mocked(readRegistryMirror).mockResolvedValue({
      status: 'ok',
      text: JSON.stringify([{ id: 'ghost', name: 'Ghost', mirroredAt: null, appVersion: null }]),
    })
    render(<LoreSelectorRoute />)
    await settleDiskRead()
    expect(screen.queryByText(/lost, with no copy on disk/i)).toBeNull()
  })
})
