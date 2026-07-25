# Typed graph edges — design

**Issue:** #137 · **Date:** 2026-07-23 · **Status:** approved, not yet implemented

#175 shipped the relationship primitive: a page can now be recorded as *parent
of* or *enemy of* another, with a user-definable vocabulary. Its only consumer
is the page-aside `Relations` panel. The graph — the app's main relationship
view — still draws untyped `[[wiki links]]` and is blind to the new tables, so
the primitive is inventory rather than a feature.

This spec makes the graph consume it: relationship rows become edges, coloured
by their type, filterable by type and group. Selecting the `faction` group *is*
the diplomacy web the issue asks for; selecting `kin` previews what #136 will
lay out properly.

**Scope:** the 2D canvas and the PNG/SVG export. `GraphView3D` and the
family-tree layout stay in their own issues (§8).

---

## 1. The two edge sources

A relationship and a wiki link are different facts that can connect the same
pair, and — critically — **a relationship implies no wiki link**. "Uther
parent-of Arthur" can exist with neither page mentioning the other. Relationship
edges therefore *add* connections the current graph does not draw at all, and
can connect pages it currently renders as isolated dots.

The rule is **one graph, typed edges win**:

| Pair has | Draws as |
|---|---|
| relationship (± wiki link) | one edge in the type's colour, labelled on hover |
| wiki link only | today's grey / blue mutual styling, unchanged |
| neither | no edge |

One edge per unordered pair, always. This is not a stylistic preference: it is
the invariant `edgeKey()` encodes and that the shortest-path highlight
(`pathEdges` in `GraphView`) matches against. Parallel edges per type would
collide on that key and silently break the path highlight, and would need the
curved/offset rendering of #122, which is unshipped.

---

## 2. Data model

`buildGraphData` gains two required parameters:

```ts
export function buildGraphData(
  pages: LorePage[],
  relationships: Relationship[],
  types: RelationshipType[],
): GraphData
```

**Required, not defaulted.** There is exactly one production call site
(`GraphRoute.tsx:27`); required params make `tsc` enumerate the two test files
that also call it, rather than letting a missed site quietly build a
relation-less graph that looks correct.

`GraphLink` gains two fields:

```ts
export interface GraphLink {
  source: string
  target: string
  /** Wiki-link reciprocity. Retained but unused for styling when `relations`
   *  is non-empty — a typed edge is styled by its type, not by reciprocity. */
  mutual: boolean
  /** NEW — a resolved wiki link exists for this pair, in either direction. */
  wiki: boolean
  /** NEW — every relationship on this pair, lowest `type.order` first. */
  relations: RelationEdge[]
}

/** One relationship on a pair, pre-resolved to the drawn edge's orientation. */
export interface RelationEdge {
  typeId: string
  group: RelationshipGroup
  color: string
  /** How it reads along the built orientation (source → target): "Parent of". */
  label: string
  /** How it reads against that orientation: "Child of". Both are stored because
   *  §4 can swap the drawn orientation after the fact, and a single resolved
   *  label would then be backwards. */
  inverseLabel: string
  /** False for a symmetric type ("Ally of" / "Ally of"), where the two are equal. */
  directed: boolean
  /** The stored row runs against the built orientation. */
  reversed: boolean
  order: number
}
```

`wiki` is the load-bearing addition. Without it, hiding a relationship type
cannot distinguish "this pair also has a wiki link — fall back to grey" from
"this pair was relationship-only — drop the edge".

`label` is resolved **at build time** through `resolveRelation()` from
`src/relations.ts`, viewed from the drawn edge's `source`. That module's header
comment is explicit that the inversion rule lives in exactly one place and that
this view must call it rather than re-derive it; three copies is how two views
end up disagreeing about what "parent" means.

---

## 3. The merge

Run after the existing wiki-link pass and before nodes are built (so `degree`
sees relationship neighbours).

1. Index `types` by id and collect the set of real page ids.
2. Drop rows that are unusable: `fromId === toId`, either endpoint absent from
   the page set, or an unknown `typeId`. The write path already refuses all
   three, but import is a second entry point and this is the render boundary.
