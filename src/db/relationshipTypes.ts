import { db, uid } from './schema'
import type { RelationshipGroup, RelationshipType } from './types'

// ---------------------------------------------------------------------------
// Relationship vocabulary (#175)
// ---------------------------------------------------------------------------
// The user-definable set of relationship kinds. Same vocabulary/content split
// as templates.ts vs pages.ts: this module owns the types, relationships.ts
// owns the edges that reference them, and the dependency runs one way.

/** The shipped starter vocabulary. `group` is what lets #136 ask "which of
 *  these are kinship?" without hardcoding ids — a user-defined "Half-sibling
 *  of" tagged 'kin' joins the family tree automatically. */
export const BUILTIN_RELATIONSHIP_TYPES: RelationshipType[] = [
  { id: 'parent-of', label: 'Parent of', inverse: 'Child of', color: '#e0a458', group: 'kin', order: 0, builtin: true },
  { id: 'sibling-of', label: 'Sibling of', inverse: 'Sibling of', color: '#d9c069', group: 'kin', order: 1, builtin: true },
  { id: 'spouse-of', label: 'Spouse of', inverse: 'Spouse of', color: '#c77e9c', group: 'kin', order: 2, builtin: true },
  { id: 'ally-of', label: 'Ally of', inverse: 'Ally of', color: '#7eb09b', group: 'faction', order: 3, builtin: true },
  { id: 'enemy-of', label: 'Enemy of', inverse: 'Enemy of', color: '#cf6f6f', group: 'faction', order: 4, builtin: true },
  { id: 'member-of', label: 'Member of', inverse: 'Has member', color: '#8aa4c7', group: 'org', order: 5, builtin: true },
]

/** The fields needed to create a custom type; the rest are derived. */
export interface NewRelationshipType {
  label: string
  inverse: string
  group: RelationshipGroup
  color?: string
}

/**
 * Add any missing built-ins. Runs the whole read-modify-write inside one rw
 * transaction so concurrent invocations serialize: React StrictMode
 * double-invokes the startup effect in dev, and without the transaction both
 * reads see an empty table, both bulkAdd the built-ins, and the loser rejects
 * with a duplicate-key BulkError. (Mirrors seedTemplates.)
 *
 * Unlike seedTemplates this does NOT remove built-ins that left the shipped
 * set — dropping a relationship type would orphan every row referencing it.
 * Custom types are never touched, and an edited built-in keeps its edits.
 */
export async function seedRelationshipTypes(): Promise<void> {
  await db.transaction('rw', db.relationshipTypes, async () => {
    const existing = new Set((await db.relationshipTypes.toArray()).map((t) => t.id))
    const missing = BUILTIN_RELATIONSHIP_TYPES.filter((t) => !existing.has(t.id))
    if (missing.length) await db.relationshipTypes.bulkAdd(missing)
  })
}

/** Every type, in display order. */
export async function getRelationshipTypes(): Promise<RelationshipType[]> {
  return db.relationshipTypes.orderBy('order').toArray()
}

/** Create a custom type. Appends at max(order)+1 rather than count, so creating
 *  a type after deleting one never collides with an existing order (the same
 *  reasoning as attachDocument). */
export async function createRelationshipType(input: NewRelationshipType): Promise<string> {
  const id = uid()
  const all = await db.relationshipTypes.toArray()
  const order = all.reduce((max, t) => Math.max(max, t.order + 1), 0)
  await db.relationshipTypes.add({
    id,
    label: input.label,
    inverse: input.inverse,
    color: input.color ?? '#a0a0a0',
    group: input.group,
    order,
    builtin: false,
  })
  return id
}

/** Edit a type. `id` and `builtin` are not editable — a built-in stays a
 *  built-in however it is relabelled, which is what keeps reset meaningful. */
export async function updateRelationshipType(
  id: string,
  changes: Partial<Omit<RelationshipType, 'id' | 'builtin'>>,
): Promise<void> {
  await db.relationshipTypes.update(id, changes)
}

/** How many relationships use this type — shown in the delete confirmation. */
export async function countRelationshipsOfType(id: string): Promise<number> {
  return db.relationships.where('typeId').equals(id).count()
}

/**
 * Delete a custom type and every relationship using it, in one transaction
 * (cascading like deleteCalendar does for its events). Built-ins are refused:
 * seedRelationshipTypes would re-add them on the next start, so offering the
 * delete would be a lie. The UI hides the control for built-ins; this guard is
 * the enforcement.
 */
export async function deleteRelationshipType(id: string): Promise<void> {
  await db.transaction('rw', [db.relationshipTypes, db.relationships], async () => {
    const type = await db.relationshipTypes.get(id)
    if (!type || type.builtin) return
    await db.relationships.where('typeId').equals(id).delete()
    await db.relationshipTypes.delete(id)
  })
}

/** Restore a built-in to its shipped labels, colour and group. No-op for a
 *  custom type, which has no shipped definition to restore. */
export async function resetRelationshipType(id: string): Promise<void> {
  const shipped = BUILTIN_RELATIONSHIP_TYPES.find((t) => t.id === id)
  if (!shipped) return
  await db.relationshipTypes.put({ ...shipped })
}
