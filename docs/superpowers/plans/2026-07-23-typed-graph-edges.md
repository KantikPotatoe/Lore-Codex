# Typed Graph Edges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the 2D relationship graph and the PNG/SVG export draw the typed relationships shipped in #175 — coloured by type, filterable by type and group, labelled on hover.

**Architecture:** `buildGraphData` gains relationship rows and the type vocabulary as required inputs and merges them into the existing wiki-link edges, one edge per unordered pair, typed edges winning. All rest-state link styling moves into one pure `linkStyle()` in `src/graphColor.ts`; `GraphRoute`'s filter memo calls it once and spreads the result onto each drawn link, so `GraphView` and `graphExport.buildScene` both read precomputed presentation instead of re-deriving it (killing an existing hand-mirroring drift between those two files).

**Tech Stack:** TypeScript (strict), React 18, Dexie + dexie-react-hooks (`useLiveQuery`), react-force-graph-2d, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md`

## Global Constraints

- **Import from the barrel.** UI and helper modules import data-layer API from `'../db'` / `'./db'`, never from a `src/db/*` file directly. New public data-layer API must be reachable through `src/db/index.ts`.
- **Repository seam.** Components, routes and hooks reach data through `pageRepo` / `relationshipRepo` / etc. — never the `db` singleton. Lint-enforced via `no-restricted-imports`.
- **`src/db/graph.ts` stays pure.** No React, no Dexie, no `db` import. It takes plain arrays and returns plain data.
- **`src/graphColor.ts` stays pure.** Type-only imports from `./db`; no runtime Dexie import.
- **TypeScript `strict`.** No `any`. No non-null assertion on a value that can genuinely be undefined.
- **Verification gate:** `npm run lint && npm run build && npm run test:run` must all pass before the PR.
- **PR label:** `version:minor` (new feature). Branch is `feat/137-typed-graph-edges`, already created off `origin/main`.
- **Commit trailer:** every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Do not touch:** `GraphView3D.tsx`, `worldHealth.ts`, `htmlExport.ts`, `src/db/backup.ts`. All explicitly out of scope (spec §8).

## File Structure

| File | Responsibility |
|---|---|
| `src/db/relationships.ts` | + `getAllRelationships()` — whole-table read |
| `src/db/repositories.ts` | + `relationshipRepo.listAll()` — the UI's only route to it |
| `src/db/barrel.test.ts` | pins the new name into the public surface |
| `src/db/graph.ts` | `RelationEdge`, `GraphLink.wiki` / `.relations`, the merge pass |
| `src/graphColor.ts` | `ArrowMode`, `LinkStyle`, `DrawnLink`, `withAlpha`, `linkStyle` — the one styling authority |
| `src/useGraphPrefs.ts` | `hiddenRelTypes` persistence + `toggleRelType` / `toggleRelGroup` |
| `src/routes/GraphRoute.tsx` | live reads, applies `linkStyle` in the filter memo, renders the chip block |
| `src/components/GraphView.tsx` | reads precomputed style; hover labels; arrow modes |
| `src/graphExport.ts` | reads precomputed style; deletes the mirrored constants |
| `src/index.css` | chip-group styling |

---

### Task 1: Whole-table relationship read behind the repo seam

**Files:**
- Modify: `src/db/relationships.ts` (append at end of file)
- Modify: `src/db/repositories.ts`
- Test: `src/db/barrel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `getAllRelationships(): Promise<Relationship[]>` and `relationshipRepo.listAll(): Promise<Relationship[]>`. Task 2 consumes `listAll()` from `GraphRoute`.

- [ ] **Step 1: Add the name to the barrel test (the failing test)**

In `src/db/barrel.test.ts`, find the `EXPECTED_FUNCTIONS` array and the line listing the relationships module's exports. Add `'getAllRelationships'` to it:

```ts
  // relationships.ts
  'addRelationship', 'updateRelationshipNote', 'removeRelationship', 'getRelationsFor',
  'getAllRelationships',
```

If the relationships entries are on a differently-shaped line, add `'getAllRelationships'` alongside `'getRelationsFor'` — do not reorder the existing names.

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/db/barrel.test.ts`
Expected: FAIL — the barrel is missing the export `getAllRelationships`.

- [ ] **Step 3: Implement `getAllRelationships`**

Append to `src/db/relationships.ts`:

```ts
/** Every relationship row, unresolved and unsorted — the graph's edge source.
 *
 *  Deliberately raw, unlike getRelationsFor: the graph resolves each row
 *  against a *drawn edge's* orientation rather than a viewing page's, so
 *  per-page resolution here would be thrown away. `buildGraphData` does the
 *  resolving, through the same resolveRelation() helper. */
export async function getAllRelationships(): Promise<Relationship[]> {
  return db.relationships.toArray()
}
```

Add `Relationship` to the existing type import at the top of the file:

```ts
import type { LorePage, Relationship } from './types'
```

- [ ] **Step 4: Surface it on the repository**

In `src/db/repositories.ts`, add to the `import { ... } from './relationships'` block:

```ts
  getAllRelationships,
```

Add to the `RelationshipRepository` interface, directly above `listFor`:

```ts
  /** Every relationship row in the world — the graph's edge source (#137). */
  listAll(): Promise<Relationship[]>
```

Add to the `relationshipRepo` object literal, directly above `listFor`:

```ts
  listAll: getAllRelationships,