3. Group surviving rows by `edgeKey(fromId, toId)`.
4. Sort each pair's rows by `type.order`, then `typeId` for a stable tie-break —
   the same determinism `connectedComponents` and `shortestPath` already commit
   to, so an unrelated edit never reshuffles a colour.
5. **Orient the edge from the wiki edge when there is one, else from the
   lowest-order row**: for a pair that already has a wiki edge, keep its
   `source`/`target`; otherwise `source = primary.fromId`,
   `target = primary.toId`. Applies regardless of whether the primary type is
   symmetric.

   Amended by #245. This was originally unconditional — one rule, no branch —
   on the grounds that everything else in the graph (`edgeKey`, `degree`, BFS,
   the depth filter) treats edges as undirected. That still holds, and it is
   still what makes the choice safe. What it missed is that the *wiki* edge
   outlives the relationship's visibility: hiding the type falls the edge back
   to wiki styling (§4), and an orientation overwritten here left that fallback
   drawing its arrow against the only wiki link on the pair. Deferring to the
   wiki orientation costs one branch and confines orientation-switching to
   `linkStyle`, where the arrow decision already lives.

   `reversed` (step 6) is unaffected: it is measured against whichever
   orientation this step chose.
6. Build each `RelationEdge`: `label` from `resolveRelation(row, type, source)`,
   `inverseLabel` from `resolveRelation(row, type, target)`, and
   `reversed = row.fromId !== source`.
7. Attach to the pair's existing wiki edge, or push a new one with
   `wiki: false`, `mutual: false`.
8. Register both endpoints as neighbours of each other, so `degree` counts them.

**No ghost nodes for relationships.** A ghost stands in for a wiki link to a
title that has no page; it can be created because the link text *is* a display
name. A relationship stores page ids, so a dangling id has nothing to render —
step 2 drops it instead.

### `degree` is a property of the full graph

`degree` now counts relationship neighbours, so a page connected only by
relationships stops reading as isolated. `HubsOrphansPanel` needs no change — it
reads `degree`.

`degree` is computed once on the full graph and deliberately **not** recomputed
when filters hide edges. That is the existing behaviour (`filtered` does
`nodes.map(n => ({ ...n }))`, preserving `full`'s degree, and `minDegree`
already filters against the unfiltered count), so hiding a relationship type
leaves node sizes alone — consistent with hiding a category today.

The world-health dashboard's "orphan" (no incoming *wiki* links) is a different
question on a different route and is **not** touched.

---

## 4. One styling function, three consumers

`graphExport.ts:23-26` currently hand-mirrors `MUTUAL_LINK` / `ONEWAY_LINK` from
`GraphView.linkColor`, with a comment admitting the duplication. Adding a third
styling dimension by hand-mirroring a third time guarantees drift — an exported
PNG that disagrees with the screen.

So rest-state styling moves into one pure function in `src/graphColor.ts`
(already pure, already the owner of node colour):

```ts
export type ArrowMode = 'always' | 'never' | 'toggle'

export interface LinkStyle {
  /** Orientation after the visible primary is applied; may swap the input's. */
  source: string
  target: string
  color: string        // at rest
  activeColor: string  // lit, when the edge is inside the focus neighbourhood
  width: number
  arrow: ArrowMode
  /** Hover tooltip text; '' for a wiki-only edge. */
  labels: string
}

/** Null means "drop this edge": every relationship on it is filtered out and
 *  there is no wiki link underneath. */
export function linkStyle(link: GraphLink, hiddenRelTypes: Set<string>): LinkStyle | null
```

Behaviour:

- **Visible relations** = `link.relations` minus hidden type ids, order preserved.
- **None visible, `wiki: true`** → today's styling exactly: mutual blue at
  `rgba(150,180,255,0.5)` / width 2.5, one-way grey at `rgba(160,160,160,0.28)` /
  width 1, `arrow: 'toggle'`, `labels: ''`.
