// Pure recovery logic for the per-world disk mirror (#174). No Tauri, no
// React, no Dexie: reading the registry file is platform.ts's job, importing a
// world is lores.ts's, and deciding what to offer is this module's.

import { isValidLoreId } from './worldMirror'
import type { WorldIndexEntry } from './worldIndex'

/**
 * A world found on disk that the registry DB does not know about.
 *
 * Same shape as `WorldIndexEntry` (src/worldIndex.ts) — both describe one row
 * of `worlds/registry.json`. Kept as an alias rather than a second,
 * independently-typed interface: worldIndex.ts owns the canonical on-disk row
 * (it's what `mergeWorldIndex`/`markWorldMirrored` produce and what
 * `syncRegistryMirror` writes), and `parseDiskRegistry` below hands its output
 * straight to `mergeWorldIndex` with no conversion step. Two near-identical
 * interfaces here would only be free to drift from the shape actually
 * persisted to disk.
 */
export type RecoverableWorld = WorldIndexEntry

/**
 * The seam's read outcome, BEFORE any content parsing.
 *
 * Defined here rather than in platform.ts — the module that actually performs
 * the read — because worldRecovery.ts must stay Tauri-free, and this is the
 * vocabulary its own `parseDiskRegistry` (below) consumes; platform.ts's
 * `readRegistryMirror()` imports this type (type-only, so no runtime edge is
 * created) to shape its return value.
 *
 * `'absent'` and `'error'` are NOT interchangeable, even though both used to
 * collapse to the same `null` before #174 Defect 1: `'absent'` is a
 * legitimate empty registry (first run, or the browser, which has no
 * filesystem at all) and is safe for a caller to write over. `'error'` means
 * a real file exists that could not be read right now — permission denied, a
 * Windows sharing violation, a disk I/O failure — quite possibly on the very
 * machine that just evicted its storage. Treating that as empty is how a
 * transient read failure becomes a permanent, silent loss of every entry a
 * read failure merely hid rather than actually erased.
 */
export type DiskRegistryRead =
  | { status: 'ok'; text: string }
  | { status: 'absent' }
  | { status: 'error' }

/**
 * The on-disk envelope format `registry.json` is written in. Bumped only when
 * the shape of an entry — or the envelope itself — changes in a way an older
 * build cannot safely interpret.
 */
export const REGISTRY_FORMAT_VERSION = 1

/**
 * Outcome of parsing (not just reading) the disk index.
 *
 * `ok: false` covers the seam-level `'error'` above AND every content-level
 * failure `parseDiskRegistry` can detect on its own: unparseable JSON, a
 * top-level shape that is neither the legacy bare array nor a
 * `{version, worlds}` envelope, or an envelope whose `version` is NEWER than
 * this build understands (the live downgrade scenario the auto-updater
 * creates — an older build has no way to know what a newer shape dropped or
 * renamed, so it must never flatten it).
 *
 * Every WRITER (`syncRegistryMirror`/`dropFromRegistryMirror` in lores.ts,
 * `stampRegistryMirrored` in worldMirrorSync.ts) must treat `ok: false` as
 * "refuse to write" — a shrinking write must never follow a read/parse
 * failure. A READ-ONLY display consumer (`LoreSelectorRoute`'s recovery
 * panel) may still degrade `ok: false` to "offer nothing", exactly as a bare
 * `[]` always has, because it never persists anything back to disk.
 */
export type ParsedDiskRegistry =
  | { ok: true; entries: RecoverableWorld[] }
  | { ok: false }

/**
 * Parse `<app-data>/worlds/registry.json`, given the seam's read outcome.
 *
 * Accepts both the legacy bare-array shape (everything written before the
 * envelope existed) and the `{version, worlds}` envelope, migrating the
 * former forward silently — `version` is treated as `REGISTRY_FORMAT_VERSION`
 * for a bare array, since that's what every array-shaped file on disk today
 * actually is. An envelope whose `version` is newer than
 * `REGISTRY_FORMAT_VERSION` reports `ok: false` rather than being parsed
 * partially or treated as empty (#174 Defect 3): this build cannot know what
 * a newer shape means, and guessing "empty" is exactly the downgrade bug the
 * envelope exists to prevent.
 *
 * Individual malformed entries within an otherwise well-formed list are
 * dropped one at a time — a hand-edited or partially-written row shouldn't
 * cost the rest of the file — which is a different, narrower tolerance than
 * the whole-file-shape checks above.
 */
export function parseDiskRegistry(read: DiskRegistryRead): ParsedDiskRegistry {
  if (read.status === 'error') return { ok: false }
  if (read.status === 'absent') return { ok: true, entries: [] }

  let raw: unknown
  try {
    raw = JSON.parse(read.text)
  } catch {
    return { ok: false }
  }

  let list: unknown[]
  if (Array.isArray(raw)) {
    list = raw
  } else if (raw !== null && typeof raw === 'object') {
    const envelope = raw as Record<string, unknown>
    if (
      typeof envelope.version !== 'number' ||
      !Number.isFinite(envelope.version) ||
      !Array.isArray(envelope.worlds)
    ) {
      return { ok: false }
    }
    if (envelope.version > REGISTRY_FORMAT_VERSION) {
      // A newer index this build does not understand. Must not be flattened.
      return { ok: false }
    }
    list = envelope.worlds
  } else {
    return { ok: false }
  }

  const out: RecoverableWorld[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.id !== 'string' || !isValidLoreId(e.id)) continue
    out.push({
      id: e.id,
      name: typeof e.name === 'string' && e.name.trim() ? e.name : e.id,
      mirroredAt: typeof e.mirroredAt === 'number' ? e.mirroredAt : null,
      appVersion: typeof e.appVersion === 'string' ? e.appVersion : null,
    })
  }
  return { ok: true, entries: out }
}

/**
 * Serialize entries into the on-disk envelope. Paired with `parseDiskRegistry`
 * above — every writer must go through this instead of hand-rolling
 * `JSON.stringify(entries)`, or the file would regress to the bare-array
 * shape `parseDiskRegistry` only still reads for backward compatibility.
 */
export function serializeDiskRegistry(entries: RecoverableWorld[]): string {
  return JSON.stringify({ version: REGISTRY_FORMAT_VERSION, worlds: entries })
}

/**
 * Which worlds to offer restoring: those present on disk, absent from the
 * registry DB, and actually mirrored.
 *
 * A deleted world is absent from both — `deleteLore` moves its `.lore` into
 * `worlds/trash/` and re-indexes — so a deliberate deletion is never
 * resurrected by this.
 *
 * `mirroredAt === null` means the index knows the world's name (the registry
 * added it, `mergeWorldIndex` recorded it unmirrored) but no `.lore` file was
 * ever written for it. There is nothing to restore from — offering it would
 * produce a click that always fails with "That world file could not be read."
 */
export function plannedRecovery(
  disk: RecoverableWorld[],
  known: { id: string }[],
): RecoverableWorld[] {
  const seen = new Set(known.map((l) => l.id))
  return disk.filter((w) => !seen.has(w.id) && w.mirroredAt !== null)
}
