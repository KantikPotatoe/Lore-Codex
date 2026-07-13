# Graph shortest-path highlight — implementation plan (#127)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On `/graph`, pick two pages and highlight the shortest chain of wiki links between them, dimming the rest of the graph.

**Architecture:** A pure BFS (`shortestPath`) plus a pure policy function (`findPath`) join `nodesWithinHops` and `connectedComponents` in `src/db/graph.ts`. `GraphRoute` holds the two endpoints as ephemeral state and feeds the resulting node chain to `GraphView`, which generalises its existing hover/selection dim machinery to highlight the chain. Endpoint pickers reuse the existing `PagePicker` component.

**Tech Stack:** React 19 + TypeScript (strict), Vitest + @testing-library/react + happy-dom + fake-indexeddb, react-force-graph-2d (canvas), Dexie.

**Spec:** `docs/superpowers/specs/2026-07-14-graph-shortest-path-design.md`

## Global Constraints

- Branch: `feat/127-shortest-path` (already created, spec already committed).
- TS `strict`. Run `npm run lint`, `npm run build`, and `npm run test:run` before claiming done — CI runs all three.
- UI code reaches data through the repository seam (`pageRepo` etc.), **never** the `db` singleton. Tests are exempt from that lint rule.
- New public data-layer API must be re-exported from the `src/db` barrel. `src/db/index.ts` already does `export * from './graph'`, so new `graph.ts` exports flow through automatically — but `src/db/barrel.test.ts` pins each public function **by name** and must be updated.
- Links are undirected for all traversal (matching `nodesWithinHops`).
- The path highlight is 2D only. `GraphView3D` is deliberately a simpler companion with no focus/dim choreography.
- PR needs a version label: `version:minor` (new feature).

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/db/graph.ts` | Modify | Add `edgeKey`, `shortestPath`, `findPath`, `PathResult`. Pure, no React/Dexie. |
| `src/db/graph.test.ts` | Modify | Unit tests for the three new functions. |
| `src/db/barrel.test.ts` | Modify | Pin the new public names. |
| `src/graphColor.ts` | Modify | Add `PATH_ACCENT`. |
| `src/components/GraphView.tsx` | Modify | Accept `path: string[] \| null`; highlight it; zoom to fit it. |
| `src/components/GraphPathControls.tsx` | Create | Two `PagePicker`s + hop/status readout + Clear. |
| `src/components/GraphPathControls.test.tsx` | Create | Pin the readout messages. |
| `src/routes/GraphRoute.tsx` | Modify | Endpoint state, derived validity, `findPath` memo, wiring. |
| `src/index.css` | Modify | `.graph-path` toolbar row styles. |

---

### Task 1: Pure core — `edgeKey`, `shortestPath`, `findPath`

**Files:**
- Modify: `src/db/graph.ts`
- Modify: `src/db/graph.test.ts`
- Modify: `src/db/barrel.test.ts:29-30`

**Interfaces:**
- Consumes: `GraphLink` (already in `graph.ts`).
- Produces:
  - `edgeKey(a: string, b: string): string` — canonical undirected key `"a|b"` with `a < b`.
  - `shortestPath(links: Pick<GraphLink, 'source' | 'target'>[], fromId: string, toId: string): string[] | null`
  - `type PathResult = { kind: 'path'; nodes: string[] } | { kind: 'hidden' } | { kind: 'none' }`
  - `findPath(drawnLinks: Pick<GraphLink, 'source' | 'target'>[], fullLinks: Pick<GraphLink, 'source' | 'target'>[], fromId: string, toId: string): PathResult`

- [ ] **Step 1: Write the failing tests**

Append to `src/db/graph.test.ts` (the file already imports from `'../db'`; extend that import to include `shortestPath`, `findPath`, `edgeKey`):

```ts
// A link array in the shape buildGraphData emits (mutual is irrelevant to
// traversal, so these helpers omit it via the Pick<> parameter type).
function edge(source: string, target: string) {
  return { source, target }
}

