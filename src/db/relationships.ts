import { db, uid, now } from './schema'
import { isSymmetric, resolveRelation, type ResolvedRelation } from '../relations'
import type { LorePage } from './types'

// ---------------------------------------------------------------------------
// Relationship edges (#175)
// ---------------------------------------------------------------------------
// One directed row per fact, indexed on both endpoints. A page's relations are
// read from BOTH directions and merged into a single list — see getRelationsFor
// for why that isn't the two-panel shape DocumentLinks uses.

/** A relationship as one page sees it, joined to the page at the far end. */
export interface PageRelation extends ResolvedRelation {
  other: LorePage
}

/**
 * Record that `fromId` is `typeId`'s label of `toId`. Returns the new row's id,
 * or null when refused. Guards live here rather than in the component so every
 * caller gets them (the same shape as attachDocument's no-op-on-self-or-dupe):
 *
 *  - self-relation: a page cannot be its own parent
 *  - exact duplicate (same from, to, type)
 *  - for a SYMMETRIC type, the reversed pair as well — "Igraine ally-of Uther"
 *    and "Uther ally-of Igraine" are one fact, and storing both would render
 *    the same line twice on both pages
 *  - an unknown type id, which would render as a blank label
 *
 * Not transactional: this is a single-tab app, and the worst case is a
 * duplicate row the user can delete.
 */
export async function addRelationship(
  fromId: string,
  toId: string,
  typeId: string,
  note = '',
): Promise<string | null> {
  if (fromId === toId) return null

  const type = await db.relationshipTypes.get(typeId)
  if (!type) return null

  const existing = await db.relationships.where('fromId').equals(fromId).toArray()
  if (existing.some((r) => r.toId === toId && r.typeId === typeId)) return null

  if (isSymmetric(type)) {
    const reversed = await db.relationships.where('fromId').equals(toId).toArray()
    if (reversed.some((r) => r.toId === fromId && r.typeId === typeId)) return null
  }

  const id = uid()
  await db.relationships.add({ id, fromId, toId, typeId, note, createdAt: now() })
  return id
}

/** Edit a row's free-text note. */
export async function updateRelationshipNote(id: string, note: string): Promise<void> {
  await db.relationships.update(id, { note })
}

/** Delete by row id — which works identically from either end, because there
 *  is only ever one row per fact. */
export async function removeRelationship(id: string): Promise<void> {
  await db.relationships.delete(id)
}

/**
 * Every relationship touching `pageId`, resolved to this page's point of view
 * and joined to the page at the far end, sorted by type order then title.
 *
 * ONE list, not the owning/reciprocal panels DocumentLinks shows. There, the
 * two directions genuinely differ to the reader. Here they do not: with inverse
 * labels, "Parent of ● Arthur" and "Child of ● Uther" are both simply relations
 * of this page, and splitting them would surface an implementation detail —
 * which end happened to be typed first — as a user-visible distinction.
 *
 * Rows whose far page is missing are skipped (defense in depth; deletePage
 * cascades, so this is rare).
 */
export async function getRelationsFor(pageId: string): Promise<PageRelation[]> {
  const [outgoing, incoming, types] = await Promise.all([
    db.relationships.where('fromId').equals(pageId).toArray(),
    db.relationships.where('toId').equals(pageId).toArray(),
    db.relationshipTypes.toArray(),
  ])
  const typeById = new Map(types.map((t) => [t.id, t]))

  // Resolve every row first, then fetch the far pages in ONE bulkGet. A hub
  // character carries many relations across kin/faction/org, so a per-row
  // db.pages.get() would be that many sequential round-trips on every page load.
  const resolved = [...outgoing, ...incoming].flatMap((row) => {
    const type = typeById.get(row.typeId)
    if (!type) return []
    const r = resolveRelation(row, type, pageId)
    return r ? [r] : []
  })

  const otherIds = [...new Set(resolved.map((r) => r.otherId))]
  const pages = await db.pages.bulkGet(otherIds)
  const pageById = new Map(
    pages.flatMap((p) => (p ? [[p.id, p] as const] : [])),
  )

  const out: PageRelation[] = resolved.flatMap((r) => {
    const other = pageById.get(r.otherId)
    return other ? [{ ...r, other }] : []
  })

  out.sort(
    (a, b) =>
      a.type.order - b.type.order ||
      a.other.title.toLowerCase().localeCompare(b.other.title.toLowerCase()),
  )
  return out
}