```

If `Relationship` is not already in the `from './types'` type import at the top of `repositories.ts`, add it.

- [ ] **Step 5: Run the tests and make sure they pass**

Run: `npx vitest run src/db/barrel.test.ts && npx tsc -b`
Expected: barrel test PASSES, tsc reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/relationships.ts src/db/repositories.ts src/db/barrel.test.ts
git commit -m "feat: expose a whole-table relationship read for the graph (#137)

Mirrors manuscriptRepo.listAllScenes(): a raw table read behind the repo
seam, for a route that needs every row rather than one page's view.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Merge relationship rows into the graph

**Files:**
- Modify: `src/db/graph.ts`
- Modify: `src/routes/GraphRoute.tsx:1-3, 25-27`
- Modify: `src/db/import-sanitize.test.ts:126`
- Test: `src/db/graph.test.ts`

**Interfaces:**
- Consumes: `relationshipRepo.listAll()` (Task 1), `relationshipRepo.listTypes()` (already exists).
- Produces:
  - `buildGraphData(pages: LorePage[], relationships: Relationship[], types: RelationshipType[]): GraphData`
  - `interface RelationEdge { typeId: string; group: RelationshipGroup; color: string; label: string; inverseLabel: string; directed: boolean; reversed: boolean; order: number }`
  - `GraphLink` gains `wiki: boolean` and `relations: RelationEdge[]`.
  - Task 3 reads `link.wiki`, `link.mutual` and `link.relations`; Task 3 relies on `relations` being pre-sorted lowest-`order`-first.

- [ ] **Step 1: Write the failing tests**

In `src/db/graph.test.ts`, add these imports to the existing import line from `'../db'`: `type Relationship`, `type RelationshipType`. Then add these helpers immediately after the existing `link()` helper:

```ts
/** A relationship type; `inverse` equal to `label` makes it symmetric. */
function relType(id: string, label: string, inverse: string, opts: Partial<RelationshipType> = {}): RelationshipType {
  return { id, label, inverse, color: '#e0a458', group: 'kin', order: 0, builtin: false, ...opts }
}
function rel(id: string, fromId: string, toId: string, typeId: string): Relationship {
  return { id, fromId, toId, typeId, note: '', createdAt: 0 }
}
const PARENT = relType('parent-of', 'Parent of', 'Child of', { order: 0 })
const ALLY = relType('ally-of', 'Ally of', 'Ally of', { color: '#7eb09b', group: 'faction', order: 3 })
```

Then add this describe block at the end of the file:

```ts
describe('buildGraphData relationship edges', () => {
  const A = page('a', 'A')
  const B = page('b', 'B')

  it('creates an edge for a relationship with no wiki link between the pages', () => {
    const data = buildGraphData([A, B], [rel('r1', 'a', 'b', 'parent-of')], [PARENT])
    expect(data.links).toHaveLength(1)
    expect(data.links[0].wiki).toBe(false)
    expect(data.links[0].source).toBe('a')
    expect(data.links[0].target).toBe('b')
    expect(data.links[0].relations.map((r) => r.typeId)).toEqual(['parent-of'])
  })

  it('raises degree, so a relationship-only page is not isolated', () => {
    const data = buildGraphData([A, B], [rel('r1', 'a', 'b', 'parent-of')], [PARENT])
    expect(data.nodes.find((n) => n.id === 'a')!.degree).toBe(1)
    expect(data.nodes.find((n) => n.id === 'b')!.degree).toBe(1)
  })

  it('collapses a relationship and a wiki link on the same pair into one edge', () => {
    const data = buildGraphData(
      [page('a', 'A', { content: link('B') }), B],
      [rel('r1', 'a', 'b', 'parent-of')],
      [PARENT],
    )
    expect(data.links).toHaveLength(1)
    expect(data.links[0].wiki).toBe(true)
    expect(data.links[0].relations).toHaveLength(1)
  })

  it('orders relations by type order', () => {
    const data = buildGraphData(
      [A, B],
      [rel('r1', 'a', 'b', 'ally-of'), rel('r2', 'a', 'b', 'parent-of')],
      [ALLY, PARENT],
    )
    expect(data.links[0].relations.map((r) => r.typeId)).toEqual(['parent-of', 'ally-of'])
  })

  it('breaks an order tie by type id, so the colour never reshuffles', () => {
    // Same order; only the id can decide. Rows are supplied in the reverse of
    // the expected result, so a stable-sort no-op would fail this.
    const zeta = relType('zeta', 'Zeta of', 'Zeta by', { order: 7 })
    const alpha = relType('alpha', 'Alpha of', 'Alpha by', { order: 7 })
    const data = buildGraphData(
      [A, B],
      [rel('r1', 'a', 'b', 'zeta'), rel('r2', 'a', 'b', 'alpha')],
      [zeta, alpha],
    )
    expect(data.links[0].relations.map((r) => r.typeId)).toEqual(['alpha', 'zeta'])
  })

  it('orients the edge from the lowest-order row and flags the others reversed', () => {
    // ally-of is stored b→a, parent-of a→b. parent-of has the lower order, so
    // the edge runs a→b and the ally row is against that orientation.
    const data = buildGraphData(
      [A, B],
      [rel('r1', 'b', 'a', 'ally-of'), rel('r2', 'a', 'b', 'parent-of')],
      [ALLY, PARENT],
    )
    const edge = data.links[0]
    expect(edge.source).toBe('a')
    expect(edge.target).toBe('b')
    expect(edge.relations.find((r) => r.typeId === 'parent-of')!.reversed).toBe(false)
    expect(edge.relations.find((r) => r.typeId === 'ally-of')!.reversed).toBe(true)
  })

  it('stores both readings: label along the edge, inverseLabel against it', () => {
    const data = buildGraphData([A, B], [rel('r1', 'a', 'b', 'parent-of')], [PARENT])
    const r = data.links[0].relations[0]
    expect(r.label).toBe('Parent of')
    expect(r.inverseLabel).toBe('Child of')
    expect(r.directed).toBe(true)
  })

  it('gives a symmetric type the same text both ways and marks it undirected', () => {
    const data = buildGraphData([A, B], [rel('r1', 'a', 'b', 'ally-of')], [ALLY])
    const r = data.links[0].relations[0]
    expect(r.label).toBe('Ally of')
    expect(r.inverseLabel).toBe('Ally of')
    expect(r.directed).toBe(false)
  })

  it('reads a reversed row from the drawn edge, not from storage', () => {
    // Only row runs b→a, so the edge runs b→a and reads "Parent of" forward.
    const data = buildGraphData([A, B], [rel('r1', 'b', 'a', 'parent-of')], [PARENT])
    const edge = data.links[0]
    expect(edge.source).toBe('b')
    expect(edge.relations[0].label).toBe('Parent of')
    expect(edge.relations[0].inverseLabel).toBe('Child of')
    expect(edge.relations[0].reversed).toBe(false)
  })

  it('drops unusable rows: self, unknown type, missing endpoint', () => {
    const data = buildGraphData(
      [A, B],
      [
        rel('r1', 'a', 'a', 'parent-of'),
        rel('r2', 'a', 'b', 'no-such-type'),
        rel('r3', 'a', 'gone', 'parent-of'),
      ],
      [PARENT],
    )
    expect(data.links).toEqual([])
    expect(data.nodes.every((n) => n.degree === 0)).toBe(true)
  })

  it('never creates a ghost node from a relationship', () => {
    const data = buildGraphData([A], [rel('r1', 'a', 'gone', 'parent-of')], [PARENT])
    expect(data.nodes.some((n) => n.ghost)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/graph.test.ts`
Expected: FAIL — `buildGraphData` takes 1 argument but 3 were provided; `relations` does not exist on `GraphLink`.

- [ ] **Step 3: Add the new types and the merge pass**

In `src/db/graph.ts`, extend the imports at the top:

```ts
import { linkedTitles } from './pages'
import { pageStatus } from './schema'
import { isSymmetric, resolveRelation } from '../relations'
import type { LorePage, Relationship, RelationshipType, RelationshipGroup } from './types'
```

(`../relations` holds no runtime `db` import, so this creates no cycle — `src/db/relationships.ts` already imports from it the same way.)

Replace the `GraphLink` interface and its doc comment with:

```ts
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
```

Change the signature and doc of `buildGraphData`. Replace the line `export function buildGraphData(pages: LorePage[]): GraphData {` with:

```ts
export function buildGraphData(
  pages: LorePage[],
  relationships: Relationship[],
  types: RelationshipType[],
): GraphData {
```

And extend its doc comment by appending this paragraph before the closing `*/`:

```
 *  Relationship rows (#175) are a second, independent edge source merged in
 *  after the wiki pass: a pair with any relationship draws as one typed edge,
 *  a relationship implies no wiki link (so it can connect pages the wiki graph
 *  shows as isolated), and `degree` counts relationship neighbours.
```

In the wiki pass, add the two new fields to both places an edge is constructed.
Replace:

```ts
          links.push({ source: page.id, target: ghostId, mutual: false })
```

with:

```ts
          links.push({ source: page.id, target: ghostId, mutual: false, wiki: true, relations: [] })
```

Replace:

```ts
        const edge: GraphLink = { source: page.id, target: targetId, mutual: false }
```

with:

```ts
        const edge: GraphLink = { source: page.id, target: targetId, mutual: false, wiki: true, relations: [] }
```

Then insert the whole relationship pass **after** the `for (const edge of byKey.values())` mutual loop and **before** `const nodes: GraphNode[] = pages.map(...)`. Order is load-bearing twice: after the mutual loop, so flipping an edge's orientation cannot corrupt the `directed` lookups that loop performs; before the node build, so `degree` sees relationship neighbours.

```ts
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
```

- [ ] **Step 4: Update the existing assertions that pin the exact link shape**

Five assertions in `src/db/graph.test.ts` compare links with `toEqual` and now need the two new fields. Update each:

- line ~49: `expect(data.links).toEqual([{ source: 'a', target: 'b', mutual: false, wiki: true, relations: [] }])`
- line ~60: `expect(data.links).toEqual([{ source: 'a', target: 'ghost:ghost', mutual: false, wiki: true, relations: [] }])`
- line ~115: `expect(data.links).toEqual([{ source: 'a', target: 'g', mutual: false, wiki: true, relations: [] }])`
- line ~123: `expect(data.links).toEqual([{ source: 'a', target: 'b', mutual: false, wiki: true, relations: [] }])`
- line ~153: `expect(links).toContainEqual({ source: 'a', target: 'ghost:mordor', mutual: false, wiki: true, relations: [] })`

Every other `buildGraphData(...)` call in that file needs the two new arguments — append `, [], []` to each. There are fifteen in `graph.test.ts` (lines 38, 45, 55, 64, 70, 81, 89, 100, 111, 119, 147, 161, 168, 177, 185 before your edits shift them); `npx tsc -b` lists any missed.

Also update the one call in `src/db/import-sanitize.test.ts:126`:

```ts
    expect(() => buildGraphData(pages, [], [])).not.toThrow()
```

- [ ] **Step 5: Wire the live reads in GraphRoute**

In `src/routes/GraphRoute.tsx`, add `relationshipRepo` to the existing import from `'../db'`. Add these module-level constants next to the existing `const NO_PAGES: LorePage[] = []`:

```ts
const NO_RELATIONSHIPS: Relationship[] = []
const NO_REL_TYPES: RelationshipType[] = []
```

Add `type Relationship, type RelationshipType` to the `'../db'` import as well.

Then replace:

```ts
  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES

  const full = useMemo(() => buildGraphData(pages), [pages])
```

with:

```ts
  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES
  const relationships = useLiveQuery(() => relationshipRepo.listAll(), []) ?? NO_RELATIONSHIPS
  const relTypes = useLiveQuery(() => relationshipRepo.listTypes(), []) ?? NO_REL_TYPES

  const full = useMemo(
    () => buildGraphData(pages, relationships, relTypes),
    [pages, relationships, relTypes],
  )
```

The stable module-level fallbacks matter: a fresh `[]` on each render would bust the memo every frame while the queries resolve and reheat the force simulation.

- [ ] **Step 6: Run the tests and the build**

Run: `npx vitest run src/db/ && npx tsc -b && npm run lint`
Expected: all graph tests PASS, tsc clean, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/graph.ts src/db/graph.test.ts src/db/import-sanitize.test.ts src/routes/GraphRoute.tsx
git commit -m "feat: merge typed relationships into the graph builder (#137)

One edge per unordered pair, oriented by the lowest-order relationship.
degree now counts relationship neighbours, so a page connected only by
relationships stops reading as isolated. Styling comes next.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `linkStyle` — the one styling authority

**Files:**
- Modify: `src/graphColor.ts`
- Test: `src/graphColor.test.ts`

**Interfaces:**
- Consumes: `GraphLink`, `RelationEdge` from Task 2. Relies on `link.relations` being sorted lowest-`order`-first, so `visible[0]` is the primary.
- Produces:
  - `type ArrowMode = 'always' | 'never' | 'toggle'`
  - `interface LinkStyle { source: string; target: string; color: string; activeColor: string; width: number; arrow: ArrowMode; labels: string }`
  - `type DrawnLink = GraphLink & LinkStyle`
  - `interface DrawnGraphData { nodes: GraphNode[]; links: DrawnLink[] }`
  - `withAlpha(hex: string, alpha: number): string`
  - `linkStyle(link: GraphLink, hiddenRelTypes: Set<string>): LinkStyle | null`
- Task 5 spreads `LinkStyle` onto drawn links; Tasks 5 and 6 read `color` / `activeColor` / `width` / `arrow` / `labels`.

- [ ] **Step 1: Write the failing tests**

Append to `src/graphColor.test.ts`. Extend the top imports first:

```ts
import { nodeFill, linkStyle, withAlpha, TAG_ACCENT, MUTED, ISLAND_PALETTE, islandColorOf } from './graphColor'
import { categoryColor, statusColor, type GraphNode, type GraphLink, type RelationEdge } from './db'
```

Then append:

```ts
function relation(overrides: Partial<RelationEdge> = {}): RelationEdge {
  return {
    typeId: 'parent-of', group: 'kin', color: '#e0a458',
    label: 'Parent of', inverseLabel: 'Child of',
    directed: true, reversed: false, order: 0, ...overrides,
  }
}
function graphLink(overrides: Partial<GraphLink> = {}): GraphLink {
  return { source: 'a', target: 'b', mutual: false, wiki: true, relations: [], ...overrides }
}
const NONE_HIDDEN = new Set<string>()

describe('withAlpha', () => {
  it('converts a six-digit hex to rgba', () => {
    expect(withAlpha('#e0a458', 0.75)).toBe('rgba(224, 164, 88, 0.75)')
  })

  it('returns non-hex input unchanged, so a hand-edited colour cannot blank an edge', () => {
    expect(withAlpha('tomato', 0.5)).toBe('tomato')
  })
})

describe('linkStyle', () => {
  it('styles a wiki-only one-way link as today, arrows following the toggle', () => {
    const s = linkStyle(graphLink(), NONE_HIDDEN)!
    expect(s.width).toBe(1)
    expect(s.arrow).toBe('toggle')
    expect(s.labels).toBe('')
  })

  it('styles a mutual wiki link thicker and bluer than a one-way one', () => {
    const mutual = linkStyle(graphLink({ mutual: true }), NONE_HIDDEN)!
    const oneWay = linkStyle(graphLink(), NONE_HIDDEN)!
    expect(mutual.width).toBeGreaterThan(oneWay.width)
    expect(mutual.color).not.toBe(oneWay.color)
  })

  it('takes the primary relation colour, at full strength when lit', () => {
    const s = linkStyle(graphLink({ relations: [relation()] }), NONE_HIDDEN)!
    expect(s.color).toBe(withAlpha('#e0a458', 0.75))
    expect(s.activeColor).toBe('#e0a458')
    expect(s.width).toBe(2.5)
  })

  it('always arrows an asymmetric relation and never a symmetric one', () => {
    expect(linkStyle(graphLink({ relations: [relation()] }), NONE_HIDDEN)!.arrow).toBe('always')
    expect(
      linkStyle(graphLink({ relations: [relation({ directed: false })] }), NONE_HIDDEN)!.arrow,
    ).toBe('never')
  })

  it('joins every visible label for the hover tooltip', () => {
    const link = graphLink({
      relations: [relation(), relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Ally of', order: 3 })],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('Parent of · Ally of')
  })

  it('falls back to wiki styling when every relation is hidden', () => {
    const link = graphLink({ mutual: true, relations: [relation()] })
    const s = linkStyle(link, new Set(['parent-of']))!
    expect(s.color).toBe(linkStyle(graphLink({ mutual: true }), NONE_HIDDEN)!.color)
    expect(s.arrow).toBe('toggle')
    expect(s.labels).toBe('')
  })

  it('drops the edge when every relation is hidden and no wiki link is underneath', () => {
    const link = graphLink({ wiki: false, relations: [relation()] })
    expect(linkStyle(link, new Set(['parent-of']))).toBeNull()
  })

  it('promotes the next visible relation, swapping the edge so the arrow reads forward', () => {
    // parent-of orients the edge a→b; ally-of is stored the other way. Hiding
    // parent-of promotes ally-of, whose row runs b→a.
    const link = graphLink({
      relations: [
        relation(),
        relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Allied with', order: 3, reversed: true }),
      ],
    })
    const s = linkStyle(link, new Set(['parent-of']))!
    expect(s.source).toBe('b')
    expect(s.target).toBe('a')
    expect(s.labels).toBe('Allied with')
  })

  it('flips every label on the edge when the orientation swaps, not just the primary', () => {
    const link = graphLink({
      relations: [
        relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Allied with', order: 3, reversed: true }),
        relation({ typeId: 'rival-of', label: 'Rival of', inverseLabel: 'Rivalled by', order: 4 }),
      ],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('Allied with · Rivalled by')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/graphColor.test.ts`
Expected: FAIL — `linkStyle` and `withAlpha` are not exported from `./graphColor`.

- [ ] **Step 3: Implement**

In `src/graphColor.ts`, extend the top import:

```ts
import { categoryColor, statusColor, type GraphNode, type GraphLink } from './db'
```

Append to the end of the file:

```ts
// ---------------------------------------------------------------------------
// Link styling (#137) — the single authority
// ---------------------------------------------------------------------------
// GraphView and graphExport used to derive rest-state link colour separately,
// with graphExport carrying hand-copied constants and a comment admitting it.
// A third styling dimension would have been the copy that drifted, so both now
// read what this computes once, in GraphRoute's filter memo.

/** When a link's arrow is drawn. A relationship's direction is meaning (parent
 *  vs child), so it is not the user's to toggle; a wiki link's direction is
 *  trivia about who typed the link, so it is. */
export type ArrowMode = 'always' | 'never' | 'toggle'

export interface LinkStyle {
  /** Orientation after the visible primary relation is applied — may swap the
   *  input's ends so the arrow can always be drawn at the target. */
  source: string
  target: string
  /** At rest. */
  color: string
  /** Inside the hover/selection focus neighbourhood. */
  activeColor: string
  width: number
  arrow: ArrowMode
  /** Hover tooltip text; '' for a wiki-only edge. */
  labels: string
}

/** A filtered link carrying its own presentation. */
export type DrawnLink = GraphLink & LinkStyle

/** The filtered graph as the renderers receive it. */
export interface DrawnGraphData {
  nodes: GraphNode[]
  links: DrawnLink[]
}

// Rest and lit styling for wiki links, unchanged from what GraphView drew
// before — now stated once.
const MUTUAL = { color: 'rgba(150,180,255,0.5)', active: 'rgba(190,210,255,0.95)', width: 2.5 }
const ONEWAY = { color: 'rgba(160,160,160,0.28)', active: 'rgba(170,185,225,0.7)', width: 1 }

// A typed edge is the strongest statement on the canvas, so it draws at the
// mutual width; the type's hue is what separates it from a mutual wiki link.
const RELATION_WIDTH = 2.5
const RELATION_REST_ALPHA = 0.75

/** '#rrggbb' + alpha → 'rgba(r, g, b, a)'. Input that isn't six-digit hex is
 *  returned unchanged: a relationship type's colour is user-editable, and a
 *  hand-entered 'tomato' should render as tomato rather than blank the edge. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Rest-state presentation for one link, or null when it should not be drawn at
 * all — every relationship on it is filtered out and there is no wiki link
 * underneath.
 *
 * `link.relations` arrives sorted lowest-`order`-first from buildGraphData, so
 * the first visible entry is the primary: it supplies the colour, the arrow
 * mode, and the orientation.
 */
export function linkStyle(link: GraphLink, hiddenRelTypes: Set<string>): LinkStyle | null {
  const visible = link.relations.filter((r) => !hiddenRelTypes.has(r.typeId))

  if (visible.length === 0) {
    if (!link.wiki) return null
    const s = link.mutual ? MUTUAL : ONEWAY
    return {
      source: link.source,
      target: link.target,
      color: s.color,
      activeColor: s.active,
      width: s.width,
      arrow: 'toggle',
      labels: '',
    }
  }

  // Hiding the type that oriented the edge can promote one stored the other way
  // round. Swapping here keeps the arrow drawable at the target end, which is
  // the only position react-force-graph offers.
  const primary = visible[0]
  const swap = primary.reversed
  return {
    source: swap ? link.target : link.source,
    target: swap ? link.source : link.target,
    color: withAlpha(primary.color, RELATION_REST_ALPHA),
    activeColor: primary.color,
    width: RELATION_WIDTH,
    arrow: primary.directed ? 'always' : 'never',
    // Per-edge, not per-relation: once the orientation flips, every label on
    // the edge reads the other way.
    labels: visible.map((r) => (swap ? r.inverseLabel : r.label)).join(' · '),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/graphColor.test.ts && npx tsc -b`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/graphColor.ts src/graphColor.test.ts
git commit -m "feat: add linkStyle, the single authority for link presentation (#137)

Replaces the rest-state styling GraphView and graphExport each derived
separately. Handles the type filter, the wiki fallback, the drop case, and
the orientation swap that keeps a promoted relation's arrow forward.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Persist the hidden relationship types

**Files:**
- Modify: `src/useGraphPrefs.ts`
- Test: `src/useGraphPrefs.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GraphPrefs` gains `hiddenRelTypes: Set<string>`, `toggleRelType(id: string): void`, `toggleRelGroup(typeIds: string[]): void`. Tasks 5 and 7 consume all three.

- [ ] **Step 1: Write the failing tests**

In `src/useGraphPrefs.test.ts`, first add the new field to the `base` object in the `migrateView` describe block (it is typed as `SavedView`, so tsc requires it):

```ts
  const base = {
    hidden: [], hiddenStatuses: [], showArrows: false, showGhosts: true, threeD: false,
    panelOpen: false, tags: [], tagMode: 'any' as const, minDegree: 0, depth: 0,
    colorBy: 'type' as const, cam: null, hiddenRelTypes: [],
  }
```

Then append this describe block at the end of the file:

```ts
describe('hiddenRelTypes', () => {
  it('defaults to nothing hidden, so a type created later is visible', async () => {
    // A row written before this field existed.
    await setMeta('graph-view', {
      hidden: [], hiddenStatuses: [], showArrows: false, showGhosts: true, threeD: false,
      panelOpen: false, tags: [], tagMode: 'any', minDegree: 0, depth: 0,
      colorBy: 'type', cam: null,
    })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))
  })

  it('toggles one type in and out of the hidden set', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))

    act(() => result.current.toggleRelType('ally-of'))
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set(['ally-of'])))

    act(() => result.current.toggleRelType('ally-of'))
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))
  })

  it('hides a whole group when all of it is visible, and reveals it otherwise', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))

    act(() => result.current.toggleRelGroup(['ally-of', 'enemy-of']))
    await waitFor(() =>
      expect(result.current.hiddenRelTypes).toEqual(new Set(['ally-of', 'enemy-of'])),
    )

    // Partially visible counts as "not all visible", so the group reveals.
    act(() => result.current.toggleRelType('ally-of'))
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set(['enemy-of'])))
    act(() => result.current.toggleRelGroup(['ally-of', 'enemy-of']))
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))
  })

  it('persists the hidden set to the graph-view meta row', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.hiddenRelTypes).toEqual(new Set()))
    act(() => result.current.toggleRelType('parent-of'))
    await waitFor(async () => {
      const row = await getMeta<{ hiddenRelTypes: string[] }>('graph-view')
      expect(row?.hiddenRelTypes).toEqual(['parent-of'])
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/useGraphPrefs.test.ts`
Expected: FAIL — `hiddenRelTypes` does not exist on the hook's return value.

- [ ] **Step 3: Implement**

In `src/useGraphPrefs.ts`, add to the `SavedView` interface, after `hiddenStatuses`:

```ts
  /** Relationship type ids whose edges are hidden. Stores HIDDEN rather than
   *  shown, like `hidden`/`hiddenStatuses`: a relationship type created after
   *  this row was last written must be visible by default. */
  hiddenRelTypes: string[]
```

Add to `DEFAULT_VIEW`, after `hiddenStatuses: []`:

```ts
  hiddenRelTypes: [],
```

No `migrateView` step is needed — `{ ...DEFAULT_VIEW, ...savedView }` already folds a pre-existing row to `[]`. (`migrateView` exists only because the legacy `tag` field needed *transforming*.)

Add to the `GraphPrefs` interface, after `toggleStatus`:

```ts
  hiddenRelTypes: Set<string>
  toggleRelType: (id: string) => void
  toggleRelGroup: (typeIds: string[]) => void
```

Add the derived set next to the existing `hiddenStatuses` memo:

```ts
  const hiddenRelTypes = useMemo(() => new Set(view.hiddenRelTypes), [view.hiddenRelTypes])
```

Add the two callbacks after `toggleStatus`:

```ts
  const toggleRelType = useCallback((id: string) => {
    const next = new Set(view.hiddenRelTypes)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    writeView({ ...view, hiddenRelTypes: [...next] })
  }, [view, writeView])

  /** Hide a whole group when all of it is visible; otherwise reveal all of it.
   *  A half-hidden group therefore reveals rather than inverting, which is what
   *  a user clicking the header of a partly-off group expects. */
  const toggleRelGroup = useCallback((typeIds: string[]) => {
    const next = new Set(view.hiddenRelTypes)
    const allVisible = typeIds.every((id) => !next.has(id))
    for (const id of typeIds) {
      if (allVisible) next.add(id)
      else next.delete(id)
    }
    writeView({ ...view, hiddenRelTypes: [...next] })
  }, [view, writeView])
```

Add to the returned object, after the `hiddenStatuses, toggleStatus,` line:

```ts
    hiddenRelTypes, toggleRelType, toggleRelGroup,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/useGraphPrefs.test.ts && npx tsc -b`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/useGraphPrefs.ts src/useGraphPrefs.test.ts
git commit -m "feat: persist hidden relationship types in the graph view prefs (#137)

Stores hidden rather than shown, so a type created later is visible by
default. No migrateView step needed — the DEFAULT_VIEW spread covers it.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Draw typed edges

**Files:**
- Modify: `src/routes/GraphRoute.tsx` (the `filtered` memo, ~104-121)
- Modify: `src/components/GraphView.tsx`

**Interfaces:**
- Consumes: `linkStyle`, `DrawnLink`, `DrawnGraphData` (Task 3); `hiddenRelTypes` (Task 4); `GraphLink.relations` (Task 2).
- Produces: `filtered` is now a `DrawnGraphData`; every drawn link carries `color`, `activeColor`, `width`, `arrow`, `labels`. Task 6 reads `color` and `width` from it.

- [ ] **Step 1: Apply `linkStyle` in the filter memo**

In `src/routes/GraphRoute.tsx`, add to the `'../graphColor'` import: `linkStyle, type DrawnLink, type DrawnGraphData`. Add `hiddenRelTypes` to the destructured `useGraphPrefs()` result.

Replace the body of the `filtered` memo:

```ts
  const filtered = useMemo(() => {
    const hopSet = depthFocus ? nodesWithinHops(full.links, depthFocus, depth) : null
    const nodes = full.nodes.filter(
      (n) =>
        (showGhosts || !n.ghost) &&
        !hidden.has(n.category) &&
        (n.ghost || !hiddenStatuses.has(n.status)) &&
        (colorBy === 'tag' || matchesTags(n.tags, tagFilter)) &&
        n.degree >= minDegree &&
        (hopSet == null || hopSet.has(n.id)),
    )
    const visible = new Set(nodes.map((n) => n.id))
    const links = full.links.filter((l) => visible.has(l.source) && visible.has(l.target))
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    }
  }, [full, hidden, hiddenStatuses, tagFilter, showGhosts, minDegree, depth, depthFocus, colorBy])
```

with:

```ts
  const filtered = useMemo<DrawnGraphData>(() => {
    const hopSet = depthFocus ? nodesWithinHops(full.links, depthFocus, depth) : null
    const nodes = full.nodes.filter(
      (n) =>
        (showGhosts || !n.ghost) &&
        !hidden.has(n.category) &&
        (n.ghost || !hiddenStatuses.has(n.status)) &&
        (colorBy === 'tag' || matchesTags(n.tags, tagFilter)) &&
        n.degree >= minDegree &&
        (hopSet == null || hopSet.has(n.id)),
    )
    const visible = new Set(nodes.map((n) => n.id))
    // Node filter first, then endpoint survival, then styling — which also
    // decides whether the edge is drawn at all: a link whose every relationship
    // type is hidden and which has no wiki link underneath is dropped here.
    // linkStyle may swap an edge's ends; edgeKey is order-independent, so the
    // path highlight still matches these against full.links.
    const links = full.links.flatMap<DrawnLink>((l) => {
      if (!visible.has(l.source) || !visible.has(l.target)) return []
      const style = linkStyle(l, hiddenRelTypes)
      return style ? [{ ...l, ...style }] : []
    })
    return { nodes: nodes.map((n) => ({ ...n })), links }
  }, [full, hidden, hiddenStatuses, tagFilter, showGhosts, minDegree, depth, depthFocus, colorBy, hiddenRelTypes])
```

- [ ] **Step 2: Verify it compiles and nothing regressed**

Run: `npx tsc -b && npx vitest run`
Expected: tsc clean, all tests PASS. (`GraphView` still ignores the new fields at this point — that is the next step.)

- [ ] **Step 3: Read the precomputed style in GraphView**

In `src/components/GraphView.tsx`, change the imports:

```ts
import { type GraphNode, type GraphLink, edgeKey } from '../db'
import { nodeFill, PATH_ACCENT, type ColorBy, type DrawnLink, type DrawnGraphData } from '../graphColor'
```

Change the link type alias:

```ts
type GLink = LinkObject<GraphNode, DrawnLink>
```

Change the `data` prop type in both the destructuring signature and the props interface from `GraphData` to `DrawnGraphData`.

Change the element's generic parameters too — this is easy to miss, and without it the link accessors below are typed against the un-styled `GraphLink`:

```tsx
      <ForceGraph2D<GraphNode, DrawnLink>
```

`GraphData` and `GraphLink` will now be unused in this file's `'../db'` import; drop whichever tsc reports. (`GraphView3D` still declares `data: GraphData` and keeps working — `DrawnLink[]` is assignable to `GraphLink[]`, and `filtered` is a variable, so no excess-property check applies.)

Replace `linkColor` and `linkWidth`:

```ts
  // Rest and lit colours are precomputed by linkStyle in GraphRoute's filter
  // memo, so this only layers the render-time states on top: the path
  // highlight, and the dimming of everything outside the focus neighbourhood.
  const linkColor = useCallback(
    (link: GLink) => {
      const onPath = pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))
      if (pathEdges) return onPath ? PATH_ACCENT : 'rgba(160,160,160,0.08)'
      if (neighbourIds == null) return link.color
      const active = neighbourIds.has(endId(link.source)) && neighbourIds.has(endId(link.target))
      return active ? link.activeColor : 'rgba(160,160,160,0.08)'
    },
    [pathEdges, neighbourIds],
  )

  // A path hop draws thicker than anything else; otherwise the width comes with
  // the link.
  const linkWidth = useCallback(
    (link: GLink) => {
      if (pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))) return 4
      return link.width
    },
    [pathEdges],
  )
```

- [ ] **Step 4: Wire arrows and hover labels**

In the `<ForceGraph2D>` element, replace:

```tsx
      linkDirectionalArrowLength={showArrows ? 4 : 0}
```

with:

```tsx
      linkLabel={(link: GLink) => link.labels}
      linkDirectionalArrowLength={(link: GLink) =>
        link.arrow === 'always' || (link.arrow === 'toggle' && showArrows) ? 4 : 0}
```

Leave `linkDirectionalArrowColor={linkColor}` and `linkDirectionalArrowRelPos={1}` as they are — the arrow is always drawn at the target end, which is why `linkStyle` swaps the ends rather than offering a backward mode.

- [ ] **Step 5: Run the full suite and the build**

Run: `npm run lint && npx tsc -b && npm run test:run`
Expected: all clean.

- [ ] **Step 6: Verify in the running app**

Run `npm run dev`, open `http://localhost:5174/#/graph`. With at least two pages carrying a relationship (add one from a page's Relations panel if the world has none), confirm:
- the pair is joined by a coloured edge even when neither page links to the other
- an asymmetric type ("Parent of") shows an arrow with the toolbar's "Arrows off"
- a symmetric type ("Ally of") shows none
- hovering the edge shows its label

- [ ] **Step 7: Commit**

```bash
git add src/routes/GraphRoute.tsx src/components/GraphView.tsx
git commit -m "feat: draw typed relationship edges on the 2D graph (#137)

Filter memo computes each link's presentation once via linkStyle; the canvas
layers only path and focus states on top. Asymmetric types always arrow,
symmetric never, wiki links keep the toggle. Labels on hover.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Match the PNG/SVG export to the screen

**Files:**
- Modify: `src/graphExport.ts:23-26, 73-104`
- Test: `src/graphExport.test.ts`

**Interfaces:**
- Consumes: `DrawnGraphData`, `DrawnLink` (Task 3), populated by Task 5.
- Produces: `buildScene(data: DrawnGraphData, opts): GraphScene | null` — the parameter type narrows from `GraphData`.

- [ ] **Step 1: Update the test that pins link styling**

In `src/graphExport.test.ts`, extend the imports:

```ts
import { categoryColor, type GraphNode } from './db'
import { linkStyle, withAlpha, type DrawnGraphData, type DrawnLink } from './graphColor'
import { NO_TAG_FILTER } from './tagFilter'
```

(`type GraphData` is no longer needed in that import — remove it if tsc flags it as unused.)

Add this helper next to the existing `pos()` helper:

```ts
/** A drawn link as GraphRoute's filter memo produces it: the plain link plus
 *  the presentation linkStyle computed for it. */
function drawn(link: Partial<DrawnLink> & { source: string; target: string }): DrawnLink {
  const base = { mutual: false, wiki: true, relations: [], ...link }
  return { ...base, ...linkStyle(base, new Set())! }
}
```

Replace the `'styles mutual links thicker/bluer than one-way links'` test body's `links` array:

```ts
      links: [
        drawn({ source: 'a', target: 'b', mutual: true }),
        drawn({ source: 'b', target: 'c', mutual: false }),
      ],
```

Then append this test to the `buildScene` describe block:

```ts
  it('draws a relationship edge in its type colour, not the wiki styling', () => {
    const data = {
      nodes: [pos({ id: 'a', degree: 1 }, 0, 0), pos({ id: 'b', degree: 1 }, 10, 0)],
      links: [
        drawn({
          source: 'a', target: 'b', wiki: false,
          relations: [{
            typeId: 'parent-of', group: 'kin', color: '#e0a458',
            label: 'Parent of', inverseLabel: 'Child of',
            directed: true, reversed: false, order: 0,
          }],
        }),
      ],
    } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.links[0].color).toBe(withAlpha('#e0a458', 0.75))
    expect(scene.links[0].width).toBe(2.5)
  })
