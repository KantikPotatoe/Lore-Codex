// The per-world disk mirror (#174), Phase 2 of the desktop transition.
//
// Infra tier: this module reads the whole DB through exportAll(), like
// backup.ts and snapshots.ts, and is on the eslint allowlist for that reason.
// The decision of *when* to write lives in the pure worldMirror.ts; the
// decision of *how* lives in platform.ts. This file owns only the state
// between them.
//
// It also reads the registry DB directly (`registry.lores.get`) to look up
// the mirrored world's name when stamping the on-disk index after a write —
// the same allowlist entry drops the REGISTRY_BAN for this file too (see
// eslint.config.js), and going through lores.ts for one field would add a
// dependency this module doesn't otherwise need.

import { exportAll, activeLoreId, db, countAll } from './db'
import { latestChangeTime } from './backup'
import {
  writeWorldMirror, readRegistryMirror, writeRegistryMirror, WORLDS_DIR, withRegistryMirrorLock,
} from './platform'
import { shouldMirror, MIRROR_POLL_MS } from './worldMirror'
import { parseDiskRegistry, serializeDiskRegistry } from './worldRecovery'
import { markWorldMirrored } from './worldIndex'
import { registry } from './registryDb'
import pkg from '../package.json'

// When the active world was last mirrored, this page-life. Deliberately not
// persisted: a fresh launch then mirrors once shortly after start if anything
// changed since the file was written, which is the behaviour we want anyway.
let lastMirrorAt = 0

// When this page-life first evaluated the cadence policy. The staleness
// ceiling measures from here until the first real write lands, because
// `lastMirrorAt` above starts at 0: a ceiling measured from it alone is true
// on the first poll of every launch, which would force a multi-megabyte
// export 30 seconds into every session, mid-burst. Stamped lazily rather than
// at module load — a module-level Date.now() is an import side effect, and
// lazy stamping keeps the value resettable between test cases.
let sessionStartAt = 0

// Depth counter, not a boolean: nested suspensions must not have the inner one
// lift the guard early.
let suspendDepth = 0

// Monotonic counter, incremented every time a suspension cycle *completes*
// (withMirroringSuspended's finally, whether nested or not). `suspendDepth`
// alone answers "is a suspension active right now" — which is the wrong
// question for write()'s post-export recheck, because a suspension can be
// raised AND fully lowered while the export was in flight, leaving
// suspendDepth back at 0 by the time the recheck runs even though the export
// straddled someone else's clear()/bulkAdd. write() captures this value
// before exportAll() and compares it after: any change at all — regardless
// of whether suspendDepth is currently >0 — means at least one suspend cycle
// happened during the export, so the payload must be treated as torn. (#174
// task r3, item 1.)
let suspendEpoch = 0

// Coalesces overlapping runs, exactly as maybeTakeSnapshot() does — the App
// start effect double-invokes under StrictMode in dev, and a poll can land on
// top of a close-flush.
let inFlight: Promise<void> | null = null

// ---------------------------------------------------------------------------
// Mirror health (#174 I4)
// ---------------------------------------------------------------------------
//
// Before this, a rejected write became an unhandled promise rejection off
// startMirrorLoop's fire-and-forget interval, and installStorageErrorListener
// only recognises IndexedDB quota/eviction shapes — a Tauri filesystem error
// (permission denied, disk full, a path outside the granted scope) matches
// neither and vanished silently. A mirror that has never once succeeded then
// looks exactly like one working perfectly, right up until the moment the
// user actually needs it. This state is the fix: the last time a write
// actually landed on disk, and the most recent failure since then, so
// Settings has something honest to show.

/** Epoch ms of the last write that actually committed to disk, or `null` if
 *  none has this page-life. Deliberately not persisted, like `lastMirrorAt`
 *  above — a fresh launch reporting "never" until the first real write is the
 *  correct and expected reading, not a regression to explain away. */
let lastSuccessAt: number | null = null

/** The most recent write failure, cleared the next time a write succeeds —
 *  this reports *current* health, not a running incident log. `null` means no
 *  failure since the last success (or ever, this page-life). */
let lastError: { message: string; at: number } | null = null

export interface MirrorHealth {
  lastSuccessAt: number | null
  lastError: { message: string; at: number } | null
}

/** Current mirror health, for a status readout (Settings). A plain accessor
 *  rather than a subscription: callers that want it live (as Settings does)
 *  poll it on an interval, the same idiom `appVersion()` already uses there
 *  for a one-shot read. */
