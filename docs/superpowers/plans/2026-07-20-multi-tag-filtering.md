# Multi-tag Graph Filtering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the graph toolbar's single-tag `<select>` with toggleable tag chips filtered by an AND/OR match mode.

**Architecture:** A new pure module `src/tagFilter.ts` owns the predicate (`matchesTags`); `src/tags.ts` gains the pure chip-ordering helper. `useGraphPrefs` stores `tags: string[]` + `tagMode` in the existing `graph-view` meta row, read-migrating the legacy `tag` string. `nodeFill`/`buildScene` take a `TagFilter` instead of a `highlightTag` string, so colour-by-tag accents whatever the filter predicate matches. `GraphRoute` renders chips reusing the existing `.graph-chip` CSS.

**Tech Stack:** React 19, TypeScript (strict), Dexie + `useLiveQuery`, Vitest + happy-dom + `@testing-library/react`.

## Global Constraints

- TypeScript `strict`. Every task must leave `npm run lint`, `npm run build`, and `npm run test:run` green before its commit.
- `src/tagFilter.ts` must not import from `src/db` at runtime — it takes `string[]`, not nodes. A runtime db import would drag in the Dexie singleton and force the module into `src/db/`.
- Do **not** add `tagFilter.ts` to the `src/db/index.ts` barrel — it lives at `src/`, outside the data layer, like `tags.ts` and `graphColor.ts`.
- UI code reaches data through repositories only; this feature adds no new data access.
- Scope is the graph route. Do not touch `/tag/:tag`, `TagRoute`, `BrowseGrid`, or the sidebar Tags group.
- Chip labels render as `#<tag>`; the mode button reads exactly `⋂ Match all` / `⋃ Match any`.
- `TAG_CHIP_LIMIT` is `12`.

---

### Task 1: Pure tag predicate

**Files:**
- Create: `src/tagFilter.ts`
- Test: `src/tagFilter.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type TagMode = 'any' | 'all'`; `interface TagFilter { tags: string[]; mode: TagMode }`; `const NO_TAG_FILTER: TagFilter`; `function matchesTags(nodeTags: string[], f: TagFilter): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/tagFilter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { matchesTags, NO_TAG_FILTER, type TagFilter } from './tagFilter'

const filter = (tags: string[], mode: TagFilter['mode']): TagFilter => ({ tags, mode })

describe('matchesTags', () => {
  it('passes everything when no tags are selected', () => {
    expect(matchesTags([], NO_TAG_FILTER)).toBe(true)
    expect(matchesTags(['magic'], NO_TAG_FILTER)).toBe(true)
    expect(matchesTags([], filter([], 'all'))).toBe(true)
  })

  it('any mode matches a node carrying at least one selected tag', () => {
    expect(matchesTags(['magic', 'lore'], filter(['magic', 'norse'], 'any'))).toBe(true)
  })

  it('any mode rejects a node carrying none of them', () => {
    expect(matchesTags(['lore'], filter(['magic', 'norse'], 'any'))).toBe(false)
  })

  it('all mode requires every selected tag', () => {
    expect(matchesTags(['magic', 'norse', 'lore'], filter(['magic', 'norse'], 'all'))).toBe(true)
    expect(matchesTags(['magic'], filter(['magic', 'norse'], 'all'))).toBe(false)
  })

  it('behaves like the old single-tag filter for one tag in either mode', () => {
    expect(matchesTags(['magic'], filter(['magic'], 'any'))).toBe(true)
    expect(matchesTags(['magic'], filter(['magic'], 'all'))).toBe(true)
    expect(matchesTags(['lore'], filter(['magic'], 'any'))).toBe(false)
    expect(matchesTags(['lore'], filter(['magic'], 'all'))).toBe(false)
  })

  it('ignores duplicate node tags', () => {
    expect(matchesTags(['magic', 'magic'], filter(['magic', 'norse'], 'all'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tagFilter.test.ts`
Expected: FAIL — `Failed to resolve import "./tagFilter"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/tagFilter.ts`:

```ts
/** How a multi-tag selection combines when filtering the graph. */
export type TagMode = 'any' | 'all'

/** A tag selection plus the rule for combining it. */
export interface TagFilter {
  tags: string[]
  mode: TagMode
}

/** Stable identity for "nothing selected", so consumers' useMemo deps don't
 *  churn while the filter is empty. */
export const NO_TAG_FILTER: TagFilter = { tags: [], mode: 'any' }

/** Does a node's tag list satisfy the filter? An empty selection is not a
 *  filter at all, so everything passes. Callers that need "nothing selected
 *  means nothing matches" — colour-by-tag highlighting — check `tags.length`
 *  themselves rather than overloading this. */
export function matchesTags(nodeTags: string[], f: TagFilter): boolean {
  if (f.tags.length === 0) return true
  const has = new Set(nodeTags)
  return f.mode === 'all' ? f.tags.every((t) => has.has(t)) : f.tags.some((t) => has.has(t))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tagFilter.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/tagFilter.ts src/tagFilter.test.ts
git commit -m "feat: pure multi-tag match predicate (#129)"
```

---

### Task 2: Chip ordering helper

**Files:**
- Modify: `src/tags.ts` (append after `tagCounts`)
- Test: `src/tags.test.ts` (append a new `describe`)

**Interfaces:**
- Consumes: `tagCounts(pages)` output shape `{ tag: string; count: number }[]`.
- Produces: `function orderTagChips(counts: { tag: string; count: number }[], selected: Set<string>, limit: number): { shown: string[]; hiddenCount: number }`.

- [ ] **Step 1: Write the failing test**

Append to `src/tags.test.ts` (and add `orderTagChips` to the existing `import { tagCounts } from './tags'` line):

```ts
describe('orderTagChips', () => {
  const counts = [
    { tag: 'a', count: 5 },
    { tag: 'b', count: 4 },
    { tag: 'c', count: 3 },
    { tag: 'd', count: 2 },
  ]

  it('shows everything when the limit exceeds the tag count', () => {
    expect(orderTagChips(counts, new Set(), 10)).toEqual({
      shown: ['a', 'b', 'c', 'd'],
      hiddenCount: 0,
    })
  })

  it('truncates to the limit, keeping count order', () => {
    expect(orderTagChips(counts, new Set(), 2)).toEqual({
      shown: ['a', 'b'],
      hiddenCount: 2,
    })
  })

  it('promotes a selected tag that would otherwise be truncated', () => {
    expect(orderTagChips(counts, new Set(['d']), 2)).toEqual({
      shown: ['a', 'd'],
      hiddenCount: 2,
    })
  })

  it('never grows the row past the limit when promoting', () => {
    const { shown } = orderTagChips(counts, new Set(['c', 'd']), 2)
    expect(shown).toEqual(['c', 'd'])
  })

  it('shows every selected tag even past the limit', () => {
    expect(orderTagChips(counts, new Set(['b', 'c', 'd']), 2)).toEqual({
      shown: ['b', 'c', 'd'],
      hiddenCount: 1,
    })
  })

  it('handles no tags at all', () => {
    expect(orderTagChips([], new Set(), 12)).toEqual({ shown: [], hiddenCount: 0 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/tags.test.ts`
Expected: FAIL — `"orderTagChips" is not exported by "src/tags.ts"`.

- [ ] **Step 3: Write minimal implementation**

Append to `src/tags.ts`:

```ts
/** Pick which tag chips the graph toolbar shows: the most-used `limit` tags,
 *  in `counts` order, with every selected tag force-promoted so a live
 *  selection can never hide behind the "+N more" disclosure. Promotion
 *  displaces the lowest-ranked unselected chip rather than growing the row, so
 *  `shown` only exceeds `limit` when more than `limit` tags are selected. */
export function orderTagChips(
  counts: { tag: string; count: number }[],
  selected: Set<string>,
  limit: number,
): { shown: string[]; hiddenCount: number } {
  const ordered = counts.map((c) => c.tag)
  const picked = new Set(ordered.filter((t) => selected.has(t)))
  for (const t of ordered) {
    if (picked.size >= limit) break
    picked.add(t)
  }
  // Re-read in count order so promotion doesn't reshuffle the row.
  const shown = ordered.filter((t) => picked.has(t))
  return { shown, hiddenCount: ordered.length - shown.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/tags.test.ts`
Expected: PASS — 4 existing `tagCounts` tests + 6 new ones.

- [ ] **Step 5: Commit**