describe('edgeKey', () => {
  it('is the same key regardless of endpoint order', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'))
  })

  it('distinguishes different pairs', () => {
    expect(edgeKey('a', 'b')).not.toBe(edgeKey('a', 'c'))
  })
})

describe('shortestPath', () => {
  it('finds a directly linked pair (1 hop)', () => {
    expect(shortestPath([edge('a', 'b')], 'a', 'b')).toEqual(['a', 'b'])
  })

  it('finds a multi-hop chain', () => {
    const links = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
    expect(shortestPath(links, 'a', 'd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('walks links against their direction (links are undirected)', () => {
    // Every link points *away* from the target, so a directed search would fail.
    const links = [edge('b', 'a'), edge('c', 'b')]
    expect(shortestPath(links, 'a', 'c')).toEqual(['a', 'b', 'c'])
  })

  it('prefers the shorter of two chains', () => {
    const links = [
      edge('a', 'x'), edge('x', 'd'), // 2 hops
      edge('a', 'p'), edge('p', 'q'), edge('q', 'd'), // 3 hops
    ]
    expect(shortestPath(links, 'a', 'd')).toEqual(['a', 'x', 'd'])
  })

  it('returns null when the pages are not connected', () => {
    expect(shortestPath([edge('a', 'b'), edge('c', 'd')], 'a', 'd')).toBeNull()
  })

  it('returns null for an isolated endpoint (a page with no links)', () => {
    // 'lonely' appears in no link, so it never enters the adjacency map.
    expect(shortestPath([edge('a', 'b')], 'a', 'lonely')).toBeNull()
  })

  it('returns a single-element chain when both endpoints are the same page', () => {
    expect(shortestPath([edge('a', 'b')], 'a', 'a')).toEqual(['a'])
  })

  it('routes through a ghost node when ghost links are present', () => {
    // Two real pages both link [[Mordor]], which has no page yet — a real
    // connection through a page that does not exist.
    const links = [edge('a', 'ghost:mordor'), edge('b', 'ghost:mordor')]
    expect(shortestPath(links, 'a', 'b')).toEqual(['a', 'ghost:mordor', 'b'])
  })

  it('is deterministic — link array order does not change the chain', () => {
    // Two equally short chains a→x→d and a→y→d exist; the answer must not
    // depend on the order links happen to arrive in.
    const links = [edge('a', 'x'), edge('x', 'd'), edge('a', 'y'), edge('y', 'd')]
    const reversed = [...links].reverse()
    const first = shortestPath(links, 'a', 'd')
    expect(shortestPath(reversed, 'a', 'd')).toEqual(first)
    expect(first).toEqual(['a', 'x', 'd']) // 'x' < 'y', so 'x' wins the tie
  })
})

describe('findPath', () => {
  const full = [edge('a', 'b'), edge('b', 'c')]

  it('reports a chain that exists in the drawn graph', () => {
    expect(findPath(full, full, 'a', 'c')).toEqual({ kind: 'path', nodes: ['a', 'b', 'c'] })
  })

  it('reports "hidden" when only the filters break the chain', () => {
    // The drawn graph is missing b→c, but the full graph still connects a and c.
    const drawn = [edge('a', 'b')]
    expect(findPath(drawn, full, 'a', 'c')).toEqual({ kind: 'hidden' })
  })

  it('reports "none" when the pages are unconnected even unfiltered', () => {
    expect(findPath(full, full, 'a', 'zz')).toEqual({ kind: 'none' })
  })
})
```

Add the new names to `EXPECTED_FUNCTIONS` in `src/db/barrel.test.ts` — replace the `graph.ts` group (currently lines 29-30):

```ts
  // graph.ts
  'buildGraphData', 'nodesWithinHops', 'connectedComponents', 'shortestPath', 'findPath', 'edgeKey',
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/db/graph.test.ts src/db/barrel.test.ts`
Expected: FAIL — `shortestPath`, `findPath`, `edgeKey` are not exported from `'../db'`.

- [ ] **Step 3: Implement**

In `src/db/graph.ts`, replace the inline canonical-key expression inside `buildGraphData` so there is one definition of the key. The current line is:

```ts
      const key = page.id < targetId ? `${page.id}|${targetId}` : `${targetId}|${page.id}`
```

becomes:

```ts
      const key = edgeKey(page.id, targetId)
```

Add `edgeKey` near the top of the file (just after the `endId` helper), and the two path functions at the end of the file:

```ts
/** Canonical key for an undirected edge: the same pair of ids always produces
 *  the same key regardless of which end is the source. Lets a drawn link be
 *  matched against a path whose hops may run the other way. */
export function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}
```

```ts
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
 *  simply has no path — no special case needed. */
export function shortestPath(
  links: Pick<GraphLink, 'source' | 'target'>[],
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
    link(l.source, l.target)
    link(l.target, l.source)
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
  drawnLinks: Pick<GraphLink, 'source' | 'target'>[],
  fullLinks: Pick<GraphLink, 'source' | 'target'>[],
  fromId: string,
  toId: string,
): PathResult {
  const drawn = shortestPath(drawnLinks, fromId, toId)
  if (drawn) return { kind: 'path', nodes: drawn }
  return shortestPath(fullLinks, fromId, toId) ? { kind: 'hidden' } : { kind: 'none' }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/db/graph.test.ts src/db/barrel.test.ts`
Expected: PASS (all new cases green; the pre-existing `buildGraphData` tests still pass, proving the `edgeKey` refactor is behaviour-preserving).

- [ ] **Step 5: Commit**

```bash
git add src/db/graph.ts src/db/graph.test.ts src/db/barrel.test.ts
git commit -m "feat: pure shortest-path core for the relationship graph (#127)"
```

---

### Task 2: Highlight the path in `GraphView`

**Files:**
- Modify: `src/graphColor.ts`
- Modify: `src/components/GraphView.tsx`

**Interfaces:**
- Consumes: `edgeKey` from Task 1.
- Produces: `PATH_ACCENT` (exported from `src/graphColor.ts`); `GraphView` gains one prop, `path: string[] | null` (the ordered node-id chain, or null when no path is active).

There is no test step here: this is canvas painting, and the repo has no precedent for testing it. The logic worth testing was deliberately pushed into `findPath` (Task 1). Verification is by eye in Task 4.

- [ ] **Step 1: Add the accent colour**

In `src/graphColor.ts`, below the `TAG_ACCENT` / `MUTED` block:

```ts
// The shortest-path highlight. Applied to link strokes and endpoint rings only —
// never to node fills — so a highlighted chain still shows each page's type or
// island colour, and the accent can't collide with an island fill.
export const PATH_ACCENT = '#f0c060'
```

- [ ] **Step 2: Take the `path` prop and derive the highlight sets**

In `src/components/GraphView.tsx`, extend the imports:

```ts
import { type GraphData, type GraphNode, type GraphLink, edgeKey } from '../db'
import { nodeFill, PATH_ACCENT, type ColorBy } from '../graphColor'
```

Add `path` to the props type and the destructured parameter list (place it after `selectedId`):

```ts
  path: string[] | null
```

Then, replacing the existing `focusId` / `neighbourIds` block (currently around lines 101-106):

```ts
  // A path is an explicit, sticky query, so it wins over hover and selection —
  // otherwise a stray mouse move across the canvas would wipe out the answer.
  const pathIds = useMemo(() => (path ? new Set(path) : null), [path])
  const pathEdges = useMemo(() => {
    if (!path) return null
    const keys = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) keys.add(edgeKey(path[i], path[i + 1]))
    return keys
  }, [path])
  const pathEnds = useMemo(
    () => (path && path.length > 0 ? [path[0], path[path.length - 1]] : null),
    [path],
  )

  const focusId = pathIds ? null : (hoverId ?? selectedId)
  const neighbourIds = useMemo(
    () => (focusId ? neighboursOf(focusId, data.links as GLink[]) : null),
    [focusId, data.links],
  )
  // What stays lit; everything else fades out. The path supersedes the
  // hover/selection neighbourhood.
  const activeIds = pathIds ?? neighbourIds
```

- [ ] **Step 3: Paint the path**

In `paintNode`, swap the two `neighbourIds` reads for `activeIds` — the easing target (line ~124) and the dim test (line ~129):

```ts
      const target = activeIds != null ? 1 : 0
```
```ts
      const isDim = activeIds != null && !activeIds.has(String(node.id))
```

and the label condition (line ~159):

```ts
      if (globalScale > 1.2 || (activeIds != null && !isDim)) {
```

Then ring the two endpoints. Insert this immediately after the ghost/fill `if/else` block and before the label block:

```ts
      // Ring the two endpoints so they read as the question, not just waypoints.
      if (pathEnds && (String(node.id) === pathEnds[0] || String(node.id) === pathEnds[1])) {
        ctx.beginPath()
        ctx.arc(x, y, r + 3 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = PATH_ACCENT
        ctx.lineWidth = 2 / globalScale
        ctx.stroke()
        ctx.lineWidth = 1
      }
```

Update `paintNode`'s dependency array:

```ts
    [activeIds, pathEnds, colorBy, highlightTag, islandColors],
```

Replace `linkColor` and `linkWidth` (currently lines ~201-214):

```ts
  const linkColor = useCallback(
    (link: GLink) => {
      const onPath = pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))
      if (pathEdges) return onPath ? PATH_ACCENT : 'rgba(160,160,160,0.08)'
      // Mutual (A↔B) links read as the stronger ties: brighter and bluer at rest
      // than the greyer one-way links.
      if (neighbourIds == null) return link.mutual ? 'rgba(150,180,255,0.5)' : 'rgba(160,160,160,0.28)'
      const active = neighbourIds.has(endId(link.source)) && neighbourIds.has(endId(link.target))
      if (!active) return 'rgba(160,160,160,0.08)'
      return link.mutual ? 'rgba(190,210,255,0.95)' : 'rgba(170,185,225,0.7)'
    },
    [pathEdges, neighbourIds],
  )

  // Mutual links also draw thicker, so reciprocity reads even without colour;
  // a path hop draws thicker still.
  const linkWidth = useCallback(
    (link: GLink) => {
      if (pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))) return 4
      return link.mutual ? 2.5 : 1
    },
    [pathEdges],
  )
