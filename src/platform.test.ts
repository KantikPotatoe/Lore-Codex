import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  saveFile, openTextFile, writeAppData, isTauri, checkForUpdate, appVersion,
  writeWorldMirror, readWorldMirror, writeRegistryMirror, readRegistryMirror, trashWorldMirror,
} from './platform'

// The platform seam (desktop transition Phase 0): every capability that
// differs between the browser and the Tauri shell goes through this module.
// These tests pin the contract of saveFile — the browser path reproduces the
// old triggerDownload/downloadBlob idiom exactly; the Tauri path goes through
// the native Save-As dialog and reports cancellation.

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn(), open: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
  readTextFile: vi.fn(),
  mkdir: vi.fn(async () => {}),
  rename: vi.fn(),
  BaseDirectory: { AppData: 13 },
}))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }))

import { save, open } from '@tauri-apps/plugin-dialog'
import { writeFile, writeTextFile, readTextFile, mkdir, rename } from '@tauri-apps/plugin-fs'
import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'

// happy-dom has no URL.createObjectURL — stub the pair the browser path uses.
const createObjectURL = vi.fn(() => 'blob:fake')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  URL.createObjectURL = createObjectURL as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL
})

afterEach(() => {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

function enterTauri(): void {
  ;(window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = {}
}

describe('isTauri', () => {
  it('is false in a plain browser and true when the Tauri runtime is present', () => {
    expect(isTauri()).toBe(false)
    enterTauri()
    expect(isTauri()).toBe(true)
  })
})

describe('saveFile — browser path', () => {
  it('downloads via an object-URL anchor and reports saved', async () => {
    let downloadAttr = ''
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloadAttr = this.download
      })
    const saved = await saveFile('{"pages":[]}', 'lore-backup.json')

    expect(saved).toBe(true)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    // The anchor carried the suggested filename at click time.
    expect(downloadAttr).toBe('lore-backup.json')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake')
    // No native dialog outside the shell.
    expect(save).not.toHaveBeenCalled()
    click.mockRestore()
  })

  it('accepts a Blob (graph PNG / export zip / EPUB sinks)', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const saved = await saveFile(new Blob(['png-bytes']), 'graph.png')
    expect(saved).toBe(true)
    expect(createObjectURL).toHaveBeenCalledOnce()
    click.mockRestore()
  })
})

describe('saveFile — Tauri path', () => {
  it('writes text through the native Save-As dialog', async () => {
    enterTauri()
    vi.mocked(save).mockResolvedValue('C:\\Backups\\lore-backup.json')

    const saved = await saveFile('{"pages":[]}', 'lore-backup.json')

    expect(saved).toBe(true)
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: 'lore-backup.json' }))
    expect(writeTextFile).toHaveBeenCalledWith('C:\\Backups\\lore-backup.json', '{"pages":[]}')
    // No fake anchor download inside the shell.
    expect(createObjectURL).not.toHaveBeenCalled()
  })

  it('writes a Blob as bytes', async () => {
    enterTauri()
    vi.mocked(save).mockResolvedValue('C:\\out\\book.epub')

    const saved = await saveFile(new Blob(['epub-bytes']), 'book.epub')

    expect(saved).toBe(true)
    expect(writeFile).toHaveBeenCalledOnce()
    const [path, bytes] = vi.mocked(writeFile).mock.calls[0]
    expect(path).toBe('C:\\out\\book.epub')
    expect(new TextDecoder().decode(bytes as Uint8Array)).toBe('epub-bytes')
  })

  it('reports cancelled without writing when the dialog is dismissed', async () => {
    enterTauri()
    vi.mocked(save).mockResolvedValue(null)

    const saved = await saveFile('data', 'file.json')

    expect(saved).toBe(false)
    expect(writeTextFile).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })
})

describe('openTextFile — browser path', () => {
  it('reads the picked file through a hidden input', async () => {
    const promise = openTextFile()
    const input = document.querySelector<HTMLInputElement>('input[type="file"][data-platform-open]')
    expect(input).not.toBeNull()

    const file = new File(['{"pages":[]}'], 'lore-backup.json', { type: 'application/json' })
    Object.defineProperty(input!, 'files', { value: [file] })
    input!.dispatchEvent(new Event('change'))

    const opened = await promise
    expect(opened).toEqual({ name: 'lore-backup.json', text: '{"pages":[]}' })
    // The transient input is cleaned up.
    expect(document.querySelector('input[data-platform-open]')).toBeNull()
  })

  it('resolves null when the picker is dismissed', async () => {
    const promise = openTextFile()
    const input = document.querySelector<HTMLInputElement>('input[data-platform-open]')
    input!.dispatchEvent(new Event('cancel'))
    expect(await promise).toBeNull()
  })
})

