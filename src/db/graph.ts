import { linkedTitles } from './pages'
import { pageStatus } from './schema'
import { isSymmetric, resolveRelation } from '../relations'
import type { LorePage, Relationship, RelationshipType, RelationshipGroup } from './types'

// ---------------------------------------------------------------------------
// Relationship graph — nodes (pages) and edges (resolved links between them)
// ---------------------------------------------------------------------------

/** One page as a graph node. `degree` is the number of distinct pages it is
 *  connected to (in either direction) and drives the node's drawn size. */
export interface GraphNode {
  id: string
  title: string
  category: string
  tags: string[]
  /** Development status (Stub/Draft/Complete); '' for ghost nodes. Drives the
   *  status filter. */
  status: string
  degree: number
  /** True for synthetic nodes standing in for links to pages that don't exist yet. */
  ghost?: boolean
}

/** One relationship on a pair, pre-resolved to the drawn edge's orientation.
 *
 *  Both readings are stored because the *drawn* orientation can still change
 *  after this point: hiding the type that oriented the edge promotes another,
 *  possibly stored the other way round, and `linkStyle` swaps the edge to keep
 *  the arrow forward. A single resolved label would then read backwards. */
export interface RelationEdge {
  typeId: string
  group: RelationshipGroup
  color: string
  /** Reads along source → target: "Parent of". */
  label: string
  /** Reads along target → source: "Child of". Equal to `label` when symmetric. */
  inverseLabel: string
  /** False for a symmetric type — an arrow would assert a direction it denies. */
  directed: boolean
  /** The stored row runs against this edge's orientation. */
  reversed: boolean
  order: number
}

/** One edge between two existing pages. `source`/`target` keep the original
 *  link direction so directional arrows can be drawn when enabled — unless the
 *  pair carries relationships, in which case the lowest-order relationship
 *  orients the edge instead. `mutual` is true when both pages link to each
 *  other (A→B and B→A), which tends to mark the stronger relationships and is
 *  styled more prominently; it is ignored for styling once `relations` is
 *  non-empty, because a typed edge is styled by its type. Always false for
 *  ghost edges (a missing page can't link back). */