```

- [ ] **Step 4: Frame the path when it changes**

Add this effect after the existing "ease the camera to the selected node" effect. It keys on a string rather than the array so an unrelated filter change (which rebuilds the array with identical contents) does not re-zoom:

```ts
  // Frame the whole chain when a new path arrives — its endpoints are usually
  // far apart. Keyed on the chain's contents, not the array identity.
  const pathKey = path ? path.join('>') : ''
  useEffect(() => {
    if (!pathKey || !fgRef.current) return
    const ids = new Set(pathKey.split('>'))
    fgRef.current.zoomToFit(450, 60, (n: GNode) => ids.has(String(n.id)))
  }, [pathKey])
```

- [ ] **Step 5: Verify it compiles**

Run: `npx tsc -b`
Expected: one error — `GraphRoute.tsx` does not pass the new required `path` prop. That is Task 4; nothing else may error.

- [ ] **Step 6: Commit**

```bash
git add src/graphColor.ts src/components/GraphView.tsx
git commit -m "feat: highlight a node chain in the graph canvas (#127)"
```

---

### Task 3: `GraphPathControls`

**Files:**
- Create: `src/components/GraphPathControls.tsx`
- Create: `src/components/GraphPathControls.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `PathResult` from Task 1; the existing `PagePicker` (`src/components/PagePicker.tsx`), whose relevant props are `value: string[]`, `onChange: (ids: string[]) => void`, `multiple?: boolean`, `placeholder?: string`. With `multiple={false}` it replaces its value on each pick. It lists **every** real page via its own `useLiveQuery` — which is what the spec wants, since an endpoint hidden by a filter must still be pickable.
- Produces: default-exported `GraphPathControls` with props `{ fromId: string | null; toId: string | null; onFrom: (id: string | null) => void; onTo: (id: string | null) => void; result: PathResult | null }`.