describe('openTextFile — Tauri path', () => {
  it('reads the dialog-picked path and derives the file name', async () => {
    enterTauri()
    vi.mocked(open).mockResolvedValue('C:\\Backups\\lore-backup-2026.json')
    vi.mocked(readTextFile).mockResolvedValue('{"pages":[]}')

    const opened = await openTextFile()

    expect(opened).toEqual({ name: 'lore-backup-2026.json', text: '{"pages":[]}' })
    expect(readTextFile).toHaveBeenCalledWith('C:\\Backups\\lore-backup-2026.json')
  })

  it('resolves null when the dialog is dismissed', async () => {
    enterTauri()
    vi.mocked(open).mockResolvedValue(null)
    expect(await openTextFile()).toBeNull()
    expect(readTextFile).not.toHaveBeenCalled()
  })
})

describe('writeAppData', () => {
  it('is a no-op returning false in the browser', async () => {
    expect(await writeAppData('backups/pre-import.json', '{}')).toBe(false)
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('creates the parent folder and writes under the app-data dir in the shell', async () => {
    enterTauri()
    const ok = await writeAppData('backups/pre-import.json', '{"pages":[]}')

    expect(ok).toBe(true)
    expect(mkdir).toHaveBeenCalledWith('backups', expect.objectContaining({ recursive: true }))
    expect(writeTextFile).toHaveBeenCalledWith(
      'backups/pre-import.json',
      '{"pages":[]}',
      expect.objectContaining({ baseDir: 13 }),
    )
  })
})

describe('checkForUpdate', () => {
  it('resolves null in a plain browser without touching the plugin', async () => {
    expect(await checkForUpdate()).toBe(null)
    expect(check).not.toHaveBeenCalled()
  })

  it('resolves null in the shell when no update is available', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue(null)
    expect(await checkForUpdate()).toBe(null)
  })

  it('maps the plugin update onto the seam shape', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0',
      currentVersion: '0.38.0',
      body: 'Notes here',
      download: vi.fn(),
      install: vi.fn(),
    } as never)

    const update = await checkForUpdate()
    expect(update?.version).toBe('0.39.0')
    expect(update?.currentVersion).toBe('0.38.0')
    expect(update?.notes).toBe('Notes here')
  })

  it('exposes only the seam shape — the plugin object never escapes', async () => {
    // Containment is this function's whole reason for returning a handle
    // rather than the plugin's Update. TypeScript enforces it today; this
    // makes a future `as`-cast breach fail loudly instead of silently.
    enterTauri()
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download: vi.fn(), install: vi.fn(),
      // Fields a real plugin Update carries that must NOT be re-exported:
      rid: 7, date: '2026-01-01', downloadAndInstall: vi.fn(), close: vi.fn(),
    } as never)
    const update = await checkForUpdate()
    expect(Object.keys(update!).sort()).toEqual(
      ['currentVersion', 'download', 'install', 'notes', 'version'],
    )
  })

  it('tolerates a missing release body', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0',
      currentVersion: '0.38.0',
      body: undefined,
      download: vi.fn(),
      install: vi.fn(),
    } as never)

    expect((await checkForUpdate())?.notes).toBe('')
  })

  it('reports download progress as a 0-100 percentage', async () => {
    enterTauri()
    const download = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 200 } })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Finished' })
    })
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download, install: vi.fn(),
    } as never)

    const seen: (number | null)[] = []
    const update = await checkForUpdate()
    await update?.download((pct) => seen.push(pct))
    expect(seen).toEqual([0, 25, 50, 100])
  })

  it('reports indeterminate progress when the server sends no length', async () => {
    enterTauri()
    const download = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: 'Started', data: {} })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Finished' })
    })
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download, install: vi.fn(),
    } as never)

    const seen: (number | null)[] = []
    const update = await checkForUpdate()
    await update?.download((pct) => seen.push(pct))
    expect(seen).toEqual([null, null, 100])
  })

  it('delegates install to the plugin update', async () => {
    enterTauri()
    const install = vi.fn(async () => {})
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download: vi.fn(), install,
    } as never)

    await (await checkForUpdate())?.install()
    expect(install).toHaveBeenCalledOnce()
  })
})

describe('appVersion', () => {
  it('resolves null in a plain browser', async () => {
    expect(await appVersion()).toBe(null)
    expect(getVersion).not.toHaveBeenCalled()
  })

  it('reads the shell version', async () => {
    enterTauri()
    vi.mocked(getVersion).mockResolvedValue('0.38.0')
    expect(await appVersion()).toBe('0.38.0')
  })
})