```

Every other `as unknown as GraphData` cast in this file becomes `as unknown as DrawnGraphData`, and every literal link inside those casts must go through `drawn({...})`. `npx tsc -b` will list them.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/graphExport.test.ts`
Expected: FAIL — `linkStyle` / `DrawnGraphData` not found in the import, or the relation-colour assertion fails because `buildScene` still uses the mutual/one-way constants.

- [ ] **Step 3: Read the precomputed style**

In `src/graphExport.ts`, delete these four lines:

```ts
// Rest-state link styling, mirrored from GraphView.linkColor / linkWidth (the
// no-focus branch) so an exported image matches the graph at rest.
const MUTUAL_LINK = { color: 'rgba(150,180,255,0.5)', width: 2.5 }
const ONEWAY_LINK = { color: 'rgba(160,160,160,0.28)', width: 1 }
```

Change the import:

```ts
import { nodeFill, type ColorBy, type DrawnGraphData, type DrawnLink } from './graphColor'
import type { GraphNode } from './db'
```

(Drop `GraphData` and `GraphLink` from the `./db` type import if tsc reports them unused.)

Change `buildScene`'s signature:

```ts
export function buildScene(
  data: DrawnGraphData,
  opts: { colorBy: ColorBy; tagFilter: TagFilter; islandColors: Map<string, string> },
): GraphScene | null {
```

