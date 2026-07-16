# Shortest path between two pages — design (#127)

**Issue:** [#127](https://github.com/KantikPotatoe/Lore-Codex/issues/127) — "Pick two nodes and highlight the chain of links connecting them ('how is this villain connected to that city?')."

> **As-built note.** Two things landed differently from the sketch below, both simpler: (1) `GraphView` takes a single `path: string[] | null` prop and derives `pathIds`/`pathEdges`/`pathEnds` itself, rather than the route deriving and passing two sets — this keeps the canonical-edge logic next to the renderer. (2) `shortestPath`/`findPath` accept `{ source: LinkEnd; target: LinkEnd }[]` and read endpoints through `endId`, not the `Pick<GraphLink,…>` shown here: the force sim mutates a drawn link's endpoints from id strings to node objects in place, so a string-only reader fails post-render (caught in the browser pass, fixed with regression tests).

## Goal

On `/graph`, the user picks two pages and sees the shortest chain of wiki links
between them highlighted in place, with the rest of the graph dimmed. The
answer is a *highlight over the existing graph*, not a filtered view: the point
is to see the chain in the context of the world around it.

## Why this shape

The graph already has both halves of this feature:

- `src/db/graph.ts` holds the pure graph algorithms — `nodesWithinHops` (the
  depth filter) and `connectedComponents` (island colouring). Both are pure
  functions over links, unit-tested, with no React or Dexie. A BFS belongs
  beside them, not inside the renderer.
- `GraphView` already dims: `neighbourIds` (the focused node plus its direct
  neighbours) drives an eased fade of everything else and brightens the links
  between active nodes. A path highlight is that same machine with a different
  active set.

So the design adds a pure core and generalises an existing render path. It
introduces no new pattern.

## Decisions

| Question | Decision | Why |
|---|---|---|
| How endpoints are picked | Two autocomplete "From"/"To" fields in the toolbar | Canvas clicks already mean select (single), navigate (double) and pin (drag). A third meaning needs a mode and an escape hatch; a combobox needs neither, and is keyboard-friendly. |
| Which graph the search walks | The **drawn** (filtered) graph | Keeps "what you see is what's highlighted" true — every highlighted hop is a link actually on screen. |
| When filters hide the only path | Fall back to the full graph *only to pick the message*, and say so | Distinguishes "your filters hide it" from "these pages aren't connected". Never overrides a filter the user set. |
| Several equally-short chains | Show one, deterministically | The union of tied paths degenerates into a blob: a hub in the middle yields dozens of equal-length chains, and their union is exactly the hairball the highlight exists to cut through. |
| Ghost (not-yet-created) pages | Routable iff ghosts are shown | Falls out of "walk the drawn graph". Two pages both linking `[[Mordor]]` when Mordor has no page *is* a real connection; with ghosts off, the ghost isn't drawn, so it can't be a hop. |
| 3D view | Path controls hidden while 3D is on | Precedent: the Export menu is already hidden in 3D, and the selection pulse and depth filter are already 2D-only. `GraphView3D` is deliberately a simpler companion with no focus/dim choreography. |
| Persistence | Endpoints are ephemeral component state | A persisted path would resurrect a stale highlight on a later visit, pointing at pages that may since have been deleted. |

## Components

### 1. Pure core — `src/db/graph.ts`

```ts
/** The node-id chain from `fromId` to `toId` inclusive, or null if unconnected. */
export function shortestPath(
  links: Pick<GraphLink, 'source' | 'target'>[],
  fromId: string,
  toId: string,
): string[] | null

export type PathResult =
  | { kind: 'path'; nodes: string[] }  // a chain exists in the drawn graph
  | { kind: 'hidden' }                 // none drawn, but one exists unfiltered
  | { kind: 'none' }                   // the pages are genuinely unconnected

/** Policy: search the drawn graph, and consult the full graph only to tell
 *  "filters hide it" apart from "not connected". */
export function findPath(
  drawnLinks: Pick<GraphLink, 'source' | 'target'>[],
  fullLinks: Pick<GraphLink, 'source' | 'target'>[],
  fromId: string,
  toId: string,
): PathResult
```

`shortestPath` is a breadth-first search treating links as undirected (matching
`nodesWithinHops`). Two details:

- **Determinism.** Each node's neighbours are sorted by id before expansion, so
  the same pair yields the same chain even after unrelated edits reshuffle page
  order in the link array. `connectedComponents` documents the same kind of
  stable tie-break.
- **Isolated endpoints.** A page with no links never appears in the adjacency
  map, so it correctly returns `null` with no special case. `fromId === toId`
  returns `[fromId]` (zero hops); the UI does not ask.

`findPath` exists so the three-way outcome is unit-testable without rendering a
canvas. Both are re-exported from `src/db/index.ts` (`barrel.test.ts` enforces).

### 2. Route — `src/routes/GraphRoute.tsx`

- `fromId` / `toId` as `useState`, **not** in `useGraphPrefs` (see Decisions).
- An effect clears an endpoint whose page no longer exists, mirroring the
  existing `prunePins` effect.
- One `useMemo` over `[full.links, filtered.links, fromId, toId]` calls
  `findPath`, and derives:
  - `pathIds: Set<string>` — nodes on the chain,
  - `pathEdges: Set<string>` — canonical `a|b` (a < b) keys, canonical because a
    drawn link may run either direction relative to the path.
  Both are `null` when no path is active, so `GraphView`'s existing
  "nothing focused" branch is unchanged.

### 3. UI — `src/components/GraphPathControls.tsx` (new)

`GraphRoute` is already 411 lines and the toolbar is dense, so the pickers get
their own component: two comboboxes (`From` → `To`) plus a readout —

- `3 hops · Clear`
- `No path with current filters — one exists in the unfiltered graph`
- `These pages aren't connected`

The pickers offer **every real page** (`full.nodes` minus ghosts), not just the
visible ones. Offering only visible nodes would make an endpoint that a filter
has hidden unpickable — which is precisely the case the "filters are hiding it"
message exists to explain. Ghosts are not offerable as endpoints (they aren't
pages), though a path may still *route through* one.

A path needs both endpoints; with one set, no path is active and nothing dims.
Rendered only when the 2D view is active — switching to 3D hides the controls
but keeps the endpoints, so coming back restores the highlight.

### 4. Rendering — `src/components/GraphView.tsx`

Takes `pathIds` and `pathEdges` props. The existing `neighbourIds` becomes the
fallback for a more general active set:

- **Path takes precedence over hover and selection.** Otherwise a stray mouse
  move across the canvas would wipe out an explicit query.
- Non-path nodes and links fade out through the existing `focusAmt` easing — no
  new animation code.
- Path links draw in a warm gold (`PATH_ACCENT = '#f0c060'`, added to
  `graphColor.ts`) at increased width; the two endpoints get a gold ring.
- **Node fills are left alone.** Each waypoint keeps its type/status/island
  colour, so the chain still reads as pages; and because the accent is applied
  only to strokes, it cannot collide with island-mode fills.
- On a fresh result, `zoomToFit(ms, px, node => pathIds.has(node.id))` frames
  just the path — the two endpoints are often far apart.

## Testing

Pure-core tests in `src/db/graph.test.ts` carry the weight:

- adjacent pair (1 hop) and a multi-hop chain;
- traversal *against* a link's direction (links are undirected);
- disconnected pages → `{ kind: 'none' }`;
- a path that exists only in the unfiltered links → `{ kind: 'hidden' }`;
- an isolated endpoint (degree 0) → `{ kind: 'none' }`;
- `fromId === toId` → single-element chain;
- a hop through a ghost node;
- **determinism**: shuffling the link array yields the same chain.

Plus `barrel.test.ts` pinning both new exports.

Rendering is not unit-tested — it is canvas painting, and the repo has no
precedent for testing it. The decision logic that *would* be worth testing was
deliberately pushed into `findPath`, which is pure.

## Out of scope

- **Graph image export** (`src/graphExport.ts` `buildScene`) will not render the
  path highlight in v1. Worth a follow-up issue; widening the scene contract is
  not part of answering "how are these two connected?".
- Multi-path enumeration, weighted edges, and directed-only paths.
