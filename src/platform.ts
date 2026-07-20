// src/platform.ts
// The shell seam (desktop transition Phase 0, see
// docs/desktop-transition-investigation.md §9).
//
// Every capability that differs between the plain browser and the Tauri
// desktop shell goes through this module — one file to audit for IPC surface,
// one place to add shell APIs in later phases (open dialogs, world mirrors).
// Detection is per-call, not cached at module load, so tests (and a future
// hybrid flow) can flip environments freely.
//
// Rule for new code: never call a `@tauri-apps/*` API or trigger an
// `<a download>` outside this module.

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * Save data to a user-visible file.
 *
 * - **Browser:** triggers a download to the Downloads folder via an
 *   object-URL anchor — the only mechanism a browser (Firefox included)
 *   allows. Always resolves `true`: a download can't be cancelled from code.
 * - **Tauri:** opens the native Save-As dialog and writes the chosen file
 *   (`<a download>` is a silent no-op in the wry webview, so the shell MUST
 *   take this path). Resolves `false` when the user dismisses the dialog —
 *   callers that record "a backup was taken" must check this.
 *
 * The Tauri plugins are imported lazily so the web bundle's behavior and the
 * test environment stay free of shell modules unless actually in the shell.
 */
export async function saveFile(
  data: Blob | string,
  suggestedName: string,
  opts?: { defaultDir?: string | null },
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    // A remembered folder only *pre-fills* the dialog — it grants no write
    // access on its own (Tauri scopes fs writes to paths picked in the current
    // session's dialog), and the user still confirms the path.
    const dir = opts?.defaultDir?.replace(/[\\/]+$/, '')
    const path = await save({ defaultPath: dir ? `${dir}/${suggestedName}` : suggestedName })
    if (!path) return false
    if (typeof data === 'string') {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(path, data)
    } else {
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      await writeFile(path, new Uint8Array(await data.arrayBuffer()))
    }
    return true
  }

  // Browser: the download idiom previously duplicated in backup.ts,
  // graphExport.ts, htmlExport.ts and manuscriptExport.ts.
  const blob = typeof data === 'string' ? new Blob([data], { type: 'application/json' }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
  return true
}

export interface OpenedFile {
  /** The picked file's base name (no directories). */
  name: string
  text: string
}

/**
 * Let the user pick a text file and read it.
 *
 * - **Browser:** a transient `<input type="file">` (the same mechanism the
 *   Settings import previously wired by hand).
 * - **Tauri:** the native Open dialog + a scoped read of the picked path.
 *
 * Resolves `null` when the picker is dismissed.
 */
export async function openTextFile(): Promise<OpenedFile | null> {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const path = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'JSON backup', extensions: ['json'] }],
    })
    if (typeof path !== 'string') return null
    const { readTextFile } = await import('@tauri-apps/plugin-fs')
    const text = await readTextFile(path)
    const name = path.split(/[\\/]/).pop() ?? path
    return { name, text }
  }

  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    // Marker attribute so tests (and debugging) can find the transient input.
    input.setAttribute('data-platform-open', '')
    input.hidden = true
    const done = async () => {
      const file = input.files?.[0]
      input.remove()
      resolve(file ? { name: file.name, text: await file.text() } : null)
    }
    input.addEventListener('change', done)
    // Modern browsers fire `cancel` on a dismissed picker; if a browser
    // doesn't, the orphaned listener resolves nothing and the input is
    // simply removed with the page — no leak that matters.
    input.addEventListener('cancel', () => {
      input.remove()
      resolve(null)
    })
    document.body.appendChild(input)
    input.click()
  })
}

/**
 * Print a self-contained HTML document via a hidden same-window iframe.
 * Replaces the old `window.open('') + document.write + win.print()` idiom,
 * which popup blockers interfere with in browsers and which is unreliable in
 * the shell's webview (Tauri's window.open is not a full popup). The frame is
 * removed on `afterprint`, with a timed fallback for engines that don't fire
 * it. The caller is responsible for sanitizing `html` (printBook feeds it
 * DOMPurify-scrubbed markup via compileBookHtml/toXhtml).
 */
export async function printHtml(html: string): Promise<void> {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('data-platform-print', '')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.position = 'fixed'
  iframe.style.right = '100%'
  iframe.style.bottom = '100%'
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) {
    iframe.remove()
    throw new Error('Printing is not available in this environment.')
  }
  doc.open()
  doc.write(html)
  doc.close()
  await new Promise<void>((resolve) => {
    if (doc.readyState === 'complete') resolve()
    else win.addEventListener('load', () => resolve(), { once: true })
  })
  const cleanup = () => iframe.remove()
  win.addEventListener('afterprint', cleanup, { once: true })
  // Engines that never fire afterprint (or a cancelled dialog) still get the
  // frame cleaned up eventually; it's invisible meanwhile.
  setTimeout(cleanup, 60_000)
  win.focus()
  win.print()
}