And in its doc comment, replace the first sentence with:

```
 * Build a serialisable scene from the *filtered* graph, whose links already
 * carry the presentation linkStyle computed for them — so an exported image
 * matches the canvas by construction rather than by mirrored constants.
```

Replace the link loop:

```ts
  const sceneLinks: SceneLink[] = []
  for (const l of data.links as Array<DrawnLink & { source: string | Positioned; target: string | Positioned }>) {
    const s = positioned.get(endId(l.source))
    const t = positioned.get(endId(l.target))
    if (!s || !t) continue
    sceneLinks.push({ x1: s.x!, y1: s.y!, x2: t.x!, y2: t.y!, color: l.color, width: l.width })
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/graphExport.test.ts && npx tsc -b && npm run lint`
Expected: PASS, tsc clean, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/graphExport.ts src/graphExport.test.ts
git commit -m "feat: export typed edges in their type colours (#137)

buildScene reads each link's precomputed style instead of re-deriving it
from mutual, deleting the two constants it hand-mirrored from GraphView.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Relationship type and group chips

**Files:**
- Modify: `src/routes/GraphRoute.tsx`
- Modify: `src/index.css` (after `.graph-chip.off`, ~line 1410)

**Interfaces:**
- Consumes: `hiddenRelTypes`, `toggleRelType`, `toggleRelGroup` (Task 4); `relationships`, `relTypes` (Task 2).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Derive the groups actually in use**