```bash
git add src/tags.ts src/tags.test.ts
git commit -m "feat: order graph tag chips by count with selection promotion (#129)"
```

---

### Task 3: Thread `TagFilter` through colouring and export

Signature change only — behaviour is identical afterwards, because `GraphRoute` still holds a single tag and wraps it as `{ tags: tag ? [tag] : [], mode: 'any' }`. Task 5 removes that wrapper.

**Files:**
- Modify: `src/graphColor.ts:50-65`
- Modify: `src/graphExport.ts:74`, `src/graphExport.ts:87`
- Modify: `src/components/GraphView.tsx:56`, `:172`, `:197`
- Modify: `src/components/GraphView3D.tsx:34`, `:56-57`
- Modify: `src/routes/GraphRoute.tsx:169`, `:403`, `:413`
- Test: `src/graphColor.test.ts`, `src/graphExport.test.ts`

**Interfaces:**
- Consumes: `matchesTags`, `TagFilter`, `NO_TAG_FILTER` from Task 1.
- Produces: `nodeFill(node: GraphNode, colorBy: ColorBy, tagFilter: TagFilter, islandColors?: Map<string, string>): string`; `buildScene(data, opts: { colorBy: ColorBy; tagFilter: TagFilter; islandColors: Map<string, string> })`; `GraphView` / `GraphView3D` prop `tagFilter: TagFilter` replacing `highlightTag: string`.

- [ ] **Step 1: Write the failing test**

Replace the `nodeFill` and `nodeFill island mode` describes in `src/graphColor.test.ts` with these, and update the import line to `import { nodeFill, TAG_ACCENT, MUTED, ISLAND_PALETTE, islandColorOf } from './graphColor'` plus a new `import { NO_TAG_FILTER, type TagFilter } from './tagFilter'`:

```ts
const filter = (tags: string[], mode: TagFilter['mode'] = 'any'): TagFilter => ({ tags, mode })

describe('nodeFill', () => {
  it('colours by category in type mode', () => {
    expect(nodeFill(node({ category: 'Character' }), 'type', NO_TAG_FILTER)).toBe(categoryColor('Character'))
  })

  it('colours by status in status mode', () => {
    expect(nodeFill(node({ status: 'Complete' }), 'status', NO_TAG_FILTER)).toBe(statusColor('Complete'))
  })

  it('accents a node carrying the highlighted tag', () => {
    expect(nodeFill(node({ tags: ['Faction', 'Magic'] }), 'tag', filter(['Magic']))).toBe(TAG_ACCENT)
  })

  it('mutes a node without the highlighted tag', () => {
    expect(nodeFill(node({ tags: ['Faction'] }), 'tag', filter(['Magic']))).toBe(MUTED)
  })

  it('mutes every node when no tag is chosen in tag mode', () => {
    expect(nodeFill(node({ tags: ['Faction'] }), 'tag', NO_TAG_FILTER)).toBe(MUTED)
  })

  it('accents on either selected tag in any mode', () => {
    expect(nodeFill(node({ tags: ['Magic'] }), 'tag', filter(['Magic', 'Norse'], 'any'))).toBe(TAG_ACCENT)
  })

  it('accents only the intersection in all mode', () => {
    expect(nodeFill(node({ tags: ['Magic', 'Norse'] }), 'tag', filter(['Magic', 'Norse'], 'all'))).toBe(TAG_ACCENT)
    expect(nodeFill(node({ tags: ['Magic'] }), 'tag', filter(['Magic', 'Norse'], 'all'))).toBe(MUTED)
  })
})

describe('nodeFill island mode', () => {
  it('returns the mapped island colour for a clustered node', () => {
    const colors = new Map([['p1', ISLAND_PALETTE[1]]])
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER, colors)).toBe(ISLAND_PALETTE[1])
  })

  it('mutes a node whose id is not in the island map', () => {
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER, new Map())).toBe(MUTED)
  })

  it('mutes when no island map is provided', () => {
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER)).toBe(MUTED)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/graphColor.test.ts`
Expected: FAIL — the `all` mode case returns `TAG_ACCENT` where `MUTED` is expected (the old `includes` check ignores mode), and TypeScript rejects passing a `TagFilter` where `string` is declared.

