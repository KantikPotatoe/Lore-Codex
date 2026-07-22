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
 * Parse `<app-data>/worlds/registry.json`.
 *
 * Every failure mode collapses to an empty list. This file sits on disk where
 * a half-written index, a hand-edit, or an older format could all show up, and
 * the consequence of a parse error must be "offer nothing" — never a crash in
 * the lore selector, which is the one route a user with a broken world can
 * still reach.
 *
 * Entries whose id could not safely name a file are dropped here rather than
 * at the filesystem, so a tampered index cannot even reach the seam.
 */
export function parseDiskRegistry(text: string | null): RecoverableWorld[] {
  if (!text) return []
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out: RecoverableWorld[] = []
  for (const entry of raw) {
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
  return out
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
