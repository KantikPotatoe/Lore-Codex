# Multi-tag filtering with AND/OR (issue #129)

Replace the graph toolbar's single-tag `<select>` with a set of toggleable tag
chips plus an AND/OR match mode.

## Problem

`GraphRoute` filters by exactly one tag, held as `view.tag: string` in
`useGraphPrefs`. That string does double duty: it is the filter when
`colorBy !== 'tag'`, and the *highlight* tag when `colorBy === 'tag'` (see
`graphColor.nodeFill`, and `buildScene`'s `highlightTag` for PNG/SVG export).
One tag is not enough to ask "which pages are both `norse` and `canon`?" — the
question the graph is most useful for.

## Scope

Graph route only. `/tag/:tag`, the sidebar Tags group, and the search index are
untouched; extending them is a separate issue.

## Design

### 1. `src/tagFilter.ts` (new, pure)

```ts
export type TagMode = 'any' | 'all'
export interface TagFilter { tags: string[]; mode: TagMode }
export const NO_TAG_FILTER: TagFilter = { tags: [], mode: 'any' }
export function matchesTags(nodeTags: string[], f: TagFilter): boolean
```

`matchesTags` returns `true` when `f.tags` is empty — no filter means everything
passes. It takes `string[]`, not a node, so it has no db import at all and
belongs at `src/` rather than `src/db/`.

Chip ordering is equally pure and joins `tagCounts()` in the existing
`src/tags.ts`:

```ts
export function orderTagChips(
  counts: { tag: string; count: number }[],
  selected: Set<string>,
  limit: number,
): { shown: string[]; hiddenCount: number }
```

Count-ordered (ties alphabetical, inherited from `tagCounts`), truncated to
`limit`, with any selected tag force-promoted into `shown` so a live selection
can never hide behind the "+N more" disclosure. Promotion replaces the
lowest-ranked unselected chip rather than growing the row, so `shown.length`
never exceeds `limit` (unless more than `limit` tags are selected, in which case
every selected tag is shown). `hiddenCount` is always
`counts.length - shown.length`.

### 2. `useGraphPrefs`

`SavedView` gains `tags: string[]` and `tagMode: TagMode`; the legacy
`tag?: string` stays declared, optional, for reads only.

An exported pure `migrateView(saved: SavedView): SavedView` seeds
`tags: [saved.tag]` when a non-empty legacy `tag` is present and `tags` is
absent. The legacy field is dropped on the next write. Existing worlds keep
their filter instead of silently resetting.

Public API replaces `tag` / `setTag` with:

- `tags: string[]`
- `toggleTag(tag: string): void`
- `clearTags(): void`
- `tagMode: TagMode`
- `setTagMode(m: TagMode): void`

### 3. Colour and export threading

`nodeFill(node, colorBy, tagFilter, islandColors)` replaces the
`highlightTag: string` parameter. Five call sites: `GraphView`, `GraphView3D`,
`graphExport.buildScene` (opts field `tagFilter`), and two test files.

In `colorBy === 'tag'` mode a node is accented iff
`tagFilter.tags.length > 0 && matchesTags(node.tags, tagFilter)`, otherwise
`MUTED`. The explicit length check matters: `matchesTags` treats an empty set as
"passes", but an empty selection in colour mode must leave the whole graph muted
— today's behaviour, paired with the toolbar's "select a tag to highlight" hint.

So "colour by tag + Match all" lights up exactly the intersection against a
muted world, which is the same predicate the filter uses. One selection, one
meaning.

### 4. `GraphRoute`

The `<select>` is replaced by:

- A `graph-chips` row of tag chips, reusing the existing category/status chip
  CSS. Chips come from `orderTagChips(tagCounts(pages), selected, 12)`; a
  `+N more` button expands the remainder. Expansion is local `useState` — it is
  view-transient, not a preference worth a `meta` write.
- A `ghost-btn` reading `⋂ Match all` / `⋃ Match any`, rendered only when two or
  more tags are selected. With 0 or 1 tags the mode has no effect, so showing it
  would be noise.

The node predicate becomes
`(colorBy === 'tag' || matchesTags(n.tags, tagFilter))` — the existing rule that
tag *filtering* is suppressed while colouring by tag is unchanged. `filtered`'s
dep array swaps `tag` for `tags` and `tagMode`.

Toolbar hints: `— select a tag to highlight` now fires on `tags.length === 0`;
the >300-node declutter hint is unchanged.

### 5. Testing

| File | Covers |
|---|---|
| `tagFilter.test.ts` (new) | `matchesTags` any/all, empty-set passes, single-tag parity with the old behaviour |
| `tags.test.ts` | `orderTagChips` ordering, `limit` truncation, selected-always-shown, `hiddenCount` |
| `useGraphPrefs.test.ts` | legacy `tag` read-migration, `toggleTag` add/remove, `tagMode` persistence round-trip |
| `graphColor.test.ts` | `nodeFill` tag mode under both modes; empty selection mutes all |
| `graphExport.test.ts` | updated `buildScene` opts |

### 6. Docs

- One-line note in the CLAUDE.md graph section describing the tag filter.
- Tick `docs/remaining-roadmap.md` line 92.

## Out of scope

- Per-tag hues in colour-by-tag mode (needs a legend and an overlap rule).
- Multi-tag filtering on `/tag/:tag` or the sidebar.
- A separate highlight tag decoupled from the filter selection.
