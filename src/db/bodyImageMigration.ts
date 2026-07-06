import { db, uid, now, getMeta, setMeta } from './schema'
import { planBodyImageMigration } from '../bodyImage'

// One-time migration (#182 phase 2): lift every legacy inline body image out of
// page.content into the images table (kind:'body') and replace it with a bytes-
// free ref node, so Phase 1's node view / gallery / export machinery handles all
// page bodies uniformly. Phase 1 shipped the mechanism for *new* images; this
// converts *existing* bodies. Scoped to pages (scene/event bodies keep their inline
// images — they never adopted the ref node).

/** Meta flag marking a world's page bodies as already converted, so the
 *  full-table scan runs once. Cleared on import/restore so incoming legacy data
 *  gets converted on the next run. */
export const BODY_IMAGES_MIGRATED_KEY = 'bodyImagesMigrated'

// Coalesces overlapping calls. The App start effect double-invokes under React
// StrictMode (dev); without this both callers would read the stale done-flag, scan
// concurrently, and double-create image rows for the same inline image. While one
// run is in flight, later callers await the same promise.
let inFlight: Promise<number> | null = null

/**
 * Convert every page's inline data-URL body images to the by-ref model. Idempotent
 * in two independent ways: a done-flag short-circuits the scan, and each page is
 * only rewritten if it still holds an inline image (so a re-run, or a partially
 * completed run, is safe). Each page migrates in its own transaction, so one bad
 * row can't roll back the whole corpus. Returns the number of pages converted.
 */
export function migrateInlineBodyImages(): Promise<number> {
  if (inFlight) return inFlight
  inFlight = runMigration().finally(() => { inFlight = null })
  return inFlight
}

async function runMigration(): Promise<number> {
  if (await getMeta<boolean>(BODY_IMAGES_MIGRATED_KEY)) return 0

  const pages = await db.pages.toArray()
  let migrated = 0
  for (const page of pages) {
    const plan = planBodyImageMigration(page.content, uid)
    if (!plan) continue
    await db.transaction('rw', db.pages, db.images, async () => {
      for (const img of plan.added) {
        await db.images.add({
          id: img.id, pageId: page.id, dataUrl: img.dataUrl,
          caption: '', order: -1, createdAt: now(), kind: 'body',
        })
      }
      // A format migration, not a user edit — deliberately does NOT bump
      // updatedAt: bumping every page at once would flood the backup reminder and
      // could trigger a mass snapshot, and search text is unaffected (images are
      // stripped from the index regardless of how they're stored).
      await db.pages.update(page.id, { content: plan.html })
    })
    migrated++
  }

  await setMeta(BODY_IMAGES_MIGRATED_KEY, true)
  return migrated
}
