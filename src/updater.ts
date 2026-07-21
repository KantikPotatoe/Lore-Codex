// Pure decision logic for the desktop auto-updater (#225). No Tauri, no
// React, no Dexie — the shell calls live in `platform.ts` and the state
// lives in `appSettings.ts`, so everything decidable is decidable in a test.

/** How long to wait between automatic checks. Launching the app five times in
 *  a morning must cost GitHub one request, not five. "Check now" in Settings
 *  bypasses this deliberately. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** How long after mount the banner waits before checking, so the request never
 *  competes with loading a world. Exported so the test drives the same number
 *  the component does, rather than hard-coding a duplicate. */
export const CHECK_DELAY_MS = 2000

/** Whether an automatic check is due.
 *
 *  A `lastCheckedAt` in the future is treated as due rather than ignored: a
 *  clock rollback (or a hand-edited registry row) would otherwise disable
 *  update checks until real time caught up, which could be years. A
 *  non-finite stored timestamp (`NaN` — `coerceSettings` accepts it, since
 *  `typeof NaN === 'number'`) counts as due for the same reason: it fails
 *  every numeric comparison, so without this guard a corrupted value would
 *  disable checking permanently instead of just once. */
export function shouldCheck(args: {
  enabled: boolean
  lastCheckedAt: number | null
  now: number
}): boolean {
  const { enabled, lastCheckedAt, now } = args
  if (!enabled) return false
  if (lastCheckedAt === null) return true
  if (!Number.isFinite(lastCheckedAt)) return true
  if (lastCheckedAt > now) return true
  return now - lastCheckedAt >= CHECK_INTERVAL_MS
}

/** Whether this exact version was dismissed.
 *
 *  String identity is the whole rule — no semver comparison anywhere in our
 *  code. The plugin decides what counts as *newer*; we only need to know
 *  whether this is the same one the user already waved away, so a later
 *  release re-surfaces the banner on its own. */
export function isDismissed(version: string, dismissedVersion: string | null): boolean {
  return dismissedVersion !== null && dismissedVersion === version
}