- [ ] **Step 3: Write minimal implementation**

In `src/graphColor.ts`, add the import and replace `nodeFill`:

```ts
import { matchesTags, type TagFilter } from './tagFilter'
```

```ts
/** Fill colour for a NON-ghost graph node under the active colour mode. Ghost
 *  nodes keep their own dashed/muted rendering in the callers, so this is only
 *  ever called for real pages. */
export function nodeFill(
  node: GraphNode,
  colorBy: ColorBy,
  tagFilter: TagFilter,
  islandColors?: Map<string, string>,
): string {
  if (colorBy === 'status') return statusColor(node.status)
  if (colorBy === 'tag') {
    // The explicit length check matters: `matchesTags` treats an empty
    // selection as "passes", but an empty selection here must leave the whole
    // graph muted — there is nothing to highlight yet.
    return tagFilter.tags.length > 0 && matchesTags(node.tags, tagFilter) ? TAG_ACCENT : MUTED
  }
  if (colorBy === 'island') return islandColors?.get(node.id) ?? MUTED
  return categoryColor(node.category)
}
```

In `src/graphExport.ts`, change the `opts` type on line 74 and the `nodeFill` call on line 87, adding `import type { TagFilter } from './tagFilter'`:

```ts
  opts: { colorBy: ColorBy; tagFilter: TagFilter; islandColors: Map<string, string> },
```
```ts
      fill: ghost ? null : nodeFill(n, opts.colorBy, opts.tagFilter, opts.islandColors),
```

In `src/components/GraphView.tsx`: rename the destructured prop `highlightTag` → `tagFilter` (line 43), change its type to `tagFilter: TagFilter` (line 56, with `import type { TagFilter } from '../tagFilter'`), pass it at line 172, and swap it in the `useCallback` dep array at line 197.

Apply the identical rename in `src/components/GraphView3D.tsx` (lines 27, 34, 56, 57).

In `src/routes/GraphRoute.tsx`, add a temporary adapter above `doExport` — Task 5 replaces it:

```ts
  // Temporary bridge while `tag` is still a single string; Task 5 replaces this
  // with the real multi-tag selection from useGraphPrefs.
  const tagFilter = useMemo<TagFilter>(() => (tag ? { tags: [tag], mode: 'any' } : NO_TAG_FILTER), [tag])
```

with `import { NO_TAG_FILTER, type TagFilter } from '../tagFilter'`, then replace `highlightTag: tag` at line 169 with `tagFilter`, and both `highlightTag={tag}` props (lines 403, 413) with `tagFilter={tagFilter}`.

In `src/graphExport.test.ts`, replace `highlightTag: ''` with `tagFilter: NO_TAG_FILTER` at lines 13, 110 and 162, adding `import { NO_TAG_FILTER } from './tagFilter'`.

- [ ] **Step 4: Run the full check**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all PASS. The graph behaves exactly as before.

- [ ] **Step 5: Commit**

```bash
git add src/graphColor.ts src/graphColor.test.ts src/graphExport.ts src/graphExport.test.ts src/components/GraphView.tsx src/components/GraphView3D.tsx src/routes/GraphRoute.tsx
git commit -m "refactor: thread TagFilter through node colouring and export (#129)"
```

---

### Task 4: Store `tags` + `tagMode` in `useGraphPrefs`

**Files:**
- Modify: `src/useGraphPrefs.ts`
- Modify: `src/routes/GraphRoute.tsx` (adapter + the `<select>`, both temporary)
- Test: `src/useGraphPrefs.test.ts`

**Interfaces:**
- Consumes: `TagMode`, `TagFilter`, `NO_TAG_FILTER` from Task 1.
- Produces: on `GraphPrefs` — `tags: string[]`, `setTags: (tags: string[]) => void`, `toggleTag: (tag: string) => void`, `tagMode: TagMode`, `setTagMode: (m: TagMode) => void`. `tag` / `setTag` are removed. Also exports `migrateView(view: SavedView): SavedView`.

> Note: this replaces the spec's `clearTags()` with the more general `setTags([])` — `toggleTag` is the only other mutator the chips need, and a single `setTags` avoids two racing `meta` writes.

- [ ] **Step 1: Write the failing test**

