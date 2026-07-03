// SNAPSHOT_TIME_KEY is defined in db/backup.ts so exports can blacklist it
// (it's device-local bookkeeping that must not travel in a backup).
import { db, exportAll, getMeta, setMeta, saveSnapshot, SNAPSHOT_TIME_KEY } from './db'
import { getSettings } from './settings'

// Coalesces overlapping calls: the App start effect double-invokes under React
// StrictMode in dev, and edit sessions can overlap. Without this guard two callers
// both read the stale SNAPSHOT_TIME_KEY and each take a snapshot. While one run is
// in flight, later calls await the same promise instead of starting their own.
let inFlight: Promise<void> | null = null

/**
 * Take a snapshot if the number of changed records (pages + timeline events)
 * since the last snapshot meets the configured change threshold, OR if the
 * configured time has passed and at least one record changed. Thresholds and
 * retention come from per-lore settings (defaults reproduce the old 50 / 24h /
 * keep-10 behavior). Safe to call after every save and on app start; concurrent
 * calls are coalesced into one.
 */
export function maybeTakeSnapshot(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = takeSnapshot().finally(() => { inFlight = null })
  return inFlight
}

async function takeSnapshot(): Promise<void> {
  const { snapshotChangeThreshold, snapshotTimeHours, snapshotRetention } = await getSettings()
  const lastTime = (await getMeta<number>(SNAPSHOT_TIME_KEY)) ?? 0
  const now = Date.now()
  const [pagesChanged, events, scenesChanged] = await Promise.all([
    db.pages.where('updatedAt').above(lastTime).count(),
    db.events.toArray(),
    db.scenes.where('updatedAt').above(lastTime).count(),
  ])
  const eventsChanged = events.filter((e) => e.updatedAt > lastTime).length
  const changed = pagesChanged + eventsChanged + scenesChanged

  if (changed === 0) return

  const timePassed = now - lastTime >= snapshotTimeHours * 60 * 60 * 1000
  if (changed < snapshotChangeThreshold && !timePassed) return

  const data = await exportAll()
  await saveSnapshot(data, changed, snapshotRetention)
  await setMeta(SNAPSHOT_TIME_KEY, now)
}
