import type { Relationship, RelationshipType } from './db'

// ---------------------------------------------------------------------------
// The direction rule (#175) — pure
// ---------------------------------------------------------------------------
// A relationship is stored once, directed. Which label a page sees depends on
// which end of the row that page is. This module is the ONLY place that
// inversion is derived: the page aside today, the family tree (#136) and the
// diplomacy web (#137) later all call resolveRelation rather than re-deriving
// it, because three copies of this rule is how two views end up disagreeing
// about what "parent" means.
//
// Type-only db imports, so this stays out of src/db/ (a runtime db import
// would drag in the Dexie singleton — see CLAUDE.md).

/** A relationship type is symmetric when it reads the same from both ends
 *  ("Ally of" / "Ally of"). Derived rather than stored: if both labels say the
 *  same thing, the relationship *is* symmetric, and no second field can
 *  contradict them. Load-bearing for duplicate detection — for a symmetric
 *  type, A→B and B→A are the same fact. */
export function isSymmetric(type: RelationshipType): boolean {
  return type.label.trim().toLowerCase() === type.inverse.trim().toLowerCase()
}

/** One relationship as a specific page sees it. */
export interface ResolvedRelation {
  row: Relationship
  type: RelationshipType
  /** How it reads from `viewerId`: the type's label or its inverse. */
  label: string
  /** The page at the far end. */
  otherId: string
}

/** Resolve `row` from `viewerId`'s point of view, or null when the viewer is on
 *  neither end (a caller bug, or a stale row — never render a guess). */
export function resolveRelation(
  row: Relationship,
  type: RelationshipType,
  viewerId: string,
): ResolvedRelation | null {
  if (viewerId === row.fromId) {
    return { row, type, label: type.label, otherId: row.toId }
  }
  if (viewerId === row.toId) {
    return { row, type, label: type.inverse, otherId: row.fromId }
  }
  return null
}