export interface GraphLink {
  source: string
  target: string
  mutual: boolean
  /** A resolved wiki link exists for this pair, in either direction. Lets a
   *  hidden relationship type fall back to wiki styling instead of vanishing. */
  wiki: boolean
  /** Every relationship on this pair, lowest `type.order` first. */
  relations: RelationEdge[]
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

/** A link endpoint is an id string before the force simulation runs, but the
 *  renderer (ForceGraph2D) mutates it into the resolved node object afterwards,
 *  so consumers of drawn links may see either shape. */
type LinkEnd = string | { id: string }

function endId(end: LinkEnd): string {
  return typeof end === 'object' ? end.id : end
}

/** Canonical key for an undirected edge: the same pair of ids always produces
 *  the same key regardless of which end is the source. Lets a drawn link be
 *  matched against a path whose hops may run the other way. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

// Category sentinel for ghost nodes — they branch on the `ghost` flag, not this,
// so it stays internal and is excluded from the toolbar's category list.
const GHOST_CATEGORY = '__ghost__'

// linkedTitles() lowercases every title, so a ghost's display label is recovered
// by title-casing the link text (mordor → Mordor, the shire → The Shire).
function prettyTitle(lower: string): string {
  return lower.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Build the relationship graph from the full page list.
 *
 *  Every page becomes a node (pages with no links show as lone dots, which is
 *  intentional — it surfaces isolated pages). Each page's linked titles are
 *  resolved against a title→id map; a link to an existing page becomes a real
 *  edge; a link to a missing page becomes a ghost node + ghost edge. Self-links
 *  are dropped and A↔B collapses to a single edge regardless of direction.
 *  `degree` counts distinct real neighbours (ghost links don't affect real-node
 *  degree). Ghost node `degree` counts distinct real pages linking to it.
 *
 *  Relationship rows (#175) are a second, independent edge source merged in
 *  after the wiki pass: a pair with any relationship draws as one typed edge,
 *  a relationship implies no wiki link (so it can connect pages the wiki graph
 *  shows as isolated), and `degree` counts relationship neighbours. */
export function buildGraphData(
  pages: LorePage[],
  relationships: Relationship[],
  types: RelationshipType[],
): GraphData {
  const idByTitle = new Map<string, string>()
  for (const p of pages) idByTitle.set(p.title.trim().toLowerCase(), p.id)

  const neighbours = new Map<string, Set<string>>()
  for (const p of pages) neighbours.set(p.id, new Set())

  // Distinct real pages linking to each unresolved title → drives ghost size.
  const ghostLinkers = new Map<string, Set<string>>()

  const byKey = new Map<string, GraphLink>() // undirected edge key "a|b" (a < b) → edge
  const directed = new Set<string>() // every seen "src>tgt" real direction
  const links: GraphLink[] = []

  for (const page of pages) {
    for (const title of linkedTitles(page)) {
      const targetId = idByTitle.get(title)
      if (targetId === page.id) continue // self-link
      if (!targetId) {
        // Missing page → ghost edge (page → ghost), one ghost per lowercased title.
        const ghostId = `ghost:${title}`
        let linkers = ghostLinkers.get(ghostId)
        if (!linkers) {
          linkers = new Set()
          ghostLinkers.set(ghostId, linkers)
        }
        if (!linkers.has(page.id)) {
          linkers.add(page.id)
          links.push({ source: page.id, target: ghostId, mutual: false, wiki: true, relations: [] })
        }
        continue
      }
      directed.add(`${page.id}>${targetId}`)
      const key = edgeKey(page.id, targetId)
      if (!byKey.has(key)) {
        const edge: GraphLink = { source: page.id, target: targetId, mutual: false, wiki: true, relations: [] }
        byKey.set(key, edge)
        links.push(edge)
      }
      neighbours.get(page.id)!.add(targetId)
      neighbours.get(targetId)!.add(page.id)
    }
  }

  // A real edge is mutual when both directions were linked. Ghost edges keep
  // mutual:false — the missing target can't link back.
  for (const edge of byKey.values()) {
    edge.mutual = directed.has(`${edge.source}>${edge.target}`) && directed.has(`${edge.target}>${edge.source}`)
  }

  // ---- Relationship pass (#137) ----
  // A second, independent edge source. Typed edges win: a pair with any
  // relationship is styled by its type rather than by wiki reciprocity.
  const typeById = new Map(types.map((t) => [t.id, t]))
  const pageIds = new Set(pages.map((p) => p.id))

  // Group usable rows by unordered pair. Rows are dropped rather than rendered
  // when they cannot produce a sane edge — the write path already refuses all
  // three, but import is a second entry point and this is the render boundary.
  // No ghost node is ever created: a ghost stands in for a *title*, and a
  // relationship stores ids, so a dangling id has nothing to display.
  const rowsByPair = new Map<string, Relationship[]>()
  for (const row of relationships) {
    if (row.fromId === row.toId) continue
    if (!pageIds.has(row.fromId) || !pageIds.has(row.toId)) continue
    if (!typeById.has(row.typeId)) continue
    const key = edgeKey(row.fromId, row.toId)
    let list = rowsByPair.get(key)
    if (!list) rowsByPair.set(key, (list = []))
    list.push(row)
  }

  for (const [key, rows] of rowsByPair) {
    // Lowest type.order first; type id breaks ties so an unrelated edit can
    // never reshuffle which type colours the edge — the same determinism
    // connectedComponents and shortestPath commit to.
    rows.sort((a, b) => {
      const ta = typeById.get(a.typeId)!
      const tb = typeById.get(b.typeId)!
      return ta.order - tb.order || (ta.id < tb.id ? -1 : ta.id > tb.id ? 1 : 0)
    })

    // Orient from the lowest-order row, unconditionally — including over a wiki
    // edge that ran the other way, and including for a symmetric type. Safe
    // because every other consumer (edgeKey, degree, BFS, the depth filter)
    // treats edges as undirected, and a typed edge's arrow is governed by its
    // type rather than by the wiki `showArrows` toggle.
    const primary = rows[0]
    const source = primary.fromId
    const target = primary.toId

    const relations: RelationEdge[] = rows.flatMap((row) => {
      const type = typeById.get(row.typeId)!
      const forward = resolveRelation(row, type, source)
      const backward = resolveRelation(row, type, target)
      // resolveRelation returns null only when the viewer is on neither end,
      // which the pair grouping makes impossible; guarded rather than asserted
      // so a future grouping change fails quietly instead of rendering a guess.
      if (!forward || !backward) return []
      return [{
        typeId: type.id,
        group: type.group,
        color: type.color,
        label: forward.label,
        inverseLabel: backward.label,
        directed: !isSymmetric(type),
        reversed: row.fromId !== source,
        order: type.order,
      }]
    })

    const existing = byKey.get(key)
    if (existing) {
      existing.source = source
      existing.target = target
      existing.relations = relations
    } else {
      links.push({ source, target, mutual: false, wiki: false, relations })
    }
    neighbours.get(source)!.add(target)
    neighbours.get(target)!.add(source)
  }

  const nodes: GraphNode[] = pages.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    tags: p.tags,
    status: pageStatus(p),
    degree: neighbours.get(p.id)!.size,
  }))

  for (const [ghostId, linkers] of ghostLinkers) {
    nodes.push({
      id: ghostId,
      title: prettyTitle(ghostId.slice('ghost:'.length)),
      category: GHOST_CATEGORY,
      tags: [],
      status: '',
      degree: linkers.size,
      ghost: true,
    })
  }

  return { nodes, links }
}

