// Pure decision logic for the per-world disk mirror (#174). No Tauri, no
// React, no Dexie — the shell calls live in `platform.ts` and the module
// state lives in `worldMirrorSync.ts`, so the policy is decidable in a test.

/** Quiet window: how long editing must pause before a mirror write lands, so
 *  writes fall between bursts rather than inside them. */
export const MIRROR_QUIET_MS = 30_000

/** Interval floor: the minimum gap between two mirror writes. A full export
 *  inlines every image as a data URL and can run to tens of megabytes, so a
 *  long session must not rewrite it every quiet window. */
export const MIRROR_FLOOR_MS = 5 * 60_000

/** How often the shell re-evaluates the policy. Each evaluation costs six
 *  indexed boundary reads (`latestChangeTime`), not a table scan. */
export const MIRROR_POLL_MS = 30_000

/** Whether a lore id is safe to use as a filename.
 *
 *  Ids come from `crypto.randomUUID()` or the literal 'default' today, but this
 *  value is concatenated into a path handed to the filesystem — the place to
 *  assume good input is not the last step before `writeTextFile`. Conservative
 *  by design: anything outside [A-Za-z0-9_-] is refused rather than escaped. */
export function isValidLoreId(id: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(id)
}

/** Whether the active world's mirror should be rewritten now.
 *
 *  There is deliberately no dirty flag: `lastChangeAt` comes from
 *  `latestChangeTime()`, which sees every table, so no future edit path can
 *  forget to mark the world dirty. Non-finite and future timestamps count as
 *  due — the same guard `updater.ts`'s `shouldCheck` carries, and for the same
 *  reason: a corrupted or rolled-back clock must never disable durability
 *  silently and indefinitely. */
export function shouldMirror(args: {
  lastChangeAt: number
  lastMirrorAt: number
  now: number
  quietMs?: number
  floorMs?: number
}): boolean {
  const {
    lastChangeAt,
    lastMirrorAt,
    now,
    quietMs = MIRROR_QUIET_MS,
    floorMs = MIRROR_FLOOR_MS,
  } = args

  // A world with no recorded change at all has nothing to mirror. Checked
  // before the finite guards so an untouched world stays silent.
  if (lastChangeAt === 0) return false

  if (!Number.isFinite(lastChangeAt) || !Number.isFinite(lastMirrorAt)) return true
  if (lastChangeAt > now || lastMirrorAt > now) return true

  if (lastChangeAt <= lastMirrorAt) return false // already mirrored
  if (now - lastChangeAt < quietMs) return false // still editing
  return now - lastMirrorAt >= floorMs
}
