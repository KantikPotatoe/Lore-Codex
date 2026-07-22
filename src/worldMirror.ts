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

/** Staleness ceiling: how long changes may go unmirrored before a write is
 *  forced through the quiet window. Without it the quiet window is
 *  unreachable for a steady typist — `PageRoute` commits content after 500ms,
 *  so `lastChangeAt` slides forward faster than `MIRROR_QUIET_MS` elapses and
 *  no mirror write fires for the whole session, making an unclean loss cost the
 *  entire editing burst (#233). Bounds that loss at this value plus one poll.
 *  Ten minutes rather than fifteen because `MIRROR_FLOOR_MS` already permits a
 *  write every five during bursty editing, so a forced write every ten asks
 *  nothing of the system it doesn't already do on a normal day. */
export const MIRROR_MAX_STALE_MS = 10 * 60_000

/** How often the shell re-evaluates the policy. Each evaluation costs six
 *  indexed boundary reads plus nine row counts (worldMirrorSync's
 *  mirrorChangeTime), not a table scan. */
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
 *  There is deliberately no dirty flag: `lastChangeAt` comes from the
 *  caller's change probe (`worldMirrorSync.ts`'s `mirrorChangeTime`, which
 *  combines `latestChangeTime()`'s six indexed reads with row counts for the
 *  tables that have neither — see its doc for exactly what that can and can't
 *  see), so no future edit path needs a hook of its own to mark the world
 *  dirty. Non-finite and future timestamps count as due — the same guard
 *  `updater.ts`'s `shouldCheck` carries, and for the same reason: a corrupted
 *  or rolled-back clock must never disable durability silently and
 *  indefinitely.
 *
 *  Three windows, in order of precedence. The **quiet window** holds a write
 *  back while editing is in flight; the **staleness ceiling** overrides it
 *  once changes have been pending for `maxStaleMs`, because otherwise a
 *  steady typist never reaches a quiet moment at all (#233); the **interval
 *  floor** is evaluated on every path, ceiling included, so it always holds.
 *  That last point is deliberate: it keeps `maxStaleMs >= floorMs` a tuning
 *  choice rather than a correctness dependency.
 *
 *  `sessionStartAt` is what the ceiling measures from until the first write of
 *  the page-life lands. `lastMirrorAt` is module state in `worldMirrorSync.ts`
 *  that starts at 0 every page-life, so a ceiling measured from it alone would
 *  be true on the first poll of every launch — forcing a multi-megabyte export
 *  30 seconds into a session, mid-burst, which is precisely what the quiet
 *  window exists to prevent. It defaults to `now`, which makes the *anchor
 *  path* inert: before the first write of a page-life (`lastMirrorAt === 0`,
 *  so `staleSince` falls back to `sessionStartAt`), a caller that omits it
 *  degrades to the pre-#233 behaviour and can never trigger a spurious write.
 *  That guarantee does not extend past the first write — once `lastMirrorAt`
 *  is non-zero, `staleSince` reads it directly and the ceiling engages
 *  regardless of whether `sessionStartAt` was supplied. */
export function shouldMirror(args: {
  lastChangeAt: number
  lastMirrorAt: number
  now: number
  sessionStartAt?: number
  quietMs?: number
  floorMs?: number
  maxStaleMs?: number
}): boolean {
  const {
    lastChangeAt,
    lastMirrorAt,
    now,
    sessionStartAt = now,
    quietMs = MIRROR_QUIET_MS,
    floorMs = MIRROR_FLOOR_MS,
    maxStaleMs = MIRROR_MAX_STALE_MS,
  } = args

  // A world with no recorded change at all has nothing to mirror. Checked
  // before the finite guards so an untouched world stays silent — and before
  // the ceiling, so an old session can't force a write of an empty world.
  if (lastChangeAt === 0) return false

  if (
    !Number.isFinite(lastChangeAt) ||
    !Number.isFinite(lastMirrorAt) ||
    !Number.isFinite(sessionStartAt)
  ) return true
  if (lastChangeAt > now || lastMirrorAt > now || sessionStartAt > now) return true

  // Checked before the ceiling: the disk copy is already current, so however
  // stale the clock says it is, there is nothing new to write.
  if (lastChangeAt <= lastMirrorAt) return false // already mirrored

  const staleSince = lastMirrorAt > 0 ? lastMirrorAt : sessionStartAt
  const stale = now - staleSince >= maxStaleMs

  if (!stale && now - lastChangeAt < quietMs) return false // still editing
  return now - lastMirrorAt >= floorMs
}
