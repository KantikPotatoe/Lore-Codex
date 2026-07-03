import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { saveFile, isTauri } from './platform'

// The platform seam (desktop transition Phase 0): every capability that
// differs between the browser and the Tauri shell goes through this module.
// These tests pin the contract of saveFile — the browser path reproduces the
// old triggerDownload/downloadBlob idiom exactly; the Tauri path goes through
// the native Save-As dialog and reports cancellation.

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), writeTextFile: vi.fn() }))

import { save } from '@tauri-apps/plugin-dialog'
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs'

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