In `src/routes/GraphRoute.tsx`, add `type RelationshipGroup` to the `'../db'` type imports, and these module-level constants next to `TAG_CHIP_LIMIT`:

```ts
// Declaration order of RelationshipGroup, so the chip rows never reshuffle.
const GROUP_ORDER: RelationshipGroup[] = ['kin', 'faction', 'org', 'social', 'other']
const GROUP_LABELS: Record<RelationshipGroup, string> = {
  kin: 'Kinship',
  faction: 'Faction',
  org: 'Organisation',
  social: 'Social',
  other: 'Other',
}
```

Add this memo next to the existing `tagChips` memo:

```ts
  // Only types actually used by a relationship get a chip: a world that has
  // never used the feature shows no new controls in an already-dense toolbar,
  // and an unused custom type is not a filter anyone needs.
  const relGroups = useMemo(() => {
    const used = new Set(relationships.map((r) => r.typeId))
    const byGroup = new Map<RelationshipGroup, RelationshipType[]>()
    for (const t of relTypes) {
      if (!used.has(t.id)) continue
      const list = byGroup.get(t.group)
      if (list) list.push(t)
      else byGroup.set(t.group, [t])
    }
    return GROUP_ORDER.flatMap((group) => {
      const types = byGroup.get(group)
      return types ? [{ group, types }] : []
    })
  }, [relationships, relTypes])
```