export function getMirrorHealth(): MirrorHealth {
  return { lastSuccessAt, lastError }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Where the active world's mirror lives, relative to the app's data folder —
 *  for display only (Settings). Takes `loreId` as a parameter, defaulted to
 *  the bound world, so it stays testable without touching module state. */
export function mirrorFilePath(loreId: string = activeLoreId): string {
  return `${WORLDS_DIR}/${loreId}.lore`
}

// ---------------------------------------------------------------------------
// Mirror-specific change probe (#174 follow-up: I2)
// ---------------------------------------------------------------------------
//
// latestChangeTime() (backup.ts) is NOT a "sees every table" function — it
// reads an indexed updatedAt/createdAt boundary on 6 of the 15 tables
// exportAll() writes (pages, maps, events, calendars, images, scenes; see
// schema.ts). BackupBanner and backupOnExit depend on exactly that shape, so
// it is deliberately left alone here. The other 11 tables — pins, regions,
// templates, docLinks, books, chapters, plotlines, beats, meta,
// relationshipTypes, relationships — carry no timestamp field at all, so a
// pin-only, plotline-only, settings-only or relationship-only session left
// latestChangeTime() flat: no poll write, no close flush.

/** The 11 tables exportAll() writes that have no updatedAt/createdAt index to
 *  read (see schema.ts). Tracked by row COUNT instead: an add or a delete
 *  changes the count even with nothing to timestamp. */
const COUNTED_TABLES = [
  'pins', 'regions', 'templates', 'docLinks',
  'books', 'chapters', 'plotlines', 'beats', 'meta',
  'relationshipTypes', 'relationships',
] as const
type CountedTable = (typeof COUNTED_TABLES)[number]

async function countedTableCounts(): Promise<Record<CountedTable, number>> {
  const [pins, regions, templates, docLinks, books, chapters, plotlines, beats, meta,
    relationshipTypes, relationships] =
    await Promise.all([
      db.pins.count(), db.regions.count(), db.templates.count(), db.docLinks.count(),
      db.books.count(), db.chapters.count(), db.plotlines.count(), db.beats.count(),
      db.meta.count(), db.relationshipTypes.count(), db.relationships.count(),
    ])
  return { pins, regions, templates, docLinks, books, chapters, plotlines, beats, meta,
    relationshipTypes, relationships }
}

// The counts as of the last time they were read, so the next read can tell
// whether any of the 11 counted tables gained or lost a row. `null` until the
// first read this page-life (see the "first observation" guard below).
let lastKnownCounts: Record<CountedTable, number> | null = null

// The last poll `now` at which a counted-table diff was actually observed.
// Persisted across polls (unlike a plain "changed just now" flag) so the
// usual quiet/floor windows in shouldMirror() can elapse against it exactly
// as they do against a real DB timestamp — see mirrorChangeTime() below.
let countedChangeAt = 0

/**
 * Mirror-specific change signal, wider than latestChangeTime(). Combines the
 * same 6 indexed timestamp reads latestChangeTime() does with a `count()` on
 * each of the 11 tables it cannot see, so an add or a delete on any of those
 * tables registers even though there is no timestamp to read.
 *
 * A counted table's diff is detected by comparing this poll's counts against
 * the previous poll's (module state, reset per page-life like lastMirrorAt).
 * The *first* poll a diff is seen, `countedChangeAt` is stamped with `now` —
 * not the real edit time, which this probe has no way to know, but close
 * enough given MIRROR_POLL_MS and MIRROR_QUIET_MS are both 30s today. That
 * timestamp then behaves exactly like a real one for shouldMirror()'s
 * quiet/floor logic: it stays put (doesn't keep sliding forward) until the
 * next actual diff, so a counted-only change can still settle and pass the
 * quiet window on a later poll.
 *
 * What this still cannot see: an in-place EDIT to a row on one of the 9
 * counted tables — renaming a pin's label, rewriting a plotline's beat text,
 * moving a map pin's coordinates, tweaking a saved setting's value in place —
 * changes no count and touches no index, so it is invisible between two
 * polls. (Editing a page or a scene IS caught: both carry updatedAt.) The
 * pre-existing `maps`/`calendars` blind spot also isn't fixed here: their
 * `createdAt` index doesn't move when an existing map/calendar is edited,
 * only when one is added — that's `latestChangeTime()`'s behaviour, and this
 * probe reuses it unchanged. `flushWorldMirror()`'s unconditional close-time
 * write is the deliberate backstop for whatever this probe still misses.
 */
async function mirrorChangeTime(now: number): Promise<number> {
  const [indexedMax, counts] = await Promise.all([latestChangeTime(), countedTableCounts()])
  const prev = lastKnownCounts
  lastKnownCounts = counts
  if (prev && COUNTED_TABLES.some((t) => counts[t] !== prev[t])) {
    countedChangeAt = now
  }
  return Math.max(indexedMax, countedChangeAt)
}

/** Whether the active world has anything at all worth mirroring. Used only by
 *  flushWorldMirror's unconditional close-time write, which deliberately asks
 *  "is there content" rather than "did it change since the last mirror" — see
 *  flushWorldMirror's doc for why. */
async function hasMirrorableContent(): Promise<boolean> {
  const [counts, metaCount] = await Promise.all([countAll(), db.meta.count()])
  return metaCount > 0 || Object.values(counts).some((n) => n > 0)
}

/** Test-only: reset module state between cases. */
export function resetWorldMirrorStateForTests(): void {
  lastMirrorAt = 0
  sessionStartAt = 0
  suspendDepth = 0
  suspendEpoch = 0
  inFlight = null
  lastKnownCounts = null
  countedChangeAt = 0
  lastSuccessAt = null
  lastError = null
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
 *
 * If a write is already in flight (past the entry guard, mid-`exportAll()`)
 * when this is called, `fn` waits for it to finish first. That lets an export
 * that started before the user confirmed an import complete and commit
 * cleanly — entirely before `fn` (e.g. `importAll`'s `clear()`) can touch the
 * tables it's reading — instead of racing it. A write that hasn't reached
 * `inFlight` yet (still evaluating the change probe) isn't waited on here;
 * `write()`'s own suspendDepth recheck after `exportAll()` is what catches
 * that one (see I3 there).
 */
export async function withMirroringSuspended<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight) await inFlight.catch(() => {})
  suspendDepth++
  try {
    return await fn()
  } finally {
    suspendDepth--
    suspendEpoch++
  }
}

/** Mirror the active world if the cadence policy says it is due. */
export async function maybeMirrorWorld(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  // Stamped here, not in flushWorldMirror: flush bypasses the cadence policy
  // entirely, so it has no anchor to establish.
  if (sessionStartAt === 0) sessionStartAt = now
  const lastChangeAt = await mirrorChangeTime(now)
  if (!shouldMirror({ lastChangeAt, lastMirrorAt, now, sessionStartAt })) return
  return run(now)
}

/**
 * Mirror the active world now, ignoring the quiet/floor windows AND whatever
 * the change probe has or hasn't noticed — used on window close, where there
 * is no later poll to fall back on. This is the deliberate backstop for
 * mirrorChangeTime()'s documented blind spots (see there): on close, the only
 * question that matters is whether the world has anything worth capturing,
 * not whether the probe thinks it changed since the last mirror. Still a
 * no-op for a completely empty world, and still suppressed during an import.
 */
export async function flushWorldMirror(now = Date.now()): Promise<void> {
  if (suspendDepth > 0) return
  if (!(await hasMirrorableContent())) return
  return run(now)
}

function run(now: number): Promise<void> {
  if (inFlight) return inFlight
  inFlight = write(now).finally(() => { inFlight = null })
  return inFlight
}

async function write(now: number): Promise<void> {
  // I1: the bound world, not a live localStorage read. exportAll() reads the
  // `db` singleton, which bound to `dbNameFor(currentLoreId())` at module
  // load and never rebinds without a reload — `activeLoreId` is that same
  // snapshot. `currentLoreId()` can already have moved on by the time a poll
  // lands: deleteLore/switchLore on the active world does
  // Dexie.delete()/clear → localStorage write → *then* reload, and a poll
  // inside that window would otherwise export the just-deleted (empty) DB
  // under the *new* live loreId and, worse, commit it over the old id's good
  // mirror if the ids happened to coincide, or under the wrong filename
  // entirely — exactly the corruption the atomic write exists to prevent.
  const loreId = activeLoreId
  // The invariant: the mirror only ever writes for a world the app knows it
  // has. A relaunch after storage eviction rebinds `db` to an empty database
  // under 'default' and App.tsx's startup effect immediately seeds it
  // (templates, a default calendar) — which the change probe above correctly
  // sees as "changed". Without this check that seeded-empty export would
  // rename over a perfectly good worlds/default.lore the instant the poll or
  // close-flush fires, while the recovery panel is still offering the real
  // file back. bootstrapDefaultLore() deliberately does not create a registry
  // row for a world it didn't seed, so "absent from the registry" is exactly
  // the signal this state leaves behind — checked here, not at each caller,
  // so no future poll/flush path can forget it.
  if (!(await registry.lores.get(loreId))) return
  try {
    // I3 / task r3 item 1: a poll can begin, pass the entry guard, and still
    // be mid-`exportAll()` when `withMirroringSuspended` raises the guard for
    // an import — `exportAll` is 15 independent `toArray()` calls, not one
    // transaction, so it can itself straddle `importAll`'s `clear()`/`bulkAdd`.
    // That already-running export may therefore hold a torn snapshot by the
    // time it resolves. Capturing the epoch here, before the export starts,
    // is what makes the recheck below catch a suspension that is raised AND
    // fully lowered while the export is in flight — `suspendDepth > 0` alone
    // would miss that case, because by the time the recheck runs the depth is
    // back at 0 even though the export straddled someone else's clear/bulkAdd.
    const epochAtStart = suspendEpoch
    const json = await exportAll()
    // Re-checking here, immediately before the disk write, is what actually
    // matters: a torn export that never reaches disk is harmless, but one
    // that does can rename a half-imported world over a good mirror.
    // (withMirroringSuspended's own await-inFlight keeps this rare in
    // practice — see there — but only this recheck makes it *safe*
    // regardless.) Either condition alone is enough to abort: suspendDepth
    // catches a suspension still active right now; the epoch comparison
    // catches one that started and finished entirely during the export.
    if (suspendDepth > 0 || suspendEpoch !== epochAtStart) return
    const wrote = await writeWorldMirror(loreId, json)
    // Only stamp on a real write. In the browser the seam reports false, and
    // recording a mirror time there would tell the policy a mirror exists when
    // none does.
    if (wrote) {
      lastMirrorAt = now
      lastSuccessAt = now
      lastError = null // a fresh success supersedes whatever failed before it
      await stampRegistryMirrored(loreId, now)
    }
  } catch (err) {
    // I4: record it before letting it propagate. `run()`'s caller decides how
    // to handle the rejection (flushWorldMirror is awaited inside App.tsx's
    // already-caught close race; startMirrorLoop's fire-and-forget poll adds
    // its own `.catch()` below) — but either way, the failure must land here
    // first, or a mirror that has never once succeeded is indistinguishable
    // from one working perfectly until recovery day.
    lastError = { message: errorMessage(err), at: now }
    throw err
  }
}

/**
 * Record this write in the on-disk index (#174's second bug). The spec
 * claimed `mirroredAt` was already stamped at write time; it was not — it was
 * stamped for every world on every `syncRegistryMirror()` call, which is not
 * the same claim. This is the one and only place a real mirror write happens,
 * so it is the one and only place `mirroredAt` may become non-null.
 *
 * Best-effort, like `syncRegistryMirror`/`dropFromRegistryMirror` in
 * lores.ts: a stamp that fails to write must not fail the mirror write it is
 * recording, and must not throw into the polling loop.
 *
 * Wrapped in `withRegistryMirrorLock` and refuses to write on an unreadable
 * disk index, for exactly the reasons `syncRegistryMirror` in lores.ts does
 * (#174 Defects 1 and 2) — this is the third of the three writers that share
 * `registry.json`.
 */
async function stampRegistryMirrored(id: string, at: number): Promise<void> {
  await withRegistryMirrorLock(async () => {
    try {
      const [lore, diskRead] = await Promise.all([registry.lores.get(id), readRegistryMirror()])
      const parsed = parseDiskRegistry(diskRead)
      if (!parsed.ok) return
      const name = lore?.name ?? id
      const index = markWorldMirrored(parsed.entries, id, name, at, pkg.version)
      await writeRegistryMirror(serializeDiskRegistry(index))
    } catch {
      // Best-effort — see syncRegistryMirror in lores.ts.
    }
  })
}

/**
 * Start the polling loop. Returns an unsubscribe function.
 *
 * Polling rather than hooking edit sites is deliberate: no future edit path
 * can forget to opt in, because the poll doesn't depend on any of them firing
 * a hook. `mirrorChangeTime()` (above) is what makes that hold in practice —
 * six indexed boundary reads plus eleven row counts, cheap enough for a 30s
 * cadence — but it is not exhaustive; see its doc for exactly what an
 * in-place edit on an unindexed, uncounted field can still hide from it, and
 * `flushWorldMirror()` for the close-time backstop.
 */
export function startMirrorLoop(): () => void {
  const id = setInterval(() => {
    // I4: write() (above) already recorded a failure into mirror health
    // before rethrowing — this `.catch()` exists only so a fire-and-forget
    // poll tick can't turn that rethrow into an unhandled promise rejection.
    void maybeMirrorWorld().catch(() => {})
  }, MIRROR_POLL_MS)
  return () => clearInterval(id)
}
