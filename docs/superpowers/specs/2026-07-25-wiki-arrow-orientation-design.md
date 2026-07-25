# Preserve the wiki orientation on a shared edge (#245)

**Status:** design · **Date:** 2026-07-25 · **Issue:** [#245](https://github.com/KantikPotatoe/Lore-Codex/issues/245)

Amends [`2026-07-23-typed-graph-edges-design.md`](2026-07-23-typed-graph-edges-design.md)
§3 step 5 and §4.

---

## 1. The bug

When a pair carries **both** a wiki link and a typed relationship stored in the
opposite direction, hiding the relationship type leaves the arrow pointing the
wrong way.

1. Page A wiki-links to page B, so the wiki pass builds `source: A, target: B`.
2. A `parent-of` row is stored **B → A**.
3. `buildGraphData`'s relationship pass reorients the shared edge to `B → A`,
   per §3 step 5 — orientation comes from the lowest-`order` row, unconditionally.
   The wiki orientation is **overwritten and lost** (`graph.ts:227-228`).
4. The user hides `parent-of` with its toolbar chip.
5. `linkStyle` finds no visible relation, falls through to wiki styling with
   `arrow: 'toggle'` — but passes `link.source`/`link.target` through unchanged,
   which are now the relationship's orientation.
6. With "Arrows on", the arrow points at A, while the only wiki link runs A → B.

Since #243 the same wrong-way arrow appears in `GraphView3D`, which inherits the
orientation from the same `linkStyle` output.

## 2. Root cause

Orientation is decided in two places at two times, and the earlier one destroys
information the later one needs.

`buildGraphData` fixes orientation at **build** time from the relationship rows;
`linkStyle` re-decides it at **filter** time from the *visible* rows. Because
step 5 overwrites the wiki edge's ends in place, the wiki orientation does not
survive to the moment `linkStyle` needs to fall back to it. The fallback path is
correct in shape — it just has nothing correct left to read.

## 3. The fix

**A pair's stored orientation is the wiki edge's, when there is one; otherwise
the lowest-order relationship row's.**

In the relationship pass:

- When `byKey.get(key)` returns an existing (wiki) edge, take `source`/`target`
  from it instead of from `primary.fromId`/`primary.toId`, and stop assigning
  them back onto it.
- When there is no existing edge, orientation still comes from the primary row,
  exactly as today.

`reversed` (`graph.ts:220`, `row.fromId !== source`) needs **no edit**: it is
already computed against whichever `source` was chosen. Its meaning widens from
"runs against the primary relationship" to "runs against this edge's stored
orientation" — the wiki's for a shared edge, the primary's otherwise.

### Why nothing downstream breaks

`linkStyle` already swaps `source`/`target` when `primary.reversed`, so a
**visible** relationship still orients the edge and still draws its arrow at the
target end. The swap now measures from the wiki orientation rather than from an
orientation that was already the relationship's, which is what makes the two
cases agree.

The fallback path (no visible relations, `wiki: true`) passes
`link.source`/`link.target` straight through; it simply stops being handed a
corrupted pair.

Both renderers and the export read the same `DrawnLink`, so 2D, 3D and the
PNG/SVG export are fixed by the one change.

Every other consumer — `edgeKey`, `degree`, BFS, the depth filter,
`connectedComponents`, `shortestPath` — treats edges as undirected and never
reads orientation. Node sizes, filter survival and path results are unchanged.

### Case table

| Pair | Stored orientation | Type visible | Drawn | Arrow |
|---|---|---|---|---|
| wiki A→B only | A→B | — | A→B | `toggle` |
| wiki A→B + `parent-of` B→A | **A→B** (was B→A) | yes | B→A (swapped) | `always` |
| wiki A→B + `parent-of` B→A | **A→B** (was B→A) | no | **A→B** (was B→A) | `toggle` |
| `parent-of` B→A only | B→A | yes | B→A | `always` |
| `parent-of` B→A only | B→A | no | — | dropped (`null`) |

Only the third row changes behaviour. That is the bug.

### Mutual wiki pairs

For a mutual wiki pair the stored orientation is whichever page the page loop
reached first (`graph.ts:149`) — deterministic but semantically arbitrary. That
is pre-existing behaviour for mutual edges and is **not** addressed here; a
mutual edge with arrows on has always drawn one arrow at an arbitrary end.

## 4. Spec amendments

**§3 step 5** — replace "Unconditional" with the wiki-orientation precedence:
orientation comes from the lowest-order row *unless the pair already has a wiki
edge*, whose orientation wins. Rationale to record: the wiki link can outlive the
relationship's visibility, so its orientation must survive the merge. The
original justification for the unconditional rule still holds for everything it
was protecting (`edgeKey`, `degree`, BFS, the depth filter remain
orientation-free) — the exception costs one branch and buys a correct fallback.

**§4** — note that `LinkStyle.source`/`target` before any swap is the *wiki*
orientation for a shared edge, and that the swap is therefore what makes a
visible relationship orient the edge.

**`.claude/rules/graph.md`** — states the old rule in two places ("oriented from
that row, absorbing the wiki edge into it") and records that 3D "inherits #245's
wrong-way arrow". Both need updating.

## 5. Testing

All the affected code is pure, so this needs no DOM.

- **`graph.test.ts`** — a pair with wiki A→B plus a `parent-of` row stored B→A
  keeps `source: A, target: B` on the built `GraphLink`, with `reversed: true`
  on the relation. A relationship-only pair still takes its orientation from the
  primary row.
- **`graphColor.test.ts`** — for that same link: visible `parent-of` draws B→A
  with `arrow: 'always'`; hidden `parent-of` draws **A→B** with
  `arrow: 'toggle'` (the regression test for this issue).
- **Multi-type promotion** — an edge whose lowest-order type is hidden still
  promotes the next visible type and orients from it, unchanged by this fix.

## 6. Out of scope

`degree` and the depth filter are computed on the unfiltered graph, so hiding a
relationship type can leave a node on screen whose only edge was just dropped —
an isolated dot with no visible reason. This is consistent with how
category/status/tag filters have always behaved (`degree` has never been
recomputed per filter) and changing it would move node sizes and the `minDegree`
survival cut across *every* filter. Deliberately left alone.