`relTypes` arrives from `getRelationshipTypes()` already sorted by `order`, so each group's chips are in vocabulary order.

- [ ] **Step 2: Render the chip block**

Insert this directly after the closing `)}` of the existing tag-chip block (the one guarded by `tagChips.shown.length > 0`) and before the `Color by` label:

```tsx
        {relGroups.length > 0 && (
          <div className="graph-rel-chips">
            {relGroups.map(({ group, types }) => {
              const ids = types.map((t) => t.id)
              const allHidden = ids.every((id) => hiddenRelTypes.has(id))
              return (
                <div className="graph-rel-group" key={group}>
                  <button
                    className={`graph-group-btn${allHidden ? ' off' : ''}`}
                    title={`Show or hide every ${GROUP_LABELS[group].toLowerCase()} relationship`}
                    onClick={() => toggleRelGroup(ids)}
                  >
                    {GROUP_LABELS[group]}
                  </button>
                  {types.map((t) => (
                    <button
                      key={t.id}
                      className={`graph-chip${hiddenRelTypes.has(t.id) ? ' off' : ''}`}
                      style={{
                        borderColor: t.color,
                        color: hiddenRelTypes.has(t.id) ? undefined : t.color,
                      }}
                      onClick={() => toggleRelType(t.id)}
                    >
                      <span className="dot" style={{ background: t.color }} />
                      {t.label}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        )}
```