- [ ] **Step 1: Write the failing test**

Create `src/components/GraphPathControls.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { db } from '../db'
import GraphPathControls from './GraphPathControls'

// PagePicker reads pages through useLiveQuery, so the DB must be cleaned between
// tests and the React tree unmounted (an unmounted liveQuery otherwise touches
// `window` at teardown).
afterEach(async () => {
  cleanup()
  await db.pages.clear()
})

const noop = () => {}

describe('GraphPathControls', () => {
  it('reports the hop count of a found path', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'path', nodes: ['a', 'b', 'c'] }}
      />,
    )
    expect(screen.getByText('2 hops')).toBeTruthy()
  })

  it('singularises a one-hop path', () => {
    render(
      <GraphPathControls
        fromId="a" toId="b" onFrom={noop} onTo={noop}
        result={{ kind: 'path', nodes: ['a', 'b'] }}
      />,
    )
    expect(screen.getByText('1 hop')).toBeTruthy()
  })

  it('blames the filters when a path exists only in the unfiltered graph', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'hidden' }}
      />,
    )
    expect(screen.getByText(/No path with current filters/)).toBeTruthy()
  })

  it('says so when the pages are genuinely unconnected', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'none' }}
      />,
    )
    expect(screen.getByText(/aren’t connected/)).toBeTruthy()
  })

  it('asks for two different pages when both endpoints are the same', () => {
    render(
      <GraphPathControls
        fromId="a" toId="a" onFrom={noop} onTo={noop} result={null}
      />,
    )
    expect(screen.getByText('Pick two different pages')).toBeTruthy()
  })

  it('clears both endpoints', () => {
    const onFrom = vi.fn()
    const onTo = vi.fn()
    render(
      <GraphPathControls
        fromId="a" toId="b" onFrom={onFrom} onTo={onTo}
        result={{ kind: 'path', nodes: ['a', 'b'] }}
      />,
    )
    screen.getByRole('button', { name: 'Clear' }).click()
    expect(onFrom).toHaveBeenCalledWith(null)
    expect(onTo).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/components/GraphPathControls.test.tsx`
