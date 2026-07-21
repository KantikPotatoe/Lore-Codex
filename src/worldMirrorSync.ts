// The per-world disk mirror (#174), Phase 2 of the desktop transition.
//
// Infra tier: this module reads the whole DB through exportAll(), like
// backup.ts and snapshots.ts, and is on the eslint allowlist for that reason.
// The decision of *when* to write lives in the pure worldMirror.ts; the
// decision of *how* lives in platform.ts. This file owns only the state
// between them.

import { exportAll } from './db'
import { latestChangeTime } from './backup'
import { currentLoreId } from './loreId'
import { writeWorldMirror } from './platform'
import { shouldMirror, MIRROR_POLL_MS } from './worldMirror'

// When the active world was last mirrored, this page-life. Deliberately not
// persisted: a fresh launch then mirrors once shortly after start if anything
// changed since the file was written, which is the behaviour we want anyway.
let lastMirrorAt = 0

// Depth counter, not a boolean: nested suspensions must not have the inner one
// lift the guard early.
let suspendDepth = 0

// Coalesces overlapping runs, exactly as maybeTakeSnapshot() does — the App
// start effect double-invokes under StrictMode in dev, and a poll can land on
// top of a close-flush.
let inFlight: Promise<void> | null = null

/** Test-only: reset module state between cases. */
export function resetWorldMirrorStateForTests(): void {
  lastMirrorAt = 0
  suspendDepth = 0
  inFlight = null
}

/**
 * Run `fn` with mirroring suspended.
 *
 * `importAll()` is clear() + bulkAdd. A mirror write landing between the two
 * would export a half-empty world and rename it over a perfectly good mirror —
 * turning the durability feature into a data-loss mechanism at exactly the
 * moment the user is restoring. Attempts made while suspended are **dropped,
 * not queued**: a deferred write would fire against the intermediate state it
 * was meant to avoid.
 */
export async function withMirroringSuspended<T>(fn: () => Promise<T>): Promise<T> {
  suspendDepth++
  try {
    return await fn()
  } finally {
    suspendDepth--
  }
}

/** Mirror the active world if the cadence policy says it is due. */
export async function maybeMirrorWorld(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  const lastChangeAt = await latestChangeTime()
  if (!shouldMirror({ lastChangeAt, lastMirrorAt, now })) return
  return run(now)
}

/**
 * Mirror the active world now, ignoring the quiet and floor windows — used on
 * window close, where there is no later opportunity. Still a no-op for a world
 * with nothing to mirror, and still suppressed during an import.
 */
export async function flushWorldMirror(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  const lastChangeAt = await latestChangeTime()
  if (lastChangeAt === 0) return
  if (lastChangeAt <= lastMirrorAt) return
  return run(now)
}

function run(now: number): Promise<void> {
  if (inFlight) return inFlight
  inFlight = write(now).finally(() => { inFlight = null })
  return inFlight
}

async function write(now: number): Promise<void> {
  const json = await exportAll()
  const wrote = await writeWorldMirror(currentLoreId(), json)
  // Only stamp on a real write. In the browser the seam reports false, and
  // recording a mirror time there would tell the policy a mirror exists when
  // none does.
  if (wrote) lastMirrorAt = now
}

/**
 * Start the polling loop. Returns an unsubscribe function.
 *
 * Polling rather than hooking edit sites is deliberate: latestChangeTime()
 * sees every table, so map-only, timeline-only and manuscript-only sessions
 * are covered without instrumenting each save path — and no future edit path
 * can forget to opt in. Each poll costs six indexed boundary reads.
 */
export function startMirrorLoop(): () => void {
  const id = setInterval(() => { void maybeMirrorWorld() }, MIRROR_POLL_MS)
  return () => clearInterval(id)
}