- [ ] **Step 3: Style it**

In `src/index.css`, insert after the `.graph-chip.off` rule:

```css
.graph-rel-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.graph-rel-group {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.graph-group-btn {
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: var(--ink-faint);
  cursor: pointer;
  font-family: var(--sans);
  font-size: 12px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.graph-group-btn:hover { background: var(--panel-2); color: var(--ink-dim); }
.graph-group-btn.off { opacity: 0.4; }
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npx tsc -b && npm run test:run`
Expected: all clean.

Then `npm run dev`, open `http://localhost:5174/#/graph` in a world with relationships, and confirm:
- a chip row appears with a group header per group in use
- clicking a type chip greys it and the matching edges fall back to grey (if a wiki link exists) or disappear
- clicking a group header hides the whole group; clicking again with one type already hidden reveals the whole group
- reloading the page preserves the selection
- a world with no relationships shows no new chips at all

- [ ] **Step 5: Commit**

```bash
git add src/routes/GraphRoute.tsx src/index.css
git commit -m "feat: filter graph edges by relationship type and group (#137)

Selecting the faction group is the diplomacy web. Only types actually in use
get a chip, and the block is absent in a world with no relationships.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Open the PR

**Files:** none.

- [ ] **Step 1: Run the full verification gate**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three green. Do not proceed otherwise.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/137-typed-graph-edges
gh pr create --title "Typed graph edges (#137)" --label version:minor --body "$(cat <<'EOF'
Consumes the #175 relationship primitive in the 2D graph and the PNG/SVG export.

- `buildGraphData` merges relationship rows into the wiki-link graph: one edge
  per unordered pair, typed edges winning, oriented by the lowest-order type.
  A relationship implies no wiki link, so this adds edges the graph never drew
  and `degree` now counts them — a relationship-only page stops reading as
  isolated.
- All rest-state link styling moves into one pure `linkStyle()`. `graphExport`
  no longer hand-mirrors constants from `GraphView`; both read what the filter
  memo computed once.
- Filter chips per relationship type, grouped by `group`. Selecting the faction
  group is the diplomacy web.
- Asymmetric types always draw an arrow (parent vs child is meaning); symmetric
  types never do; wiki links keep the existing toggle.
- Labels on edge hover.

Design: `docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md`

Out of scope, per the spec: `GraphView3D` (inherits the new edges and correct
`degree`, but draws them in the old grey/blue — follow-up issue), curved edges
(#122), family-tree layout (#136).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: File the GraphView3D follow-up**

```bash
gh issue create --title "Typed relationship edges in the 3D graph" --label enhancement --body "$(cat <<'EOF'
#137 gave the 2D canvas and the PNG/SVG export typed relationship edges.
`GraphView3D` was left out, matching the precedent that the shortest-path
highlight, selection pulse and depth filter are all 2D-only.

