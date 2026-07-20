import { useCallback, useRef, useState } from 'react'
import { checkForUpdate, type UpdateInfo } from './platform'
import { getAppSettings, updateAppSettings } from './appSettings'
import { shouldCheck, isDismissed } from './updater'

/** The whole updater lifecycle as one discriminated union, so the banner and
 *  the Settings panel read the same source and cannot disagree about state. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string; notes: string }
  | { status: 'downloading'; version: string; pct: number | null }
  | { status: 'ready'; version: string }
  | { status: 'installing' }
  | { status: 'error'; message: string }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  // The pending update handle lives in a ref, not state: it is a live object
  // with methods, not render data, and stashing it in state would make every
  // progress tick a fresh object identity for no benefit.
  const pending = useRef<UpdateInfo | null>(null)

  /**
   * @param manual true when the user asked (Settings → "Check now"), which
   *   bypasses the 24h throttle, ignores a previous dismissal, and surfaces
   *   errors. An automatic check does none of those: it is background work,
   *   and "couldn't reach GitHub" is not news the user asked for.
   */
  const check = useCallback(async (manual: boolean) => {
    const settings = await getAppSettings()
    if (!manual && !shouldCheck({
      enabled: settings.autoUpdateCheck,
      lastCheckedAt: settings.lastUpdateCheckAt,
      now: Date.now(),
    })) return

    setState({ status: 'checking' })
    try {
      const update = await checkForUpdate()
      await updateAppSettings({ lastUpdateCheckAt: Date.now() })
      if (!update) {
        pending.current = null
        setState({ status: 'none' })
        return
      }
      // A dismissal silences the banner, not the Settings panel: if you came
      // looking, you get an answer.
      if (!manual && isDismissed(update.version, settings.dismissedUpdateVersion)) {
        pending.current = null
        setState({ status: 'none' })
        return
      }
      pending.current = update
      setState({ status: 'available', version: update.version, notes: update.notes })
    } catch (err) {
      if (manual) setState({ status: 'error', message: message(err) })
      else {
        console.warn('[updater] check failed', err)
        setState({ status: 'idle' })
      }
    }
  }, [])

  const download = useCallback(async () => {
    const update = pending.current
    if (!update) return
    setState({ status: 'downloading', version: update.version, pct: null })
    try {
      await update.download((pct) => setState({ status: 'downloading', version: update.version, pct }))
      setState({ status: 'ready', version: update.version })
    } catch (err) {
      setState({ status: 'error', message: message(err) })
    }
  }, [])

  const install = useCallback(async () => {
    const update = pending.current
    if (!update) return
    setState({ status: 'installing' })
    try {
      // On Windows this does not return: the NSIS installer terminates the
      // app to replace it. The catch is for the cases where it fails first.
      await update.install()
    } catch (err) {
      setState({ status: 'error', message: message(err) })
    }
  }, [])

  const dismiss = useCallback(async () => {
    const update = pending.current
    if (update) await updateAppSettings({ dismissedUpdateVersion: update.version })
    pending.current = null
    setState({ status: 'none' })
  }, [])

  return { state, check, download, install, dismiss }
}
