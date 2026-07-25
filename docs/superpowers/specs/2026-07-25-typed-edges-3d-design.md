# Typed relationship edges in the 3D graph — design

**Issue:** #243 · **Date:** 2026-07-25 · **Status:** approved, not yet implemented

#137 gave the 2D canvas and the PNG/SVG export typed relationship edges, and
scoped `GraphView3D` out (that spec, §8). This finishes the job: the 3D view
draws each edge in its relationship type's colour and obeys the same arrow
rules.

The starting state is a *coherent partial*, not a break. `GraphRoute` already
hands both views the same `DrawnGraphData` (`GraphRoute.tsx:526` / `:536`), so
3D already receives the right edges with the right `degree` — node sizes and
the hub/isolated lists are correct there today. It simply ignores the styling
fields riding on each link and recomputes `mutual ? blue : grey` locally.

**Two things the issue lists as open are already solved**, confirmed by
reading the route:

- **The relationship-type filter chips already work in 3D.** They are not
  gated on `threeD` (`GraphRoute.tsx:347`) and they act through the shared
  `filtered` memo, so hiding a type already drops the edge in both views. The
  chips need no 3D story; what they lack is an on-canvas colour to correspond
  to, which is exactly what this spec adds.
- **Orientation is already correct.** `linkStyle` swaps `source`/`target`
  before `DrawnLink` is built, so 3D inherits the right arrow direction with
  no code.

**Scope:** link colour, width, arrows and hover labels in `GraphView3D`, plus
the second styling tier in `graphColor.ts` that feeds them. No new toolbar
surface.

---

## 1. Why 3D needs its own tier

3D deliberately draws links brighter and thinner than 2D today:

| | 2D | 3D (today) |
|---|---|---|
| mutual wiki | `rgba(150,180,255,0.5)`, width 2.5 | `rgba(150,180,255,0.8)`, width 1.4 |
| one-way wiki | `rgba(160,160,160,0.28)`, width 1 | `rgba(160,160,160,0.4)`, width 0.5 |

Both differences are calibration, not drift. The alphas compensate for thin
lines over a dark WebGL scene at varying depth; the widths differ because
three.js line widths are **world units, not pixels**, so 2D's 2.5 would render
as a slab.

That rules out the obvious move of reading `link.color` verbatim in 3D: it
would dim every existing 3D wiki link (0.8 → 0.5) and mis-scale every width,
regressing the current 3D look to buy purity. It equally rules out styling only
typed edges from `linkStyle` and leaving the wiki constants hardcoded in
`GraphView3D` — that reintroduces exactly the split-authority drift #137
removed.

So `graphColor.ts` stays the single authority and emits **both** calibrations.

## 2. `LinkStyle` gains two fields

```ts
color3d: string   // rest colour on the WebGL canvas
width3d: number   // line width in three.js world units
```

Computed unconditionally, on every path through `linkStyle` — including the
wiki fall-through taken when every relationship on the edge is hidden.

**Why extra fields and not a `linkStyle(link, hidden, depth)` argument.**
`linkStyle` is called **once**, in `GraphRoute`'s filter memo, and that memo
also feeds `hubs`/`isolated` and the PNG/SVG export. A `depth` argument would
make `filtered` view-dependent and recompute the entire filtered graph on every
3D toggle. Emitting both tiers keeps one call and one memo, and puts the two
numbers on adjacent lines in the constants block, where drift is visible in a
diff.

The full table after this change — the wiki rows are **today's 3D values**, so
nothing about the existing 3D look changes:

| | `color` / `width` (2D, export) | `color3d` / `width3d` |
|---|---|---|
| mutual wiki | `rgba(150,180,255,0.5)` / 2.5 | `rgba(150,180,255,0.8)` / 1.4 |
| one-way wiki | `rgba(160,160,160,0.28)` / 1 | `rgba(160,160,160,0.4)` / 0.5 |
| typed | `withAlpha(type.color, 0.75)` / 2.5 | `type.color` / 1.4 |

Typed edges draw at **full opacity** in 3D. The wiki pair brightens by roughly
×1.5 going into 3D (0.5→0.8, 0.28→0.4); the same factor would put 0.75 above 1,
so it caps at full opacity. They draw at the mutual width, for the same reason
they do in 2D:
the 3D expression of "a typed edge is the strongest statement on the canvas."