In `src/useGraphPrefs.test.ts`: delete the `persists the selected tag to meta` test (lines 73-80), change `expect(result.current.tag).toBe('')` to `expect(result.current.tags).toEqual([])` in the defaults test (line 21) and in the backfill test (line 69), and add `expect(result.current.tagMode).toBe('any')` to the defaults test. Then append these tests inside the `describe('useGraphPrefs')` block:

```ts
  it('persists a multi-tag selection and match mode to meta', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current).toBeTruthy())
    act(() => result.current.setTags(['magic', 'norse']))
    await waitFor(() => expect(result.current.tags).toEqual(['magic', 'norse']))
    act(() => result.current.setTagMode('all'))
    await waitFor(() => expect(result.current.tagMode).toBe('all'))
    const v = await getMeta<{ tags: string[]; tagMode: string }>('graph-view')
    expect(v?.tags).toEqual(['magic', 'norse'])
    expect(v?.tagMode).toBe('all')
  })

  it('toggleTag adds then removes a tag', async () => {
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current).toBeTruthy())
    act(() => result.current.toggleTag('magic'))
    await waitFor(() => expect(result.current.tags).toEqual(['magic']))
    act(() => result.current.toggleTag('norse'))
    await waitFor(() => expect(result.current.tags).toEqual(['magic', 'norse']))
    act(() => result.current.toggleTag('magic'))
    await waitFor(() => expect(result.current.tags).toEqual(['norse']))
  })

  it('migrates a legacy single-tag row into the multi-tag shape', async () => {
    await setMeta('graph-view', { hidden: [], showArrows: false, showGhosts: true, panelOpen: false, tag: 'magic' })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.tags).toEqual(['magic']))
    expect(result.current.tagMode).toBe('any')
  })

  it('drops the legacy tag field on the next write', async () => {
    await setMeta('graph-view', { hidden: [], showArrows: false, showGhosts: true, panelOpen: false, tag: 'magic' })
    const { result } = renderHook(() => useGraphPrefs())
    await waitFor(() => expect(result.current.tags).toEqual(['magic']))
    act(() => result.current.toggleTag('norse'))
    await waitFor(() => expect(result.current.tags).toEqual(['magic', 'norse']))
    const v = await getMeta<{ tag?: string }>('graph-view')
    expect(v?.tag).toBeUndefined()
  })
```

Also add a direct unit test for the pure migration, above the `describe('useGraphPrefs')` block:

```ts
describe('migrateView', () => {
  const base = {
    hidden: [], hiddenStatuses: [], showArrows: false, showGhosts: true, threeD: false,
    panelOpen: false, tags: [], tagMode: 'any' as const, minDegree: 0, depth: 0,
    colorBy: 'type' as const, cam: null,
  }

  it('folds a legacy tag into tags and drops the field', () => {
    expect(migrateView({ ...base, tag: 'magic' })).toEqual({ ...base, tags: ['magic'] })
  })

  it('leaves a row with no legacy tag alone', () => {
    expect(migrateView(base)).toEqual(base)
  })

  it('ignores an empty legacy tag', () => {
    expect(migrateView({ ...base, tag: '' })).toEqual({ ...base, tag: '' })
  })

  it('prefers an existing tags selection over the legacy field', () => {
    const row = { ...base, tags: ['norse'], tag: 'magic' }
    expect(migrateView(row)).toEqual(row)
  })
})
```

Add `migrateView` to the `import { useGraphPrefs } from './useGraphPrefs'` line.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/useGraphPrefs.test.ts`
Expected: FAIL — `"migrateView" is not exported`, and `setTags`/`toggleTag`/`tagMode` do not exist on the hook result.

- [ ] **Step 3: Write minimal implementation**

In `src/useGraphPrefs.ts`, add `import type { TagMode } from './tagFilter'` and change `SavedView`:

```ts
interface SavedView {
  hidden: string[]
  hiddenStatuses: string[]
  showArrows: boolean
  showGhosts: boolean
  threeD: boolean
  panelOpen: boolean
  /** Legacy single-tag filter, read-migrated into `tags` and dropped on the
   *  next write. Never written by current code. */
  tag?: string
  /** Selected tag filter; empty means "all tags". */
  tags: string[]
  /** How a multi-tag selection combines. */
  tagMode: TagMode
  /** Hide nodes with fewer than this many connections (0 = show all). */
  minDegree: number
  /** When a node is selected, show only nodes within this many hops (0 = off). */
  depth: number
  /** Which dimension drives node colour: page type, status, or a highlighted tag. */
  colorBy: ColorBy
  cam: GraphCam | null
}
```

Update `DEFAULT_VIEW`: replace `tag: '',` with `tags: [],` and `tagMode: 'any',`.

Add the exported migration above `useGraphPrefs`:

```ts
/** Fold a row written before multi-tag filtering into the current shape. Safe
 *  to run on every hydrate: once a migrated row is written back, `tag` is gone
 *  and this is a no-op. An explicit `tags` selection always wins. */