Expected: FAIL — cannot resolve `./GraphPathControls`.

- [ ] **Step 3: Implement the component**

Create `src/components/GraphPathControls.tsx`:

```tsx
import type { PathResult } from '../db'
import PagePicker from './PagePicker'

/** What the readout says for each outcome. Pure, so the wording is pinned by
 *  tests without rendering the graph canvas. */
function readout(result: PathResult | null, sameTwice: boolean): string {
  if (sameTwice) return 'Pick two different pages'
  if (!result) return ''
  if (result.kind === 'none') return 'These pages aren’t connected'
  if (result.kind === 'hidden') return 'No path with current filters — one exists in the unfiltered graph'
  const hops = result.nodes.length - 1
  return `${hops} hop${hops === 1 ? '' : 's'}`
}

/** The "how is this villain connected to that city?" control: two page pickers
 *  and the answer. The pickers offer every real page, not just the visible ones —
 *  an endpoint that a filter has hidden must still be pickable, since that is
 *  exactly the case the "filters are hiding it" message explains. */
export default function GraphPathControls({
  fromId, toId, onFrom, onTo, result,
}: {
  fromId: string | null
  toId: string | null
  onFrom: (id: string | null) => void
  onTo: (id: string | null) => void
  result: PathResult | null
}) {
  const sameTwice = fromId !== null && fromId === toId
  const message = readout(result, sameTwice)

  return (
    <div className="graph-path">
      <span className="graph-path-label">Path</span>
      <PagePicker
        multiple={false}
        placeholder="From…"
        value={fromId ? [fromId] : []}
        onChange={(ids) => onFrom(ids[0] ?? null)}
      />
      <span className="graph-path-arrow">→</span>
      <PagePicker
        multiple={false}
        placeholder="To…"
        value={toId ? [toId] : []}
        onChange={(ids) => onTo(ids[0] ?? null)}
      />
      {message && <span className="graph-path-msg">{message}</span>}
      {(fromId || toId) && (
        <button
          className="ghost-btn"
          onClick={() => {
            onFrom(null)
            onTo(null)
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Style the toolbar row**

Append to `src/index.css`, next to the other `.graph-*` rules (after the `.graph-search-results` block, around line 1450):

```css
/* The path row occupies a full line of the wrapping toolbar flexbox, so the two
   pickers and the answer stay together instead of being split mid-control. */
