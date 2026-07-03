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
export async function saveFile(data: Blob | string, suggestedName: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({ defaultPath: suggestedName })
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