/** The set of node ids within `hops` edges of `startId` (inclusive of the start),
 *  walking links as undirected. `hops` of 0 returns just the start; a start id
 *  absent from the graph returns just itself. Used by the graph's depth filter to
 *  show only the neighbourhood around a focused node. */
export function nodesWithinHops(
  links: Pick<GraphLink, 'source' | 'target'>[],
  startId: string,
  hops: number,
): Set<string> {
  const adj = new Map<string, Set<string>>()
  const link = (a: string, b: string) => {
    let set = adj.get(a)
    if (!set) adj.set(a, (set = new Set()))
    set.add(b)
  }
  for (const l of links) {
    link(l.source, l.target)
    link(l.target, l.source)
  }

  const visited = new Set<string>([startId])
  let frontier = [startId]
  for (let d = 0; d < hops && frontier.length > 0; d++) {
    const next: string[] = []
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (!visited.has(nb)) {
          visited.add(nb)
          next.push(nb)
        }
      }
    }
    frontier = next
  }
  return visited
}

/** Partition the given node ids into connected components, treating links as
 *  undirected. Returns `componentOf` (node id → component rank) and `sizes`
 *  (rank → node count). Components are ranked by size descending; equal-size
 *  components are ordered by their smallest member id (ascending), so the result
 *  is deterministic — no dependence on iteration order or randomness. Link
 *  endpoints absent from `nodeIds` are ignored, so callers can pass filtered
 *  links without pre-scrubbing them. Used by the graph's "island" colour mode to
 *  give each disconnected sub-region its own colour. */
