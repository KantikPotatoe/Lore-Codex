# Typed relationship edges in the 3D graph — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `GraphView3D` draw each edge in its relationship type's colour, with #137's arrow rules and hover labels, by reading styling fields `linkStyle` already computes.

**Architecture:** `src/graphColor.ts` stays the single styling authority and emits a **second calibrated tier** — `color3d`/`width3d` — alongside the existing 2D `color`/`width`. `GraphView3D` reads those fields instead of deriving `mutual ? blue : grey` locally. No new data, no new toolbar surface, no change to the filter memo.

**Tech Stack:** TypeScript (strict), React, react-force-graph-3d (three.js), Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-07-25-typed-edges-3d-design.md`

## Global Constraints

- Branch is `feat/243-typed-edges-3d`, already created from `origin/main`. Do not branch again.
- TypeScript `strict`. `npm run build` runs `tsc -b` — type errors fail the build.
- Import from the `src/db` barrel, never from `src/db/<file>` directly.
- No host `alert()`/`confirm()`.
- The 3D wiki-link values in this plan are **today's** `GraphView3D` constants. The existing 3D look must not change; only typed edges, arrows and hover labels are new.
- `activeColor` gets no 3D twin — 3D has no hover, focus or path machinery, so there is no lit state to colour.
- Final verification is `npm run lint && npm run build && npm run test:run`, all green, before the PR. PR label: `version:minor`.

---

### Task 1: The 3D styling tier in `graphColor.ts`

**Files:**
- Modify: `src/graphColor.ts` (the `LinkStyle` interface ~line 84, the constants block ~line 108, both `return` branches of `linkStyle` ~line 153)
- Test: `src/graphColor.test.ts` (add to the existing `describe('linkStyle')` block, which ends at the file's last `})`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: two new fields on `LinkStyle` (and therefore on `DrawnLink = GraphLink & LinkStyle`), set on **every** path that returns a style:
  - `color3d: string` — rest colour on the WebGL canvas
  - `width3d: number` — line width in three.js world units
  Task 2 reads exactly these two names.

The existing test helpers `relation()`, `graphLink()` and `NONE_HIDDEN` are already defined in `src/graphColor.test.ts` (above the `withAlpha` block) — reuse them, do not redefine them. `relation()` defaults to `color: '#e0a458'`, `typeId: 'parent-of'`, `directed: true`, `reversed: false`. `graphLink()` defaults to `{ source: 'a', target: 'b', mutual: false, wiki: true, relations: [] }`.

- [ ] **Step 1: Write the failing tests**

Append these five tests inside the existing `describe('linkStyle', () => { … })` block in `src/graphColor.test.ts`, after the last test in that block (`'escapes & before < and >, so the escaping cannot double-encode itself'`):

```ts
  it('gives a typed edge the type colour at full opacity and the mutual width in 3D', () => {
    const s = linkStyle(graphLink({ relations: [relation()] }), NONE_HIDDEN)!
    expect(s.color3d).toBe('#e0a458')
    expect(s.width3d).toBe(1.4)
  })

  it('keeps the brighter, thinner 3D calibration for a mutual wiki link', () => {
    const s = linkStyle(graphLink({ mutual: true }), NONE_HIDDEN)!
    expect(s.color3d).toBe('rgba(150,180,255,0.8)')
    expect(s.width3d).toBe(1.4)
  })

  it('keeps the brighter, thinner 3D calibration for a one-way wiki link', () => {
    const s = linkStyle(graphLink(), NONE_HIDDEN)!
    expect(s.color3d).toBe('rgba(160,160,160,0.4)')
    expect(s.width3d).toBe(0.5)
  })

  it('falls back to the 3D wiki tier, not the 2D one, when every type is hidden', () => {
    // The wiki fall-through is a second return statement; it is the branch most
    // likely to be left setting only the 2D pair.
    const s = linkStyle(graphLink({ mutual: true, relations: [relation()] }), new Set(['parent-of']))!
    // Literals, not a comparison against another linkStyle call: two undefined
    // fields compare equal, so a cross-check would pass before the fields exist.
    expect(s.color3d).toBe('rgba(150,180,255,0.8)')
    expect(s.width3d).toBe(1.4)
  })

  it('does not change the 3D styling when a promoted relation swaps orientation', () => {
    const s = linkStyle(graphLink({ relations: [relation({ reversed: true })] }), NONE_HIDDEN)!
    expect(s.source).toBe('b')
    expect(s.target).toBe('a')
    expect(s.color3d).toBe('#e0a458')
    expect(s.width3d).toBe(1.4)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/graphColor.test.ts`

Expected: 5 failures, each `AssertionError: expected undefined to be …`, because `color3d`/`width3d` do not exist yet. TypeScript will also flag them, but Vitest transpiles without type-checking, so the run itself proceeds to the assertion failure. **If a test errors instead of failing, fix the error and re-run until you see the assertion failure** — a test that never asserted proves nothing.

- [ ] **Step 3: Add the fields to the `LinkStyle` interface**

In `src/graphColor.ts`, add to `interface LinkStyle`, after the `width: number` line and before `arrow`:

```ts
  /** Rest colour on the 3D canvas. 3D is calibrated separately — see the
   *  constants block below. */
  color3d: string
  /** 3D line width, in three.js world units rather than pixels. */
  width3d: number
```

- [ ] **Step 4: Add the 3D constants**

Replace the `MUTUAL`/`ONEWAY` constants and the comment above them (currently "Rest and lit styling for wiki links, unchanged from what GraphView drew before — now stated once.") with:

```ts
// Rest and lit styling for wiki links, unchanged from what GraphView drew
// before — now stated once. The `3d` pair is a second calibration of the same
// edge, not drift: 3D links are thin lines over a dark WebGL scene at varying
// depth, so they need more alpha to read, and three.js line widths are world
// units rather than pixels, so 2D's 2.5 would render as a slab. Both tiers sit
// on adjacent lines so that changing one and forgetting the other is visible in
// the diff. There is no `active3d`: 3D has no hover, focus or path machinery,
// so it has no lit state.
const MUTUAL = {
  color: 'rgba(150,180,255,0.5)', active: 'rgba(190,210,255,0.95)', width: 2.5,
  color3d: 'rgba(150,180,255,0.8)', width3d: 1.4,
}
const ONEWAY = {
  color: 'rgba(160,160,160,0.28)', active: 'rgba(170,185,225,0.7)', width: 1,
  color3d: 'rgba(160,160,160,0.4)', width3d: 0.5,
}
```

Then, directly below the existing `RELATION_REST_ALPHA` line, add:

```ts
// In 3D the typed edge goes to full opacity: the ~1.5x the wiki pair gains
// going into 3D would put 0.75 past 1. Width matches the 3D mutual width, for
// the same reason RELATION_WIDTH matches the 2D one.
const RELATION_WIDTH_3D = MUTUAL.width3d
```

- [ ] **Step 5: Set both fields on both return branches**

In `linkStyle`, the wiki fall-through branch (the one guarded by `if (visible.length === 0)`) currently returns `width: s.width,` followed by `arrow: 'toggle',`. Insert between them:

```ts
      color3d: s.color3d,
      width3d: s.width3d,
```

In the relation branch at the end of the function, `width: RELATION_WIDTH,` is followed by `arrow: primary.directed ? 'always' : 'never',`. Insert between them:

```ts
      color3d: primary.color,
      width3d: RELATION_WIDTH_3D,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/graphColor.test.ts`

Expected: PASS, 33 tests (28 existing + 5 new). No warnings in the output.

- [ ] **Step 7: Run the full suite and the type-check**

Run: `npm run test:run && npm run build`

Expected: all test files pass, and `tsc -b` reports no errors. `graphExport.ts` reads only `l.color` and `l.width`, so it is unaffected; if `tsc` complains anywhere else, an object literal is missing the two new required fields — add them rather than making the fields optional.

- [ ] **Step 8: Commit**

```bash
git add src/graphColor.ts src/graphColor.test.ts
git commit -m "feat: emit a 3D styling tier from linkStyle (#243)"
```

---

### Task 2: `GraphView3D` reads the tier

**Files:**
- Modify: `src/components/GraphView3D.tsx` (imports, the `GLink` alias, the header comment, the props type, `linkColor`/`linkWidth`, and four props on `<ForceGraph3D>`)
- Modify: `.claude/rules/graph.md` (one sentence in the typed-edge styling paragraph)
- Test: none — see Step 6.

**Interfaces:**
- Consumes: `color3d: string` and `width3d: number` from Task 1, plus the pre-existing `arrow: ArrowMode` (`'always' | 'never' | 'toggle'`) and `labels: string` on `DrawnLink`, and the types `DrawnLink` / `DrawnGraphData` exported from `src/graphColor.ts`.
- Produces: nothing consumed by a later task.

No change is needed in `GraphRoute.tsx`: it already passes `data={filtered}`, which is `DrawnGraphData`.

- [ ] **Step 1: Retype the component against `DrawnLink`**

In `src/components/GraphView3D.tsx`, replace the two import lines:

```ts
import { type GraphData, type GraphNode, type GraphLink } from '../db'
import { nodeFill, nodeTooltip, type ColorBy } from '../graphColor'
```

with:

```ts
import { type GraphNode } from '../db'
import {
  nodeFill,
  nodeTooltip,
  type ColorBy,
  type DrawnLink,
  type DrawnGraphData,
} from '../graphColor'
```

Change the link alias:

```ts
type GLink = LinkObject<GraphNode, DrawnLink>
```

Change the prop type `data: GraphData` to `data: DrawnGraphData`, and the component's generic `<ForceGraph3D<GraphNode, GraphLink>` to `<ForceGraph3D<GraphNode, DrawnLink>`.

- [ ] **Step 2: Update the header comment**

The comment above the type aliases claims the old styling. Replace this line:

```
// interaction. Nodes are coloured by category (ghosts muted), sized by degree;
// mutual links draw thicker and bluer. A single click opens a real page or
```

with:

```
// interaction. Nodes are coloured by category (ghosts muted), sized by degree;
// links carry their relationship type's colour, or the wiki mutual/one-way
// styling when untyped. A single click opens a real page or
```

- [ ] **Step 3: Read the precomputed styling instead of deriving it**

Replace the `linkColor` and `linkWidth` callbacks:

```ts
  const linkColor = useCallback(
    (link: GLink) => (link.mutual ? 'rgba(150,180,255,0.8)' : 'rgba(160,160,160,0.4)'),
    [],
  )
  const linkWidth = useCallback((link: GLink) => (link.mutual ? 1.4 : 0.5), [])
```

with:

```ts
  // Colour and width are precomputed by linkStyle in GraphRoute's filter memo,
  // on the 3D tier. Unlike the 2D view there is no lit state to layer on top:
  // 3D has no hover/focus dimming, so `activeColor` goes unused here.
  const linkColor = useCallback((link: GLink) => link.color3d, [])
  const linkWidth = useCallback((link: GLink) => link.width3d, [])
```

- [ ] **Step 4: Adopt the #137 arrow rule and add hover labels**

Replace this prop:

```tsx
        linkDirectionalArrowLength={showArrows ? 3 : 0}
```

with:

```tsx
        // Asymmetric relationship types are always arrowed and symmetric ones
        // never are — direction is meaning, not the user's to toggle. Only
        // wiki-only edges follow the toggle. Length 3, not 2D's 4: the 3D
        // arrowhead sits on a thinner line.
        linkDirectionalArrowLength={(link: GLink) =>
          link.arrow === 'always' || (link.arrow === 'toggle' && showArrows) ? 3 : 0}
```

And add, immediately after the `linkWidth={linkWidth}` prop:

```tsx
        // Same escaped string the 2D view shows, and the same float-tooltip
        // innerHTML sink (#244). Wiki-only edges carry '' and render nothing.
        linkLabel={(link: GLink) => link.labels}
```

Leave `linkDirectionalArrowColor={linkColor}` as it is — it now follows the 3D tier automatically.

- [ ] **Step 5: Verify it compiles and nothing regressed**

Run: `npm run build && npm run test:run && npm run lint`

Expected: `tsc -b` clean, all tests pass, ESLint clean. A `GraphData is declared but never used` error means Step 1's import edit was partial.

- [ ] **Step 6: Verify in the running app**

`GraphView3D` is WebGL and cannot be mounted under happy-dom, so this step is the coverage for Steps 1–4. Do not skip it and do not describe it as tested afterwards.

Run: `npm run dev`, open `http://localhost:5174/#/graph` in Firefox, and turn on **🧊 3D**. In a world that has at least one asymmetric relationship type (e.g. `parent-of`), one symmetric type (e.g. `ally-of`), and a plain wiki-only link, confirm:

1. A typed edge draws in its type's colour, matching its toolbar chip.
2. Hovering that edge shows its label ("Parent of"), and hovering a wiki-only edge shows no tooltip.
3. With **➜ Arrows off**, the asymmetric edge still has an arrowhead and the symmetric one does not.
4. With **➜ Arrows on**, the wiki-only edge gains an arrowhead and the symmetric typed edge still has none.
5. Hiding the type with its chip removes the edge from the 3D scene.
6. Wiki-only edges look the same as before this change (compare against `git stash` or the 2D view's relative brightness — the mutual blue should still be clearly brighter than the grey one-way).

If any check fails, fix it and re-run Step 5 before continuing.

- [ ] **Step 7: Update the rules doc**

In `.claude/rules/graph.md`, find this sentence in the typed-edge styling paragraph:

> `GraphView3D` receives the same filtered links (correct edges, correct `degree`) but still renders them with the old mutual/one-way styling — 3D typed-edge styling is a follow-up.

Replace it with:

```
`GraphView3D` reads the same `DrawnLink`s on a **second calibrated tier**: `color`/`width` serve the 2D canvas and the PNG/SVG export, `color3d`/`width3d` serve 3D — its links need more alpha to read over a dark WebGL scene, and three.js line widths are world units, not pixels (#243). One `linkStyle` call emits both, which is what keeps the filter memo view-independent and lets a single `filtered` feed 2D, 3D, the export and the hub/isolated lists. `activeColor` has no 3D twin, because 3D has no hover, focus or path machinery and therefore no lit state. 3D inherits the orientation `linkStyle` chose, and with it #245's wrong-way arrow when a hidden type is what oriented the edge.
```

- [ ] **Step 8: Commit**

```bash
git add src/components/GraphView3D.tsx .claude/rules/graph.md
git commit -m "feat: typed relationship edges in the 3D graph (#243)"
```

---

### Task 3: Ship it

**Files:** none modified.

**Interfaces:**
- Consumes: the committed work of Tasks 1 and 2.
- Produces: a PR.

- [ ] **Step 1: Full verification**

Run: `npm run lint && npm run build && npm run test:run`

Expected: all three green. Record the test count for the PR body. If anything fails, fix it and re-run all three — do not open the PR on a partial pass.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/243-typed-edges-3d
```

- [ ] **Step 3: Open the PR**

```bash
gh pr create --base main --label "version:minor" --label "enhancement" \
  --title "feat: typed relationship edges in the 3D graph (#243)"
```

The body must state:

- Closes #243.
- What changed: `linkStyle` emits a second calibrated tier (`color3d`/`width3d`); `GraphView3D` reads it instead of deriving `mutual ? blue : grey`, and adopts #137's arrow rule plus hover labels.
- Why two tiers rather than reading `color` verbatim: 3D's alphas and three.js world-unit widths are calibrated differently, so reusing the 2D values would dim and mis-scale every existing 3D link.
- Two things the issue listed as open that turned out to be already solved: the relationship chips already drive 3D through the shared `filtered` memo, and orientation already arrives correct from `linkStyle`.
- Known limitation: 3D inherits #245 along with the orientation.
- Verification: lint / build / test results, **and explicitly that `GraphView3D` is WebGL and unmountable under happy-dom, so the prop wiring was verified by `tsc` plus the manual checks in Task 2 Step 6** — list which ones were performed. Do not claim the component is unit-tested.
- The standard `🤖 Generated with [Claude Code]` footer and session link.

- [ ] **Step 4: Note the inherited limitation on #245**

```bash
gh issue comment 245 --body "Now applies to the 3D view too: #243 gave GraphView3D typed-edge styling, and it inherits the orientation from the same \`linkStyle\` output, so a hidden orienting type produces the same wrong-way arrow in both views. Does not change the cost or the shape of the fix described above."
```