- **None visible, `wiki: false`** → `null`.
- **Some visible** → the lowest-order visible relation is the *primary*:
  - `color` = its type colour at 0.75 alpha, `activeColor` at 1.0, via a small
    pure `withAlpha(hex, a)` helper.
  - `width` = 2.5 — a typed edge is the strongest statement on the canvas.
  - If `primary.reversed`, **swap `source`/`target`** so the arrow can always be
    drawn forward. This is why orientation is part of the style rather than
    fixed at build time: the incoming orientation is the wiki edge's (§3 step 5),
    and hiding a type can promote a relation whose stored row runs the other way,
    while `linkDirectionalArrowRelPos={1}` only draws at the target end. The
    swap is therefore what makes a visible relationship orient the edge, and its
    absence on the fallback path is what makes a hidden one read as the wiki
    link again.
  - `arrow` = `primary.directed ? 'always' : 'never'`. After the swap the
    primary always reads forward, so no `'backward'` mode is needed.
  - `labels` = every visible relation joined with ` · `, taking `inverseLabel`
    instead of `label` when the swap happened. The choice is per-edge, not
    per-relation: once the orientation flips, *every* label on that edge reads
    the other way.

`GraphRoute`'s filter memo already clones each link (`links.map(l => ({...l}))`).
The order becomes: filter nodes → keep links whose endpoints both survive (as
today) → apply `linkStyle` → spread it onto the clone, dropping links where it
returned null. So the drawn links carry their own presentation, and both
renderers get simpler:

- `GraphView.linkColor` keeps only its path and focus-dim branches, falling
  through to `link.color` / `link.activeColor` instead of re-deriving from
  `mutual`.
- `GraphView.linkWidth` keeps the path branch, falls through to `link.width`.
- `buildScene` reads `link.color` and `link.width` directly; `MUTUAL_LINK` and
  `ONEWAY_LINK` are **deleted**, and the drift they represented with them.

---

## 5. Arrows

An asymmetric type's direction is load-bearing meaning — parent versus child —
unlike a wiki link's direction, which is trivia about who happened to type the
link. The three modes settle it without a new user-facing control:

| Edge | Arrow |
|---|---|
| relation, asymmetric primary | always drawn |
| relation, symmetric primary | never drawn (an arrow would assert a direction the type denies) |
| wiki only | follows the existing "Arrows on/off" toggle |

```tsx
linkDirectionalArrowLength={(l) =>
  l.arrow === 'always' || (l.arrow === 'toggle' && showArrows) ? 4 : 0}
```

The existing toggle keeps its current label and meaning; it simply no longer
governs typed edges.

---

## 6. UI

### Hover labels

`linkLabel={(l) => l.labels}` on `ForceGraph2D` — the library's own tooltip.
`GraphView3D` already uses `nodeLabel="title"`, so this is an established idiom
here and needs no canvas text work. Edge text drawn on a force layout rotates
and collides badly; a tooltip keeps the canvas clean at rest, which is the whole
point of colour-coding the edges.

### Relationship chips

A chip block in the toolbar, using the existing `.graph-chip` idiom, **rendered
only when the world has at least one relationship** — a world that has never
used the feature sees no new controls in an already-crowded toolbar.

Chips are grouped by `RelationshipGroup` in declaration order (`kin`, `faction`,
`org`, `social`, `other`), showing only groups that have a type in use. Each
group renders a header button that toggles its whole set, then one chip per
type, bordered and dotted in the type's colour, matching the category chips
above it. No cap or "+N more" disclosure: the vocabulary is user-curated and
small (six built-ins), and the group headers already provide the compression the
tag row needed.

Selecting only the `faction` group is the diplomacy web. It is deliberately a
filter rather than a named preset — a user-invented "Vassal of" tagged `faction`
joins it automatically, which is exactly what `group` was put on the type for.

### Persisted preference

`SavedView` gains `hiddenRelTypes: string[]`, storing **hidden** rather than
shown, matching `hidden` and `hiddenStatuses`. This matters: a relationship type
created after the preference was last written must be visible by default, and a
shown-list would hide it.

No `migrateView` step is needed — `{ ...DEFAULT_VIEW, ...savedView }` already
hydrates a pre-existing row to `[]`. (`migrateView` exists only because the
legacy `tag` field needed *transforming* into `tags`; this field only needs a
default.) `useGraphPrefs` exposes `toggleRelType(id)` and `toggleRelGroup(group,
typeIds)`, both writing through the existing hydration-guarded `writeView`.

### Data access

`GraphRoute` gains two live reads, through the repository seam as the lint rule
requires:

```ts
const relationships = useLiveQuery(() => relationshipRepo.listAll(), []) ?? NO_RELATIONSHIPS
const relTypes      = useLiveQuery(() => relationshipRepo.listTypes(), []) ?? NO_REL_TYPES
```

`listAll()` is new: `getAllRelationships()` in `src/db/relationships.ts`
(`db.relationships.toArray()`), surfaced as `relationshipRepo.listAll()`. This
mirrors `manuscriptRepo.listAllScenes()` exactly — a whole-table read consumed
by a route's `useLiveQuery`. `export * from './relationships'` already covers the
barrel, so only `barrel.test.ts`'s `EXPECTED_FUNCTIONS` list needs the new name.

Module-level `NO_RELATIONSHIPS` / `NO_REL_TYPES` constants, like the existing
`NO_PAGES`, so the `full` memo does not churn while the queries resolve.

---

## 7. Files touched

| File | Change |
|---|---|
| `src/db/graph.ts` | signature, `GraphLink` fields, `RelationEdge`, the merge |
| `src/db/relationships.ts` | `getAllRelationships()` |
| `src/db/repositories.ts` | `relationshipRepo.listAll()` |
| `src/db/barrel.test.ts` | add `getAllRelationships` to the expected surface |
| `src/graphColor.ts` | `linkStyle`, `ArrowMode`, `withAlpha`, relation constants |
| `src/graphExport.ts` | read precomputed style; delete `MUTUAL_LINK`/`ONEWAY_LINK` |
| `src/components/GraphView.tsx` | style fall-through, `linkLabel`, arrow accessor |
| `src/routes/GraphRoute.tsx` | live reads, `linkStyle` in the filter memo, chip block |
| `src/useGraphPrefs.ts` | `hiddenRelTypes`, `toggleRelType`, `toggleRelGroup` |
| `src/index.css` | chip-group styling |

---

## 8. Out of scope

- **`GraphView3D`.** Follow-up issue, matching the precedent that the path
  highlight, selection pulse and depth filter are all 2D-only. Note what it
  *does* inherit: it receives the same filtered links, so relationship edges
  appear and `degree` is correct — it simply draws them with the existing
  mutual/one-way styling instead of type colours. A coherent partial state, not
  a broken one, and it should be described that way in the follow-up.
- **Curved and bundled edges (#122).** Unchanged; §1 explains why the one-edge
  invariant makes this feature independent of it.
- **Family-tree layout (#136).** This ships the data on the force layout; #136
  is the generational layout.
- **World-health orphan definition.** Different route, different question.
- **`htmlExport` relation coverage.** Pre-existing gap noted in the #175 spec
  (it already omits `docLinks`); still wants its own issue covering both.
- **Backup / mirror.** No change — both tables already travel as of v15.

---

## 9. Testing

`src/db/graph.test.ts`:

- a relationship-only pair creates an edge (`wiki: false`)
- a pair with both a relationship and a wiki link collapses to one edge
- a multi-type pair orders `relations` by `type.order`, tie-broken by `typeId`
- the edge is oriented from the lowest-order row; `reversed` is set correctly on
  the others
- `label` reads from the built source and `inverseLabel` from the built target
  ("Parent of" / "Child of"); a symmetric type gives the same text for both
- `degree` counts relationship neighbours; a relationship-only page is not
  isolated
- rows are dropped for: self-relation, unknown `typeId`, endpoint with no page
- no ghost node is ever created from a relationship

`src/graphColor.test.ts` (new `linkStyle` block):

- hidden primary promotes the next visible type, swapping orientation when that
  row is reversed — and every label on the edge flips to its `inverseLabel`
- all types hidden with `wiki: true` falls back to exact mutual / one-way styling
- all types hidden with `wiki: false` returns null
- symmetric primary yields `arrow: 'never'`; asymmetric yields `'always'`
- a wiki-only edge yields `arrow: 'toggle'` and empty `labels`

`src/graphExport.test.ts`:

- a scene link takes the relation colour and width, not the mutual constants

`src/useGraphPrefs.test.ts`:

- a stored row predating `hiddenRelTypes` hydrates to `[]` (all types shown)
- `toggleRelGroup` adds and removes a whole group

---

## 10. Verification

`npm run lint && npm run build && npm run test:run` all green before the PR.
Label the PR `version:minor` — this is a new feature.