export function migrateView(view: SavedView): SavedView {
  if (view.tags.length > 0 || !view.tag) return view
  const { tag: _legacy, ...rest } = view
  return { ...rest, tags: [view.tag] }
}
```

Wrap hydration in it:

```ts
  const view = useMemo(
    () => viewDraft ?? (savedView ? migrateView({ ...DEFAULT_VIEW, ...savedView }) : DEFAULT_VIEW),
    [viewDraft, savedView],
  )
```

Replace the `setTag` callback with:

```ts
  const setTags = useCallback((v: string[]) => writeView({ ...view, tags: v }), [view, writeView])
  const setTagMode = useCallback((v: TagMode) => writeView({ ...view, tagMode: v }), [view, writeView])

  const toggleTag = useCallback((tag: string) => {
    const next = view.tags.includes(tag)
      ? view.tags.filter((t) => t !== tag)
      : [...view.tags, tag]
    writeView({ ...view, tags: next })
  }, [view, writeView])
```

In the `GraphPrefs` interface, replace `tag: string` / `setTag` with:

```ts
  tags: string[]
  setTags: (tags: string[]) => void
  toggleTag: (tag: string) => void
  tagMode: TagMode
  setTagMode: (m: TagMode) => void
```

In the returned object, replace `tag: view.tag, setTag,` with `tags: view.tags, setTags, toggleTag, tagMode: view.tagMode, setTagMode,`.

Then keep `GraphRoute` compiling — destructure `tags, setTags, tagMode` instead of `tag, setTag`, and update the two temporary spots:

```ts
  const tagFilter = useMemo<TagFilter>(
    () => (tags.length > 0 ? { tags, mode: tagMode } : NO_TAG_FILTER),
    [tags, tagMode],
  )
```

The `<select>` at line 250 keeps its single-tag shape for now (Task 5 deletes it):

```tsx
        <select value={tags[0] ?? ''} onChange={(e) => setTags(e.target.value ? [e.target.value] : [])}>
```

and the two remaining `tag`-based conditions become `tags.length === 0` (line 84's `tag === ''` → `matchesTags` comes in Task 5; for now write `(colorBy === 'tag' || matchesTags(n.tags, tagFilter))` and swap the `tag` dep for `tagFilter`) and line 390's `colorBy === 'tag' && tags.length === 0`.

- [ ] **Step 4: Run the full check**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/useGraphPrefs.ts src/useGraphPrefs.test.ts src/routes/GraphRoute.tsx
git commit -m "feat: store a multi-tag selection and match mode in graph prefs (#129)"
```

---

### Task 5: Tag chips + AND/OR toggle in the toolbar

**Files:**
- Modify: `src/routes/GraphRoute.tsx` (the `tags` memo at :58-61, the `<select>` at :250-253, the hint at :389)

**Interfaces:**
- Consumes: `orderTagChips` (Task 2), `tagCounts` (existing), `tags`/`toggleTag`/`tagMode`/`setTagMode` (Task 4), `matchesTags`/`TagFilter`/`NO_TAG_FILTER` (Task 1).
- Produces: no new exports — this is the UI.

- [ ] **Step 1: Replace the tag list memo**