/**
 * Write a text file under the app's data directory (e.g. automatic
 * pre-import safety copies). Shell-only by design: resolves `false` in the
 * browser so callers can fall back to a download. `relativePath` may contain
 * forward-slash folders; parents are created.
 */
export async function writeAppData(relativePath: string, contents: string): Promise<boolean> {
  if (!isTauri()) return false
  const { writeTextFile, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
  const dir = relativePath.split('/').slice(0, -1).join('/')
  if (dir) {
    await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {
      // Already exists — fine. A real permission failure surfaces on the write.
    })
  }
  await writeTextFile(relativePath, contents, { baseDir: BaseDirectory.AppData })
  return true
}

/**
 * Let the user pick a folder. Shell-only: resolves `null` in the browser (no
 * directory picker exists there) and on cancel.
 *
 * The returned path is a *hint for the Save dialog*, not a grant: writing to it
 * silently in a later session would fail, because Tauri only scopes fs writes to
 * paths picked in the current session's dialog. See
 * `src-tauri/capabilities/default.json`.
 */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const path = await open({ directory: true, multiple: false })
  return typeof path === 'string' ? path : null
}

/**
 * Run `handler` when the user closes the desktop window, then close it.
 * Resolves an unsubscribe function; a no-op in the browser, where an async
 * export cannot be awaited on unload (and nothing is lost anyway — IndexedDB
 * persists), so no equivalent is offered.
 *
 * The close is deliberately wrapped: a failing handler must never wedge the
 * window shut. Whatever happens, the window is destroyed.
 */
export async function onCloseRequested(handler: () => Promise<void>): Promise<() => void> {
  if (!isTauri()) return () => {}
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  // Guards against re-entry while the handler is still running: `unlisten()`
  // only happens AFTER the awaited handler resolves, so the listener stays
  // registered for the whole backup. An impatient second click on the X (or
  // Alt+F4) during that window — up to 5s, per App.tsx's timeout — would
  // otherwise re-enter this callback: a second exportAll() running
  // concurrently with the first, and a second win.destroy() racing the first
  // (the loser rejecting outside any try/catch, an unhandled rejection).
  let closing = false
  const unlisten = await win.onCloseRequested(async (event) => {
    event.preventDefault() // we need to await the handler before the window goes
    if (closing) return
    closing = true
    try {
      await handler()
    } catch {
      // A failed exit-backup is not a reason to trap the user in the app.
    }
    unlisten()
    await win.destroy()
  })
  return unlisten
}

/**
 * A pending update, with the shell plumbing already bound to it.
 *
 * This is a handle rather than three free functions on purpose: `install()`
 * must act on the *same* plugin `Update` instance that `check()` returned, and
 * a module-level variable holding "the current update" would be a race the
 * moment two checks overlap. The plugin object itself never escapes this
 * module — only these plain fields and methods do.
 */
export interface UpdateInfo {
  /** The version on offer, e.g. "0.39.0". */
  version: string
  /** The version currently running. */
  currentVersion: string
  /** Release notes; '' when the release has no body. */
  notes: string
  /**
   * Download the installer, reporting progress as 0-100. `null` means
   * indeterminate: the server sent no content length, so a percentage would
   * be a lie and the UI should show a spinner instead of a filled bar.
   *
   * Downloading does NOT install — see `install()`.
   */
  download(onProgress: (pct: number | null) => void): Promise<void>
  /**
   * Run the downloaded installer. **This terminates the running app** on
   * Windows: NSIS has to replace the executable it would otherwise be
   * holding open. That is why download and install are separate — the app
   * must never disappear out from under an author mid-sentence.
   */
  install(): Promise<void>
}

/**
 * Ask GitHub whether a newer signed release exists.
 *
 * Resolves `null` in the browser (always) and in the shell when the running
 * version is current. Throws if the network is unreachable or the manifest
 * fails signature verification — callers decide whether that is worth
 * surfacing (an automatic check swallows it; an explicit one reports it).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? '',
    async download(onProgress) {
      let total = 0
      let received = 0
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
          onProgress(total > 0 ? 0 : null)
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength
          onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null)
        } else if (event.event === 'Finished') {
          onProgress(100)
        }
      })
    },
    install() {
      return update.install()
    },
  }
}

/**
 * The running shell's version, from the bundle metadata (which
 * `tauri.conf.json` reads from `package.json`). `null` in the browser, where
 * there is no installed app to have a version.
 */
export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}
