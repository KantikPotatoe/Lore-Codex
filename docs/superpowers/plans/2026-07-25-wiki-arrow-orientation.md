# Wiki Arrow Orientation (#245) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `buildGraphData` from destroying a wiki edge's orientation when a relationship shares the pair, so hiding the relationship type falls back to an arrow that points the way the wiki link actually runs.

**Architecture:** One rule change in the relationship merge (`src/db/graph.ts`): a pair's stored orientation is the existing wiki edge's when there is one, otherwise the lowest-order relationship row's. `reversed` is already computed against whichever `source` was chosen, so it needs no edit, and `linkStyle` already swaps on `primary.reversed` — meaning the styling layer keeps working unchanged and simply gains a correct orientation to fall back to.

**Tech Stack:** TypeScript (strict), Vitest + happy-dom. All touched code is pure — no DOM, no DB, no fixtures.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-25-wiki-arrow-orientation-design.md`. It amends `docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md` §3 step 5 and §4.
- `degree`, the depth filter and `minDegree` are **out of scope** — do not recompute them against visible edges.
- Mutual wiki pairs keep their arbitrary-but-deterministic orientation (`graph.ts:149`). Not addressed.
- Import from the barrel `'../db'` in tests, per `CLAUDE.md`.
- Run `npm run lint`, `npm run test` and `npm run build` before claiming done.
- PR needs a version label; this is a bug fix, so `version:patch`.

---

### Task 1: Preserve the wiki orientation through the relationship merge

**Files:**
- Modify: `src/db/graph.ts:196-232`
- Test: `src/db/graph.test.ts` (append to the existing `describe('buildGraphData relationship edges')` block, which ends around line 510)

**Interfaces:**
- Consumes: `buildGraphData(pages, relationships, types)`, `page()`, `link()`, `rel()`, `relType()`, `PARENT`, `ALLY` — all already defined at the top of `src/db/graph.test.ts`.
- Produces: no signature changes. `GraphLink.source`/`target` for a pair that has a wiki edge now hold the wiki orientation; `RelationEdge.reversed` is measured against it.

- [ ] **Step 1: Write the failing tests**

Append inside `describe('buildGraphData relationship edges', ...)` in `src/db/graph.test.ts`:

```ts
  it('keeps the wiki orientation when a relationship is stored the other way (#245)', () => {
    // A wiki-links to B, so the edge runs a→b. The parent-of row is stored
    // b→a. The wiki orientation must survive the merge, because hiding
    // parent-of has to fall back to an arrow that matches the wiki link.
    const data = buildGraphData(
      [page('a', 'A', { content: link('B') }), B],
      [rel('r1', 'b', 'a', 'parent-of')],
      [PARENT],
    )
    expect(data.links).toHaveLength(1)
    expect(data.links[0].source).toBe('a')
    expect(data.links[0].target).toBe('b')
    expect(data.links[0].relations[0].reversed).toBe(true)
  })

  it('still orients a relationship-only pair from the lowest-order row', () => {
    // No wiki edge, so there is no orientation to defer to and the primary
    // row decides — unchanged behaviour.
    const data = buildGraphData([A, B], [rel('r1', 'b', 'a', 'parent-of')], [PARENT])
    expect(data.links[0].source).toBe('b')
    expect(data.links[0].target).toBe('a')
    expect(data.links[0].relations[0].reversed).toBe(false)
  })

  it('measures reversed against the wiki orientation for every row on the pair', () => {
    // parent-of runs b→a, ally-of runs a→b, and the wiki link runs a→b. Both
    // rows are flagged relative to the wiki orientation, not to each other.
    const data = buildGraphData(
      [page('a', 'A', { content: link('B') }), B],
      [rel('r1', 'b', 'a', 'parent-of'), rel('r2', 'a', 'b', 'ally-of')],
      [PARENT, ALLY],
    )
    const byType = new Map(data.links[0].relations.map((r) => [r.typeId, r.reversed]))
    expect(byType.get('parent-of')).toBe(true)
    expect(byType.get('ally-of')).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/graph.test.ts`

Expected: the first and third tests FAIL (the first reports `source` `'b'` where `'a'` is expected, and `reversed` `false` where `true` is expected). The second test PASSES already — it pins behaviour that must not change.

- [ ] **Step 3: Implement the orientation precedence**

In `src/db/graph.ts`, replace the comment and orientation block currently at lines 196-203:

```ts
    // Orient from the lowest-order row, unconditionally — including over a wiki
    // edge that ran the other way, and including for a symmetric type. Safe
    // because every other consumer (edgeKey, degree, BFS, the depth filter)
    // treats edges as undirected, and a typed edge's arrow is governed by its
    // type rather than by the wiki `showArrows` toggle.
    const primary = rows[0]
    const source = primary.fromId
    const target = primary.toId
```

with:

```ts
    // A wiki edge's orientation wins; only a relationship-only pair is oriented
    // from its lowest-order row. The wiki link outlives the relationship's
    // visibility — hiding the type falls back to wiki styling — so an
    // orientation overwritten here would leave that fallback pointing the wrong
    // way (#245). Everything else (edgeKey, degree, BFS, the depth filter)
    // treats edges as undirected, so this only ever decides which end the arrow
    // is drawn at, and `linkStyle` swaps back whenever a relation is visible.
    const existing = byKey.get(key)
    const primary = rows[0]
    const source = existing ? existing.source : primary.fromId
    const target = existing ? existing.target : primary.toId
```

Then replace the attach block currently at lines 225-232:

```ts
    const existing = byKey.get(key)
    if (existing) {
      existing.source = source
      existing.target = target
      existing.relations = relations
    } else {
```

with (note `existing` is now declared above, and its ends are left alone):

```ts
    if (existing) {
      existing.relations = relations
    } else {
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/db/graph.test.ts`

Expected: PASS, including the pre-existing `orients the edge from the lowest-order row and flags the others reversed` test — it uses a pair with no wiki link, so it is unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/db/graph.ts src/db/graph.test.ts
git commit -m "fix: keep the wiki orientation on an edge shared with a relationship (#245)"
```

---

### Task 2: Pin the end-to-end arrow behaviour through linkStyle

**Files:**
- Test: `src/db/graph.test.ts` (new `describe` block at the end of the file)

**Interfaces:**
- Consumes: `buildGraphData` from `'../db'` and `linkStyle` from `'../graphColor'`. `linkStyle(link, hiddenRelTypes)` returns `{ source, target, arrow, ... } | null`.
- Produces: nothing. Characterisation of the bug the user actually sees.

**Why this task is separate:** Task 1's tests pin the *stored* orientation. They would still pass if `linkStyle` later stopped swapping, which would reintroduce the visible bug from the other side. This block pins what is drawn, which is what #245 is about, and it is the only test that fails for the exact reason the issue reports.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/db/graph.test.ts`:

```ts
describe('shared-edge arrow orientation (#245)', () => {
  // The end-to-end shape the issue reports: build the graph, then style it the
  // way GraphRoute's filter memo does. A wiki link runs a→b; a parent-of row is
  // stored b→a. Whether parent-of is visible decides which reading wins, and
  // hiding it must not leave the relationship's orientation behind.
  const pages = [page('a', 'A', { content: link('B') }), page('b', 'B')]
  const rels = [rel('r1', 'b', 'a', 'parent-of')]

  it('draws the relationship orientation while its type is visible', () => {
    const built = buildGraphData(pages, rels, [PARENT])
    const s = linkStyle(built.links[0], new Set<string>())!
    expect(s.source).toBe('b')
    expect(s.target).toBe('a')
    expect(s.arrow).toBe('always')
  })

  it('falls back to the wiki orientation when the type is hidden', () => {
    const built = buildGraphData(pages, rels, [PARENT])
    const s = linkStyle(built.links[0], new Set(['parent-of']))!
    expect(s.source).toBe('a')
    expect(s.target).toBe('b')
    expect(s.arrow).toBe('toggle')
  })
})
```

Add the `linkStyle` import at the top of `src/db/graph.test.ts`, after the existing imports:

```ts
import { linkStyle } from '../graphColor'
```

- [ ] **Step 2: Run the test to verify the fallback case fails on the unfixed merge**

Run: `npx vitest run src/db/graph.test.ts -t "#245"`

Expected with Task 1 applied: both PASS. To confirm the second test is a genuine regression test rather than a tautology, temporarily restore `existing.source = source` / `existing.target = target` in `src/db/graph.ts`, re-run, and check that `falls back to the wiki orientation when the type is hidden` FAILS with `'b'` where `'a'` is expected. Then undo the temporary change.

- [ ] **Step 3: Run the whole suite**

Run: `npm run test`

Expected: all files pass. No existing test asserts the old overwrite behaviour.

Multi-type promotion needs no new test: `graphColor.test.ts`'s `promotes the next visible relation, swapping the edge so the arrow reads forward` already pins that hiding the orienting type promotes the next one and swaps the ends, and this change does not touch that path. Confirm it still passes rather than duplicating it.

- [ ] **Step 4: Commit**

```bash
git add src/db/graph.test.ts
git commit -m "test: pin the drawn arrow orientation for a shared wiki/relationship edge (#245)"
```

---

### Task 3: Amend the spec and the rules file

**Files:**
- Modify: `docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md` (§3 step 5, and the `linkStyle` bullet list in §4)
- Modify: `.claude/rules/graph.md` (two statements of the old rule)

**Interfaces:** documentation only.

**Why it matters:** `.claude/rules/graph.md` is loaded into context whenever anyone touches graph files. Left unamended it would state the opposite of what the code does, and it currently records #245 as a known live defect.

- [ ] **Step 1: Amend §3 step 5 of the typed-graph-edges spec**

In `docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md`, replace step 5 of §3:

```markdown
5. **Orient the edge from the lowest-order row**: `source = primary.fromId`,
   `target = primary.toId`. Unconditional — including when a wiki edge already
   existed with the opposite orientation, and including when the primary type is
   symmetric. One rule, no branch. Safe because everything else in the graph
   (`edgeKey`, `degree`, BFS, the depth filter) treats edges as undirected, and
   because a typed edge's arrow is governed by §5 rather than by the wiki
   `showArrows` toggle.
```

with:

```markdown
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
```

- [ ] **Step 2: Amend the §4 swap bullet**

In the same file, in §4's "Some visible" bullet list, replace:

```markdown
  - If `primary.reversed`, **swap `source`/`target`** so the arrow can always be
    drawn forward. This is why orientation is part of the style rather than
    fixed at build time: hiding the primary type can promote a relation whose
    stored row runs the other way, and `linkDirectionalArrowRelPos={1}` only
    draws at the target end.
```

with:

```markdown
  - If `primary.reversed`, **swap `source`/`target`** so the arrow can always be
    drawn forward. This is why orientation is part of the style rather than
    fixed at build time: the incoming orientation is the wiki edge's (§3 step 5),
    and hiding a type can promote a relation whose stored row runs the other way,
    while `linkDirectionalArrowRelPos={1}` only draws at the target end. The
    swap is therefore what makes a visible relationship orient the edge, and its
    absence on the fallback path is what makes a hidden one read as the wiki
    link again.
```

- [ ] **Step 3: Amend `.claude/rules/graph.md`**

Two edits.

First, in the opening paragraph, replace:

```markdown
One edge per unordered pair: a pair carrying any relationship is styled by its lowest-`order` type and oriented from that row, absorbing the wiki edge into it.
```

with:

```markdown
One edge per unordered pair: a pair carrying any relationship is styled by its lowest-`order` type, absorbing the wiki edge into it. Orientation is the exception to "the primary decides" — a pair that also has a wiki link keeps the *wiki* orientation, because hiding every relationship type falls the edge back to wiki styling and that fallback has to point the way the wiki link runs (#245); a relationship-only pair is oriented from its primary row.
```

Second, in the typed-edge styling paragraph, replace:

```markdown
3D inherits the orientation `linkStyle` chose, and with it #245's wrong-way arrow when a hidden type is what oriented the edge.
```

with:

```markdown
3D inherits the orientation `linkStyle` chose, which since #245 means the wiki orientation on a shared edge, swapped only while a relation is actually visible.
```

- [ ] **Step 4: Verify the rules file no longer contradicts the code**

Run: `grep -n "245\|oriented from that row" .claude/rules/graph.md`

Expected: the only `#245` mention is the amended one describing current behaviour; no surviving "oriented from that row" phrasing.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-07-23-typed-graph-edges-design.md .claude/rules/graph.md
git commit -m "docs: amend the typed-edge orientation rule for #245"
```

---

### Task 4: Verify and open the PR

**Files:** none modified.

- [ ] **Step 1: Run the full CI triad**

```bash
npm run lint && npm run test && npm run build
```

Expected: lint clean, all tests pass, build succeeds.

- [ ] **Step 2: Manually confirm the fix in the app**

The bug needs four conditions to line up, so it will not appear by accident. In a world with two pages A and B:

1. Make A wiki-link to B.
2. Add a `parent-of` relationship stored **B → A**.
3. Open `/#/graph` and turn **Arrows on**. The arrow should point at A (the relationship's reading).
4. Hide `parent-of` with its toolbar chip. The arrow should now point at **B**, matching the wiki link. Before the fix it kept pointing at A.
5. Toggle **3D on** and confirm the same, since `GraphView3D` reads the same `DrawnLink`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin fix/245-wiki-arrow-orientation
gh pr create --base main --label "version:patch" \
  --title "fix: keep the wiki orientation on an edge shared with a relationship (#245)"
```

The PR body should state: the root cause (orientation decided twice, the earlier decision destroying what the later one needs), the one-branch fix, the case table showing only the hidden-type row changes, and that `degree`/depth-filter recomputation was deliberately left out of scope.