**What it already has.** 3D receives the same filtered links, so relationship
edges *appear* there and `degree` (node size) is correct. It just draws them
with the wiki mutual/one-way styling instead of the type's colour — a coherent
partial state, not a broken one.

**What's missing:** type colours on 3D links, and the arrow rules from #137
(asymmetric always arrowed, symmetric never). The drawn links already carry
`color`, `activeColor`, `width` and `arrow` from `linkStyle`, so this is
mostly reading fields that are already there rather than new logic.
EOF
)"
```

---

## Notes for the implementer

**Why `buildGraphData`'s new params are required rather than defaulted.** There is exactly one production call site. Required params make `tsc` enumerate every test call site instead of letting a missed one silently build a relation-less graph that looks correct and passes.

**Why the relationship pass runs where it does.** After the `mutual` loop (which reads `edge.source`/`edge.target` against the `directed` set — flipping orientation first would corrupt it) and before the node build (so `degree` sees relationship neighbours).

**Why `linkStyle` swaps ends instead of offering a backward arrow.** `linkDirectionalArrowRelPos={1}` draws at the target end and react-force-graph has no flipped-arrow mode. Swapping is the only way a promoted, reversed relation can point correctly.

**What is deliberately not recomputed.** `degree` is a property of the *full* graph and is not recalculated when filters hide edges — that is existing behaviour (`minDegree` already filters against the unfiltered count), so hiding a relationship type leaves node sizes alone, exactly as hiding a category does.