describe('writeWorldMirror', () => {
  it('is a no-op in the browser', async () => {
    expect(await writeWorldMirror('default', '{}')).toBe(false)
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('writes a temp file and renames it over the target', async () => {
    enterTauri()
    const order: string[] = []
    vi.mocked(writeTextFile).mockImplementation(async (p) => { order.push(`write:${String(p)}`) })
    vi.mocked(rename).mockImplementation(async (a, b) => { order.push(`rename:${String(a)}->${String(b)}`) })

    expect(await writeWorldMirror('default', '{"pages":[]}')).toBe(true)

    // The rename is the commit point: a torn write must never land on the
    // real file, so the temp write has to come first.
    expect(order).toEqual([
      'write:worlds/default.lore.tmp',
      'rename:worlds/default.lore.tmp->worlds/default.lore',
    ])
  })

  it('refuses a lore id that could escape the worlds folder', async () => {
    enterTauri()
    await expect(writeWorldMirror('../../evil', '{}')).rejects.toThrow(/unsafe lore id/i)
    expect(writeTextFile).not.toHaveBeenCalled()
  })

  it('awaits the temp write before committing the rename', async () => {
    // The order-only assertion above ("writes a temp file and renames it
    // over the target") passes even if the `await` before `rename` is
    // dropped, because the mocks resolve synchronously in the same tick —
    // proved by mutation. This test pins the actual suspension: writeTextFile
    // is gated on a promise we control, so if the implementation doesn't
    // await it, `rename` fires before we ever release the gate.
    enterTauri()
    let releaseWrite = () => {}
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    vi.mocked(writeTextFile).mockImplementation(async () => { await writeGate })
    vi.mocked(rename).mockImplementation(async () => {})

    const pending = writeWorldMirror('default', '{"pages":[]}')
    // A macrotask boundary (not a fixed count of microtask ticks) drains
    // every microtask queued so far — including the implementation's own
    // `await import(...)` and `await mkdir(...)` hops before it ever reaches
    // the write — without releasing the gate. Only a real suspension on
    // writeGate can still block `rename` at this point.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rename).not.toHaveBeenCalled()

    releaseWrite()
    await pending
    expect(rename).toHaveBeenCalledOnce()
  })
})

describe('readWorldMirror', () => {
  it('is a no-op in the browser', async () => {
    expect(await readWorldMirror('default')).toBeNull()
  })

  it('reads the named world file', async () => {
    enterTauri()
    vi.mocked(readTextFile).mockResolvedValue('{"pages":[]}')
    expect(await readWorldMirror('default')).toBe('{"pages":[]}')
    expect(readTextFile).toHaveBeenCalledWith('worlds/default.lore', expect.anything())
  })

  it('returns null when the file is absent rather than throwing', async () => {
    enterTauri()
    vi.mocked(readTextFile).mockRejectedValue(new Error('ENOENT'))
    expect(await readWorldMirror('default')).toBeNull()
  })
})

describe('registry mirror', () => {
  it('is a no-op in the browser', async () => {
    expect(await writeRegistryMirror('[]')).toBe(false)
    expect(await readRegistryMirror()).toBeNull()
  })

  it('writes atomically, like a world mirror', async () => {
    enterTauri()
    const order: string[] = []
    vi.mocked(writeTextFile).mockImplementation(async (p) => { order.push(`write:${String(p)}`) })
    vi.mocked(rename).mockImplementation(async (a, b) => { order.push(`rename:${String(a)}->${String(b)}`) })

    expect(await writeRegistryMirror('[]')).toBe(true)
    expect(order).toEqual([
      'write:worlds/registry.json.tmp',
      'rename:worlds/registry.json.tmp->worlds/registry.json',
    ])
  })

  it('awaits the temp write before committing the rename', async () => {
    // Same mutation-proofing as writeWorldMirror's equivalent test, applied
    // to the registry's call site of the shared atomicAppDataWrite helper.
    enterTauri()
    let releaseWrite = () => {}
    const writeGate = new Promise<void>((resolve) => { releaseWrite = resolve })
    vi.mocked(writeTextFile).mockImplementation(async () => { await writeGate })
    vi.mocked(rename).mockImplementation(async () => {})

    const pending = writeRegistryMirror('[]')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(rename).not.toHaveBeenCalled()

    releaseWrite()
    await pending
    expect(rename).toHaveBeenCalledOnce()
  })

  it('returns null when there is no registry on disk', async () => {
    enterTauri()
    vi.mocked(readTextFile).mockRejectedValue(new Error('ENOENT'))
    expect(await readRegistryMirror()).toBeNull()
  })
})

describe('trashWorldMirror', () => {
  it('is a no-op in the browser', async () => {
    expect(await trashWorldMirror('default', '2026-07-21_10-00')).toBe(false)
  })

  it('renames the world file into the trash folder instead of deleting it', async () => {
    enterTauri()
    expect(await trashWorldMirror('default', '2026-07-21_10-00')).toBe(true)
    expect(rename).toHaveBeenCalledWith(
      'worlds/default.lore',
      'worlds/trash/default-2026-07-21_10-00.lore',
      expect.anything(),
    )
  })

  it('reports false when there is no mirror to trash', async () => {
    enterTauri()
    vi.mocked(rename).mockRejectedValue(new Error('ENOENT'))
    expect(await trashWorldMirror('default', '2026-07-21_10-00')).toBe(false)
  })
})