**`activeColor` gets no 3D twin.** It is the lit state for 2D's hover/focus
neighbourhood dimming, and 3D has no hover, focus or path machinery at all. A
`activeColor3d` would be a field with no consumer.

## 3. `GraphView3D` reads instead of deriving

- Props type `GraphData` → `DrawnGraphData`; `GLink` becomes
  `LinkObject<GraphNode, DrawnLink>`, mirroring `GraphView`'s existing
  `ForceGraph2D<GraphNode, DrawnLink>`. This is what makes the new fields
  visible to `tsc` — without it the component cannot read them.
- `linkColor` → `link.color3d`; `linkWidth` → `link.width3d`. The local
  `mutual ? … : …` expressions go away, and with them the last link colour
  constants held outside `graphColor.ts`.
- `linkDirectionalArrowColor` uses the same accessor.
- `linkDirectionalArrowLength={(link) => link.arrow === 'always' || (link.arrow
  === 'toggle' && showArrows) ? 3 : 0}` — the #137 arrow rule (asymmetric types
  always arrowed, symmetric never, wiki-only edges keep the user toggle),
  keeping 3D's existing arrow length of 3 rather than 2D's 4.
- `linkLabel={(link) => link.labels}`, identical to 2D.

**On the hover labels.** A coloured edge with no way to learn its name is worse
in 3D than in 2D: the export legend and the path controls are both 2D-only, so
the chips row across the screen is the only place a colour is named. `labels`
is already computed on every drawn link and already HTML-escaped by `linkStyle`
(#137), reaching the same float-tooltip `.html()` sink that #244 just audited
for `nodeLabel` — so this is one prop on a mechanism we have just verified.
Wiki-only edges carry `labels: ''` and float-tooltip renders nothing for an
empty string, so untyped edges stay silent exactly as in 2D.

## 4. What does not change

`GraphView`, `graphExport` (reads `color`/`width`, the 2D tier), the chips,
`degree`, node sizes, the `filtered` memo, `useGraphPrefs`, and every persisted
row. Adding fields to `LinkStyle` is additive: `graphExport` reads two named
fields, and no test asserts a whole `LinkStyle` object with `toEqual`.

## 5. Inherited limitation

3D inherits **#245** along with the orientation: when a hidden relationship type
is what oriented an edge, the arrow can point against the only wiki link. It is
the same cosmetic artefact, from the same spec-mandated unconditional
reorientation, and the fix belongs on #245 — where it is already costed —
rather than being solved twice. Worth a note on that issue that it now applies
to both views.

## 6. Testing

`src/graphColor.test.ts`, as pure additions to the existing `linkStyle` block:

- a typed edge yields `color3d` = the type's colour at full opacity, and
  `width3d` = the mutual 3D width
- a mutual wiki edge yields today's 3D mutual colour and width
- a one-way wiki edge yields today's 3D one-way colour and width
- an edge whose every type is hidden falls back to the **3D** wiki tier, not
  the 2D one (the fall-through path must set both tiers)
- a swapped orientation changes `source`/`target` but not `color3d`/`width3d`

`GraphView3D` is WebGL and not mountable under happy-dom, so the prop wiring is
covered by `tsc -b` plus manual verification in the running app. This will be
stated as manual-verify in the PR, not claimed as tested — the same posture the
repo takes for `imageImport`'s executor, which happy-dom's missing canvas puts
out of reach.

Manual checks: a typed edge shows its type colour in 3D and its label on hover;
an asymmetric type is arrowed with "Arrows off"; a symmetric type is not
arrowed with "Arrows on"; hiding a type removes the edge; wiki-only edges look
unchanged from today.

## 7. Docs

`.claude/rules/graph.md` currently reads: "`GraphView3D` receives the same
filtered links (correct edges, correct `degree`) but still renders them with
the old mutual/one-way styling — 3D typed-edge styling is a follow-up." That
becomes the two-tier rule: one authority; `color`/`width` for the 2D canvas and
the export, `color3d`/`width3d` for 3D because its alphas and world-unit widths
are calibrated differently; `activeColor` 2D-only because 3D has no lit state.

`CLAUDE.md`'s graph section delegates to that rule file and needs no change.

## 8. Verification

`npm run lint && npm run build && npm run test:run` all green before the PR. Label the
PR `version:minor` — this is a new feature.
