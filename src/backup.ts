import { db, exportAll, setMeta, LAST_BACKUP_KEY } from './db'
import { saveFile } from './platform'

// ---------------------------------------------------------------------------
// Backup & storage-safety helpers
// ---------------------------------------------------------------------------
// Your lore lives in the browser (IndexedDB). These helpers reduce the chance
// of losing it: they ask the browser to keep the data persistently, track when
// you last backed up, and download timestamped backup files you can keep in a
// synced folder (Dropbox / OneDrive / Google Drive) for off-device safety.

// The key lives in db/backup.ts (it's on the export blacklist there); re-export
// so existing call sites (BackupBanner, SettingsRoute) keep importing from here.
export { LAST_BACKUP_KEY } from './db'

/** Ask the browser not to auto-evict our data. Returns whether it's persisted. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  return navigator.storage.persist()
}

export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false
  return navigator.storage.persisted()
}

/** Save a timestamped JSON backup of everything and record the time.
 *  Goes through the platform seam: browser download, or a native Save-As
 *  dialog in the desktop shell — where the user can cancel, in which case
 *  the last-backup time is deliberately NOT stamped. */
export async function downloadBackup(): Promise<void> {
  const json = await exportAll()
  const saved = await saveFile(json, `lore-backup-${backupStamp()}.json`)
  if (saved) await setMeta(LAST_BACKUP_KEY, Date.now())
}

/**
 * Download a recovery copy of the current DB right before an import replaces it.
 * Named distinctly from a normal backup, and deliberately does NOT stamp
 * LAST_BACKUP_KEY (it's a safety artifact, and the data it captures is about to be
 * replaced). Skips entirely when the DB is empty — nothing to recover.
 */
export async function downloadPreImportBackup(): Promise<void> {
  const [pages, maps, pins, templates, calendars, events] = await Promise.all([
    db.pages.count(),
    db.maps.count(),
    db.pins.count(),
    db.templates.count(),
    db.calendars.count(),
    db.events.count(),
  ])
  if (pages + maps + pins + templates + calendars + events === 0) return
  const json = await exportAll()
  await saveFile(json, `lore-pre-import-${backupStamp()}.json`)
}

/** The most recent time any tracked data changed — i.e. the data we'd lose.
 *  Covers pages, maps, and timeline events/calendars (events carry the bulk of
 *  timeline edits). Events have no updatedAt index, so they're scanned in memory;
 *  the table is small enough that this stays cheap. */
export async function latestChangeTime(): Promise<number> {
  const [newestPage, newestMap, events, calendars, images] = await Promise.all([
    db.pages.orderBy('updatedAt').last(),
    db.maps.orderBy('createdAt').last(),
    db.events.toArray(),
    db.calendars.toArray(),
    db.images.toArray(),
  ])
  const newestEvent = events.reduce((max, e) => Math.max(max, e.updatedAt), 0)
  const newestCalendar = calendars.reduce((max, c) => Math.max(max, c.createdAt), 0)
  const newestImage = images.reduce((max, i) => Math.max(max, i.createdAt), 0)
  return Math.max(newestPage?.updatedAt ?? 0, newestMap?.createdAt ?? 0, newestEvent, newestCalendar, newestImage)
}

/** True if there is data that has changed since the last backup. */
export function hasUnbackedUpChanges(lastBackup: number | null, latestChange: number): boolean {
  if (latestChange === 0) return false // nothing to back up yet
  if (lastBackup === null) return true // data exists but never backed up
  return latestChange > lastBackup
}

/**
 * How many pages/maps/timeline events have changed since the last backup. Used
 * to turn the vague "you have changes" reminder into a concrete count. When
 * there is no prior backup, `since` is 0 so every existing record counts.
 * Events lack an updatedAt index, so they're filtered in memory.
 */
export async function unbackedChangeCount(lastBackup: number | null): Promise<number> {
  const since = lastBackup ?? 0
  const [pages, maps, events, images] = await Promise.all([
    db.pages.where('updatedAt').above(since).count(),
    db.maps.where('createdAt').above(since).count(),
    db.events.toArray(),
    db.images.toArray(),
  ])
  const eventChanges = events.filter((e) => e.updatedAt > since).length
  const imageChanges = images.filter((i) => i.createdAt > since).length
  return pages + maps + eventChanges + imageChanges
}

const DAY_MS = 24 * 60 * 60 * 1000

/** True if a backup is overdue: never taken, or older than `overdueDays` (default 7). */
export function isBackupOverdue(lastBackup: number | null, overdueDays = 7): boolean {
  if (lastBackup === null) return true
  return Date.now() - lastBackup > overdueDays * DAY_MS
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** A filename-safe timestamp, e.g. 2026-06-13_14-32. */
function backupStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
}

/** Human-friendly "3 days ago" / "just now" from a timestamp. */
export function timeAgo(ts: number | null): string {
  if (!ts) return 'never'
  const secs = Math.floor((Date.now() - ts) / 1000)
  if (secs < 60) return 'just now'
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
