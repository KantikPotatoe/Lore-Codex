// Pure reconciliation logic for `<app-data>/worlds/registry.json` (#174).
//
// No Tauri, no React, no Dexie: reading the file is platform.ts's job,
// deciding *when* to write it is lores.ts's (world CRUD) and
// worldMirrorSync.ts's (a real mirror write), and this module owns only the
// merge itself, so it is decidable in a test.

export interface WorldIndexEntry {
  id: string
  name: string
  /** When this world's .lore was last written, or null if never (this install). */
  mirroredAt: number | null
  appVersion: string | null
}

/**
 * Reconcile the on-disk index with the registry DB.
 *
 * A UNION, never a replacement. The registry DB is the volatile store this
 * whole feature exists to survive; rebuilding the index from it means an
 * eviction erases the pointers to the very files that survived. Entries known
 * only to disk are therefore KEPT, and dropped only by an explicit delete
 * (`dropWorldFromIndex`).
 *
 * `mirroredAt` and `appVersion` describe one specific `.lore` file write, so
 * for a world already on disk they are carried through untouched — never
 * invented here. Only a real mirror write may change them (`markWorldMirrored`).
 * The registry's `name` IS authoritative on a merge, though: a rename must
 * propagate to the index even though no file was rewritten.
 *
 * A world the registry knows about that has never been mirrored (no disk
 * entry yet) is a genuinely new row; it is recorded with `mirroredAt: null`
 * (nothing to restore from) and today's `appVersion`, purely as a record of
 * which build first knew about it — `plannedRecovery` excludes anything with
 * `mirroredAt: null` regardless, so this has no effect on what recovery offers.
 */
export function mergeWorldIndex(args: {
  onDisk: WorldIndexEntry[]
  known: { id: string; name: string }[]
  appVersion: string
}): WorldIndexEntry[] {
  const { onDisk, known, appVersion } = args

  // Duplicate ids on disk collapse to one entry. This codebase never writes
  // duplicates itself, but the file is hand-editable, so the last one wins
  // rather than crashing or silently duplicating a world.
  const byId = new Map<string, WorldIndexEntry>()
  for (const entry of onDisk) byId.set(entry.id, entry)

  for (const lore of known) {
    const existing = byId.get(lore.id)
    if (existing) {
      byId.set(lore.id, { ...existing, name: lore.name })
    } else {
      byId.set(lore.id, { id: lore.id, name: lore.name, mirroredAt: null, appVersion })
    }
  }

  return Array.from(byId.values())
}

/** Set one world's mirroredAt, inserting the entry if absent. */
export function markWorldMirrored(
  index: WorldIndexEntry[],
  id: string,
  name: string,
  at: number,
  appVersion: string,
): WorldIndexEntry[] {
  const rest = index.filter((e) => e.id !== id)
  return [...rest, { id, name, mirroredAt: at, appVersion }]
}

/** Drop one world entirely — the only way an entry leaves the index. */
export function dropWorldFromIndex(index: WorldIndexEntry[], id: string): WorldIndexEntry[] {
  return index.filter((e) => e.id !== id)
}