Delete the `tags` memo at lines 58-61 (it collides with the hook's `tags` and is superseded), and add above `maxDegree`:

```ts
  const counts = useMemo(() => tagCounts(pages), [pages])
  const selectedTags = useMemo(() => new Set(tags), [tags])
  const tagChips = useMemo(
    () => orderTagChips(counts, selectedTags, showAllTags ? counts.length : TAG_CHIP_LIMIT),
    [counts, selectedTags, showAllTags],
  )
```

with a module-level `const TAG_CHIP_LIMIT = 12` beside `NO_PAGES`/`EMPTY_ISLAND_COLORS` at the top of the file, `const [showAllTags, setShowAllTags] = useState(false)` beside the other local state (lines 41-48, above this memo), and imports `import { tagCounts, orderTagChips } from '../tags'`.

- [ ] **Step 2: Replace the `<select>` with chips**

Swap lines 250-253 for:

```tsx
        {tagChips.shown.length > 0 && (
          <div className="graph-chips">
            {tagChips.shown.map((t) => (
              <button
                key={t}
                className={`graph-chip${selectedTags.has(t) ? '' : ' off'}`}
                onClick={() => toggleTag(t)}
              >
                #{t}
              </button>
            ))}
            {tagChips.hiddenCount > 0 && (
              <button className="graph-chip" onClick={() => setShowAllTags(true)}>
                +{tagChips.hiddenCount} more
              </button>
            )}
            {tags.length >= 2 && (
              <button
                className="ghost-btn active"
                title="Match pages carrying every selected tag, or any of them"
                onClick={() => setTagMode(tagMode === 'all' ? 'any' : 'all')}
              >
                {tagMode === 'all' ? '⋂ Match all' : '⋃ Match any'}
              </button>
            )}
          </div>
        )}
```

- [ ] **Step 3: Run the full check**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all PASS.

- [ ] **Step 4: Drive it in the real app**

Run `npm run dev`, open `http://localhost:5174/#/graph` on a world with tagged pages, and confirm:
1. Tag chips render, dim when unselected, lit when selected.
2. Selecting one tag filters the graph the way the old dropdown did; the node/link counts in the hint drop.
3. Selecting a second tag reveals `⋃ Match any`; clicking it flips to `⋂ Match all` and the visible node count shrinks to the intersection.
4. With `Color by → Tag`, filtering stops and the matching nodes light up cyan against muted ones — under both modes.
5. Reload the page: chips, selection, and mode survive.
6. `⬇ Export → SVG` produces an image whose colours match the canvas.

- [ ] **Step 5: Commit**

```bash
git add src/routes/GraphRoute.tsx
git commit -m "feat: multi-tag graph filter chips with AND/OR toggle (#129)"
```

---

### Task 6: Docs and final verification

**Files:**
- Modify: `CLAUDE.md` (Relationship graph section)
- Modify: `docs/remaining-roadmap.md:92`

- [ ] **Step 1: Note the filter in CLAUDE.md**

Add to the "Relationship graph" section, after the shortest-path paragraph:

```markdown
**Multi-tag filter (`src/tagFilter.ts` + `orderTagChips` in `src/tags.ts`, both pure):** the toolbar's tag chips hold a *set* of tags plus a `TagMode` (`'any'`/`'all'`), persisted in the `graph-view` meta row; a legacy single `tag` string is read-migrated by `migrateView` and dropped on the next write. `matchesTags` is the one predicate — the node filter and colour-by-tag accenting both use it, so "colour by tag + Match all" lights up exactly the intersection the filter would show. An empty selection means "no filter" to `matchesTags` but "highlight nothing" to `nodeFill`, which is why `nodeFill` checks `tags.length` itself. Chips are count-ordered and capped at 12 with a "+N more" disclosure; selected tags are always shown.
```

- [ ] **Step 2: Tick the roadmap**

In `docs/remaining-roadmap.md`, change line 92 from `- 🟡 **Multi-tag filtering with AND/OR** (replaces the single-tag dropdown).` to `- ✅ **Multi-tag filtering with AND/OR** — shipped; replaced the single-tag dropdown.`

- [ ] **Step 3: Full verification**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three PASS. Paste the real output — do not claim success without it.

- [ ] **Step 4: Commit and open the PR**

```bash
git add CLAUDE.md docs/remaining-roadmap.md
git commit -m "docs: note the multi-tag graph filter (#129)"
git push -u origin feat/129-multi-tag-filter
gh pr create --title "feat: multi-tag graph filtering with AND/OR (#129)" --body "Closes #129" --label version:minor
```

The `version:minor` label is required — this is a new feature.