.graph-path {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-basis: 100%;
}
.graph-path-label,
.graph-path-arrow {
  color: var(--ink-dim);
  font-family: var(--sans);
  font-size: 14px;
}
.graph-path .ref-field {
  min-width: 180px;
}
.graph-path-msg {
  color: var(--ink-faint);
  font-family: var(--sans);
  font-size: 14px;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:run -- src/components/GraphPathControls.test.tsx`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/GraphPathControls.tsx src/components/GraphPathControls.test.tsx src/index.css
git commit -m "feat: From/To path pickers and hop readout for the graph (#127)"
```

---

### Task 4: Wire it into `GraphRoute`

**Files:**
- Modify: `src/routes/GraphRoute.tsx`

**Interfaces:**
- Consumes: `findPath` / `PathResult` (Task 1), `GraphView`'s `path` prop (Task 2), `GraphPathControls` (Task 3).
- Produces: nothing downstream — this is the top of the tree.

- [ ] **Step 1: Add the endpoint state and the path memo**

Extend the `'../db'` import with `findPath`, and add the component import:

```ts
import { pageRepo, buildGraphData, categoryColor, statusColor, STATUSES, nodesWithinHops, connectedComponents, findPath, type GraphNode, type LorePage } from '../db'
import GraphPathControls from '../components/GraphPathControls'
```

After the existing `const [selectedId, setSelectedId] = useState<string | null>(null)`:

```ts
  // Path endpoints are deliberately NOT persisted in useGraphPrefs: a stored path
  // would resurrect a stale highlight on a later visit, pointing at pages that may
  // since have been deleted.
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
```

Then, after the `filtered` memo, derive validity and the path (deriving rather than
pruning through an effect — mirroring how the codebase derives from `useLiveQuery`
data instead of mirroring it into state):

```ts
  // A page can be deleted while its id still sits in an endpoint; drop it by
  // derivation rather than by writing state from an effect.
  const liveIds = useMemo(() => new Set(full.nodes.map((n) => n.id)), [full])
  const fromValid = fromId && liveIds.has(fromId) ? fromId : null
  const toValid = toId && liveIds.has(toId) ? toId : null

  const pathResult = useMemo(() => {
    if (!fromValid || !toValid || fromValid === toValid) return null
    return findPath(filtered.links, full.links, fromValid, toValid)
  }, [filtered.links, full.links, fromValid, toValid])

  const path = pathResult?.kind === 'path' ? pathResult.nodes : null
```

- [ ] **Step 2: Render the controls and pass the path**

Add the controls as the last child of `<div className="graph-toolbar">`, immediately **before** the `<span className="graph-hint">` element. They hide in 3D, exactly as the Export menu already does:

```tsx
        {!threeD && (
          <GraphPathControls
            fromId={fromValid}
            toId={toValid}
            onFrom={setFromId}
            onTo={setToId}
            result={pathResult}
          />
        )}
```

Pass the chain to the 2D view — add one prop to the existing `<GraphView … />`:

```tsx
              path={path}
```

- [ ] **Step 3: Verify the whole suite, lint, and build**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass, with no `path`-prop type error remaining.

- [ ] **Step 4: Verify in the real app**

Run: `npm run dev`, open http://localhost:5174/#/graph on a world with linked pages, and confirm:

1. Picking two connected pages dims the rest and draws a gold chain between them; the readout shows the hop count and the view frames the chain.
2. The two endpoints carry a gold ring; waypoints keep their own type colour.
3. Hovering another node does **not** destroy the highlight.
4. Turning up "Min links" until a hop disappears switches the readout to "No path with current filters — one exists in the unfiltered graph".
5. Two pages in different islands report "These pages aren’t connected".
6. Toggling 3D hides the controls; toggling back restores the highlight.
7. "Clear" empties both pickers and restores the normal graph.

- [ ] **Step 5: Commit**

```bash
git add src/routes/GraphRoute.tsx
git commit -m "feat: pick two pages and highlight the chain between them (#127)"
```

---

### Task 5: Document and open the PR

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the architecture note**

In `CLAUDE.md`, in the "Relationship graph" section, append to the existing paragraph:

```markdown
`shortestPath()`/`findPath()` (pure, in `db/graph.ts`) back the graph's **path highlight**: two `PagePicker`s in `GraphPathControls` pick endpoints, BFS runs over the *drawn* links so every highlighted hop is on screen, and the full links are consulted only to tell "your filters hide it" (`kind:'hidden'`) apart from "not connected" (`kind:'none'`). `GraphView` reuses its hover/selection dim machinery for the chain, and the path outranks hover so a stray mouse move can't wipe the answer. 2D only, like the selection pulse and depth filter.
```

- [ ] **Step 2: Commit, push, and open the PR**

```bash
git add CLAUDE.md
git commit -m "docs: note the graph path highlight (#127)"
git push -u origin feat/127-shortest-path
gh pr create --title "feat: shortest path between two pages in the graph (#127)" --label version:minor --body "$(cat <<'EOF'
Closes #127.

Pick two pages in the graph toolbar and the shortest chain of wiki links between them is highlighted in gold, with the rest of the graph dimmed.

- **Pure core** (`src/db/graph.ts`): `shortestPath` (BFS, undirected, neighbours expanded in id order so the answer is stable across unrelated edits) and `findPath` (policy: search the drawn graph; consult the full graph only to choose the message).
- **The search walks the drawn graph**, so every highlighted hop is a link actually on screen. When filters hide the only chain, the readout says so rather than claiming the pages are unconnected.
- **Rendering** reuses `GraphView`'s existing hover/selection dim machinery; the path outranks hover, so a stray mouse move can't wipe out an explicit query. Node fills are untouched — only strokes and endpoint rings take the accent, so waypoints keep their type colour.
- Endpoint pickers reuse the existing `PagePicker`. 2D only, like the selection pulse and depth filter.

Graph image export doesn't render the highlight yet — noted as a follow-up in the spec.
EOF
)"
```

---

## Self-Review

**Spec coverage:** every spec section maps to a task — pure core → Task 1; route wiring, endpoint state and derived validity → Task 4; `GraphPathControls` and the three readout messages → Task 3; `GraphView` rendering, accent, endpoint rings, zoom-to-fit, path-over-hover precedence → Task 2; the full test list → Tasks 1 and 3; the 3D and persistence decisions → Tasks 4 and 4 respectively.

**Deviation from spec (deliberate, an improvement):** the spec said `GraphPathControls` would carry its *own* comboboxes. It reuses the existing `PagePicker` instead — same behaviour (single-select, lists every real page, ghosts not offerable), already tested, no duplicated combobox. The spec's `NodePicker` idea is dropped as YAGNI.

**Correction to the spec's stated file list:** the spec says both new functions must be added to `src/db/index.ts`. They don't — the barrel already does `export * from './graph'`. What *does* need updating is `barrel.test.ts`, which pins names explicitly. Task 1 does that.

**Type consistency:** `PathResult` is defined once (Task 1) and consumed with the same shape in Tasks 3 and 4. `edgeKey` is defined in Task 1 and used in Task 2. `path: string[] | null` is the single prop `GraphView` gains (Task 2) and the single value `GraphRoute` passes (Task 4). `PagePicker`'s props are quoted from the real component.