export function connectedComponents(
  nodeIds: string[],
  links: { source: LinkEnd; target: LinkEnd }[],
): { componentOf: Map<string, number>; sizes: number[] } {
  const present = new Set(nodeIds)
  const adj = new Map<string, Set<string>>()
  for (const id of nodeIds) adj.set(id, new Set())
  for (const l of links) {
    const s = endId(l.source)
    const t = endId(l.target)
    if (!present.has(s) || !present.has(t)) continue
    adj.get(s)!.add(t)
    adj.get(t)!.add(s)
  }

  // Flood-fill each unvisited node into a component (list of member ids).
  const seen = new Set<string>()
  const groups: string[][] = []
  for (const start of nodeIds) {
    if (seen.has(start)) continue
    const members: string[] = []
    const stack = [start]
    seen.add(start)
    while (stack.length > 0) {
      const id = stack.pop()!
      members.push(id)
      for (const nb of adj.get(id)!) {
        if (!seen.has(nb)) {
          seen.add(nb)
          stack.push(nb)
        }
      }
    }
    groups.push(members)
  }

  // Rank by size desc, then by smallest member id asc for a stable tie-break.
  const minId = (g: string[]) => g.reduce((m, id) => (id < m ? id : m), g[0])
  groups.sort((a, b) => b.length - a.length || (minId(a) < minId(b) ? -1 : 1))

  const componentOf = new Map<string, number>()
  const sizes: number[] = []
  groups.forEach((g, rank) => {
    sizes.push(g.length)
    for (const id of g) componentOf.set(id, rank)
  })
  return { componentOf, sizes }
}

/** The shortest chain of node ids from `fromId` to `toId` (inclusive of both),
 *  treating links as undirected like the rest of the graph, or null when no
 *  chain exists.
 *
 *  Neighbours are expanded in id order, so the same pair always yields the same
 *  chain even when unrelated edits reshuffle the link array — the same kind of
 *  stable tie-break `connectedComponents` makes. When several chains tie on
 *  length, one is returned rather than all: a hub in the middle can produce
 *  dozens of equal-length chains, and their union is the hairball the highlight
 *  exists to cut through.
 *
 *  A page with no links never enters the adjacency map, so an isolated page
 *  simply has no path — no special case needed.
 *
 *  Endpoints are read through `endId`, so this works on both the pre-simulation
 *  links (id strings) and the drawn links the force sim has mutated in place to
 *  resolved node objects — the same dual shape `connectedComponents` accepts. */
export function shortestPath(
  links: { source: LinkEnd; target: LinkEnd }[],
  fromId: string,
  toId: string,
): string[] | null {
  if (fromId === toId) return [fromId]

  const adj = new Map<string, string[]>()
  const link = (a: string, b: string) => {
    let list = adj.get(a)
    if (!list) adj.set(a, (list = []))
    list.push(b)
  }
  for (const l of links) {
    const s = endId(l.source)
    const t = endId(l.target)
    link(s, t)
    link(t, s)
  }
  for (const list of adj.values()) list.sort()

  // BFS, remembering the node each node was first reached from, so the chain can
  // be walked back once the target is hit.
  const cameFrom = new Map<string, string>()
  const seen = new Set<string>([fromId])
  let frontier = [fromId]
  while (frontier.length > 0) {
    const next: string[] = []
    for (const id of frontier) {
      for (const nb of adj.get(id) ?? []) {
        if (seen.has(nb)) continue
        seen.add(nb)
        cameFrom.set(nb, id)
        if (nb === toId) {
          const chain = [toId]
          for (let cur = toId; ; ) {
            const prev = cameFrom.get(cur)
            if (prev === undefined) break
            chain.push(prev)
            cur = prev
          }
          return chain.reverse()
        }
        next.push(nb)
      }
    }
    frontier = next
  }
  return null
}

/** The outcome of a path query. `hidden` means the drawn graph has no chain but
 *  the unfiltered one does — the user's filters are hiding the answer, which is
 *  a different thing from the pages being unconnected. */
export type PathResult =
  | { kind: 'path'; nodes: string[] }
  | { kind: 'hidden' }
  | { kind: 'none' }

/** Search the *drawn* graph, so every highlighted hop is a link actually on
 *  screen, and consult the full graph only to choose the message. */
export function findPath(
  drawnLinks: { source: LinkEnd; target: LinkEnd }[],
  fullLinks: { source: LinkEnd; target: LinkEnd }[],
  fromId: string,
  toId: string,
): PathResult {
  const drawn = shortestPath(drawnLinks, fromId, toId)
  if (drawn) return { kind: 'path', nodes: drawn }
  return shortestPath(fullLinks, fromId, toId) ? { kind: 'hidden' } : { kind: 'none' }
}
