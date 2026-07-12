# Home Atmosphere Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Home the world's title page — session 4 of the visual-polish program — and build the "Saved" whisper deferred from the motion-system spec.

**Architecture:** Five mostly-independent changes. Home's bespoke card grid is replaced by the shared `BrowseCard` (which gains one optional slot), which also delivers the stagger for free. The "Saved" whisper is the only behavioural change: a new pure hook watches `page.updatedAt` and `PageRoute` renders a span whose decay is a pure CSS animation. The ornament, the hero, and the dead-CSS/unit cleanup are CSS-only, save for one `className` change.

**Tech Stack:** React 19, TypeScript (strict), Vite, Dexie + `useLiveQuery`, Vitest + happy-dom + `@testing-library/react`, plain CSS in one file (`src/index.css`).

**Spec:** `docs/superpowers/specs/2026-07-12-home-atmosphere-design.md` (approved). Read it before starting — it carries the reasoning behind every choice below.

**Issue:** #170. Branch: `feat/170-home-atmosphere` (already created; the spec is committed on it).

## Global Constraints

- **No new material and no new motion token.** Everything is built from the existing gold rule, parchment grain, layered elevation, stagger, and the `--dur-*` / `--ease-*` tokens. A change that needs a new material does not belong in this pass.
- **`px`, not `rem`,** in all CSS written or rewritten here. Conversion is `px = round(rem × 16)`. Trap: rem resolves against the **16px root**, *not* against `body { font-size: 15px }`.
- **No `useEffect` + `setState`.** The repo runs `eslint-plugin-react-hooks` flat-recommended: `set-state-in-effect` is an **error**, and the purity rule bans a literal `Date.now()` / `Math.random()` in a render path. Derive state during render instead (the existing idiom is `PageRoute.tsx:109-114`).
- **No `setTimeout` for the whisper.** Its decay is a CSS animation, restarted by re-keying the element.
- **Existing tests must stay green without edits.** `HomeRoute.test.tsx` asserts on text, not on `.lore-card`. If it goes red, the change drifted — that is not a licence to edit the assertion.
- **Gold hairline material** is written inline as the rest of the file writes it: `color-mix(in srgb, var(--accent) 22%, transparent)`. There is **no `--rule` token** in `:root` and this plan does not add one.
- **Never write the `background:` shorthand on a `.parchment` member.** `.parchment` (`index.css:123-133`) sets `background-image: var(--parchment-noise)` on a list that includes `.ov-card` and `.browse-card`. Any later `background:` shorthand on those selectors has the same specificity (one class), so it wins — and **resets `background-image` to `none`, silently killing the grain**. Always use the `background-color:` longhand. This trap has already bitten `.book-card` (#168) and `.world-card` (#169); their ledgers record it. **It is currently live on `.ov-card` (`:366`) and `.browse-card` (`:1112`), and this plan fixes both** (Tasks 3 and 5) — the grain is dead on them today.
- Verify with `npm run lint`, `npm run build`, `npm run test:run` — all three green before the PR.
- PR label: `version:minor`. Closes #170.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/useSaveWhisper.ts` | **New.** Pure hook: turns `(id, updatedAt, editing)` into "a save just landed" stamp. The whisper's whole brain, extracted so it is testable without mounting Tiptap. | Create |
| `src/useSaveWhisper.test.ts` | Unit tests for the hook — the pass's one behavioural surface. | Create |
| `src/components/BrowseCard.tsx` | Shared page card. Gains one optional `meta` slot. | Modify |
| `src/components/BrowseCard.test.tsx` | Add coverage for the `meta` slot. | Modify |
| `src/routes/PageRoute.tsx` | Renders the whisper in the header. | Modify |
| `src/routes/HomeRoute.tsx` | Adopts `BrowseCard`; sets `.has-banner`. | Modify |
| `src/routes/HomeRoute.test.tsx` | Add the Dusty-corners stale-label test. Existing tests untouched. | Modify (append only) |
| `src/index.css` | All the visual work: whisper animation, ornament, hero, `.ov-card`, deletions, units. | Modify |

**Why a hook instead of putting the logic in `PageRoute`:** there is no `PageRoute.test.tsx`, and `PageRoute` mounts `LoreEditor` (Tiptap). Testing the whisper by rendering the route would mean fighting ProseMirror in happy-dom for no benefit. The hook is pure React state, `renderHook`-testable in milliseconds — and `renderHook` is already this repo's idiom (`usePage.test.ts`, `useGraphPrefs.test.ts`, `useWikiLinkNavigation.test.ts`). Hooks with no Dexie import live at `src/` root (`usePage.ts`, `useEscapeKey.ts`).

---

## Task 1: The `useSaveWhisper` hook

The one behavioural change, built and tested in isolation before it touches the route.

**Files:**
- Create: `src/useSaveWhisper.ts`
- Test: `src/useSaveWhisper.test.ts`

**Interfaces:**
- Consumes: nothing (pure React).
- Produces: `useSaveWhisper(id: string, updatedAt: number | undefined, editing: boolean): number | null` — returns the `updatedAt` of the write that just landed, or `null`. Task 2 consumes it and uses the return value as a React `key`.

**Behaviour contract:**

| Situation | Returns |
|---|---|
| First observation of a page (it loaded) | `null` — loading is not saving |
| `updatedAt` advanced while `editing` | the new `updatedAt` |
| `updatedAt` advanced while **not** editing | `null` |
| Page switched (`id` changed) | `null` — the new page has not been saved |
| Re-render with no change | the previous value (stable) |

- [ ] **Step 1: Write the failing test**

Create `src/useSaveWhisper.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup } from '@testing-library/react'
import { useSaveWhisper } from './useSaveWhisper'

afterEach(cleanup)

describe('useSaveWhisper', () => {
  it('stays quiet when a page first loads', () => {
    // The first `updatedAt` we ever see is the page arriving, not a save.
    const { result } = renderHook(() => useSaveWhisper('p1', 1000, true))
    expect(result.current).toBeNull()
  })

  it('stays quiet while the page is still loading', () => {
    const { result } = renderHook(() => useSaveWhisper('p1', undefined, true))
    expect(result.current).toBeNull()
  })

  it('whispers when a write advances updatedAt while editing', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    expect(result.current).toBeNull()

    rerender({ at: 2000 })
    expect(result.current).toBe(2000)
  })

  it('reports each successive save, so the marker can re-key', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    expect(result.current).toBe(2000)

    rerender({ at: 3000 })
    expect(result.current).toBe(3000)
  })

  it('holds its value across a re-render with no new write', () => {
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, true),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    rerender({ at: 2000 })
    expect(result.current).toBe(2000)
  })

  it('says nothing in view mode, even when a write lands', () => {
    // A cross-tab write must not whisper at someone who is only reading.
    const { result, rerender } = renderHook(
      ({ at }) => useSaveWhisper('p1', at, false),
      { initialProps: { at: 1000 as number | undefined } },
    )
    rerender({ at: 2000 })
    expect(result.current).toBeNull()
  })

  it('does not whisper on arrival at a different page', () => {
    // Switching pages must not read as "your edit was saved".
    const { result, rerender } = renderHook(
      ({ id, at }) => useSaveWhisper(id, at, true),
      { initialProps: { id: 'p1', at: 1000 as number | undefined } },
    )
    rerender({ id: 'p1', at: 2000 })
    expect(result.current).toBe(2000)

    rerender({ id: 'p2', at: 5000 })
    expect(result.current).toBeNull()
  })

  it('whispers again after a write on the newly-opened page', () => {
    const { result, rerender } = renderHook(
      ({ id, at }) => useSaveWhisper(id, at, true),
      { initialProps: { id: 'p1', at: 1000 as number | undefined } },
    )
    rerender({ id: 'p2', at: 5000 })
    expect(result.current).toBeNull()

    rerender({ id: 'p2', at: 6000 })
    expect(result.current).toBe(6000)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/useSaveWhisper.test.ts`
Expected: FAIL — `Failed to resolve import "./useSaveWhisper"`.

- [ ] **Step 3: Write the hook**

Create `src/useSaveWhisper.ts`:

```ts
import { useState } from 'react'

/** Signals that a write to the open page just landed, so the header can whisper
 *  "Saved".
 *
 *  The signal is `updatedAt` advancing. Every write path in PageRoute — body
 *  text, summary, status, category, tags, title, infobox — goes through
 *  `pageRepo.update`, which stamps `updatedAt: now()`. Watching that one field
 *  therefore covers all of them, and the whisper honestly means "the page on
 *  disk changed" rather than only "your typing landed".
 *
 *  State is derived during render rather than in an effect: `set-state-in-effect`
 *  is a lint error in this repo, and this is React's documented "adjust state
 *  while rendering" pattern — the same one PageRoute already uses to reset edit
 *  mode when the route's page id changes.
 *
 *  @param id        the open page's id — a change means we navigated
 *  @param updatedAt the live-queried page's `updatedAt`; `undefined` while loading
 *  @param editing   whether the editor is open
 *  @returns the `updatedAt` of the write that just landed, else `null`. Callers
 *           use it as a React `key` so the marker remounts (and its CSS decay
 *           animation restarts) on every save.
 */
export function useSaveWhisper(
  id: string,
  updatedAt: number | undefined,
  editing: boolean,
): number | null {
  const [seenId, setSeenId] = useState(id)
  const [seenAt, setSeenAt] = useState<number | undefined>(undefined)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [seenEditing, setSeenEditing] = useState(editing)

  if (id !== seenId) {
    // A different page. Forget everything: its first `updatedAt` is an arrival,
    // not a save, and the outgoing page's whisper must not follow us here.
    setSeenId(id)
    setSeenAt(undefined)
    setSavedAt(null)
    setSeenEditing(editing)
  } else if (editing && !seenEditing) {
    // Entering edit mode. Whatever `updatedAt` is already current — even if it
    // changed in this very render — predates the start of editing. Re-sync to
    // it and drop any `savedAt` carried over from the reading period (or a
    // prior edit session), so only writes landing from here on are announced.
    setSeenAt(updatedAt)
    setSavedAt(null)
    setSeenEditing(editing)
  } else {
    if (editing !== seenEditing) setSeenEditing(editing)
    if (updatedAt !== undefined && updatedAt !== seenAt) {
      // `seenAt === undefined` means this is the first `updatedAt` we have seen
      // for this page — it loaded, nobody saved.
      if (seenAt !== undefined) setSavedAt(updatedAt)
      setSeenAt(updatedAt)
    }
  }

  return editing ? savedAt : null
}
```

> **Why the `seenEditing` branch exists — do not remove it.** Without it, a write
> that lands while you are only *reading* sets `savedAt` (correctly returning
> `null` at the time, since you are not editing) and nothing ever clears it — so
> clicking **Edit** afterwards whispers "Saved" for a write you never made. The
> same fault re-whispers an old save when you leave edit mode and come back. The
> first version of this plan shipped that bug; the review caught it. The
> same-render case is real too: "✓ Done" flushes the debounced content write *and*
> leaves edit mode, so a write can land in the very render `editing` goes false.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/useSaveWhisper.test.ts`
Expected: PASS — 8 passed.

- [ ] **Step 5: Lint (the hook rules are the point)**

Run: `npm run lint`
Expected: no errors. Specifically no `react-hooks/set-state-in-effect` and no purity complaint — if either fires, the hook drifted from the derive-during-render pattern.

- [ ] **Step 6: Commit**

```bash
git add src/useSaveWhisper.ts src/useSaveWhisper.test.ts
git commit -m "feat: useSaveWhisper — a save-landed signal from updatedAt (#170)"
```

---

## Task 2: Render the whisper in the page header

**Files:**
- Modify: `src/routes/PageRoute.tsx` (import block; the hook call near the other hooks; `.page-header-actions` at lines ~175-190)
- Modify: `src/index.css` (new `.save-whisper` rule + `whisper` keyframes + a reduced-motion rule)

**Interfaces:**
- Consumes: `useSaveWhisper(id, updatedAt, editing)` from Task 1.
- Produces: the `.save-whisper` class (Task 5's CSS work must not clash with it).

- [ ] **Step 1: Import the hook**

In `src/routes/PageRoute.tsx`, add to the imports (next to `import { usePage } from '../usePage'`):

```tsx
import { useSaveWhisper } from '../useSaveWhisper'
```

- [ ] **Step 2: Call the hook**

`PageRoute` early-returns when the page is loading (`if (page === undefined) return …`, line ~116), and **hooks may not be called after an early return** — so this must sit above that guard, with the other hooks. Put it directly after the `const [editing, setEditing] = useState(false)` line:

```tsx
  // "Saved" whisper: any write to this page advances `updatedAt`. `page` may be
  // undefined here (still loading) — the hook handles that and stays quiet.
  const savedAt = useSaveWhisper(id, page?.updatedAt, editing)
```

- [ ] **Step 3: Render the marker**

In the `.page-header-actions` div (line ~175), add the span **before** the Edit/Done button:

```tsx
          <div className="page-header-actions">
            {savedAt !== null && (
              <span key={savedAt} className="save-whisper" role="status">Saved</span>
            )}
            <button
              className="ghost-btn"
              onClick={() => {
```

`key={savedAt}` is what makes it work: each save remounts the span, restarting its CSS decay from frame 0. The key is a value read from the record — **not** a clock read during render, so the purity rule holds. The `editing` gate lives inside the hook, so no `editing &&` is needed here.

- [ ] **Step 4: Add the CSS**

In `src/index.css`, next to the other page-header rules, add:

```css
/* "Saved" whisper — the motion system's last deferred item. It decays in pure
   CSS: PageRoute re-keys the span on each save, remounting it and restarting
   this animation from frame 0. No timer, so nothing to clean up. It ends at
   opacity 0 and the node goes inert. */
.save-whisper {
  font-family: var(--serif);
  font-style: italic;
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--ink-faint);
  align-self: center;
  margin-right: 4px;
  animation: whisper 1600ms var(--ease-out) forwards;
}
@keyframes whisper {
  0%   { opacity: 0; }
  12%  { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}

/* The global reduced-motion clamp forces animation-duration to 0.01ms, which
   would flash the whisper invisibly and lose the information entirely. So say
   it statically instead: no motion, no loss of meaning. */
@media (prefers-reduced-motion: reduce) {
  .save-whisper { animation: none; opacity: 1; }
}
```

- [ ] **Step 5: Verify the suite and the build**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all green. No existing test renders `PageRoute`, so nothing should move.

- [ ] **Step 6: Verify by hand — this is the one behavioural change**

Run `npm run dev`, open a page, hit **✎ Edit**, and type. Confirm:
1. "Saved" fades in ~0.5s after you stop typing (the 500ms content debounce), holds, fades out.
2. It fires for a **status** change and a **tag** add too, not just body text — that is the whole point of watching `updatedAt`.
3. It does **not** appear on page load, and not in view mode.
4. In devtools → Rendering → emulate `prefers-reduced-motion: reduce`, it appears and **stays** rather than vanishing.

- [ ] **Step 7: Commit**

```bash
git add src/routes/PageRoute.tsx src/index.css
git commit -m "feat: whisper 'Saved' in the page header when a write lands (#170)"
```

---

## Task 3: `BrowseCard` gains a `meta` slot

Prepares the shared card for Home's Dusty corners, without changing what `/browse` and `/tag` render.

**Files:**
- Modify: `src/components/BrowseCard.tsx`
- Modify: `src/components/BrowseCard.test.tsx` (append)
- Modify: `src/index.css` (one new rule)

**Interfaces:**
- Produces: `<BrowseCard page={page} index={i} meta={node} />` — `meta?: ReactNode`, rendered beside the status badge. Task 4 consumes it.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('BrowseCard', …)` block in `src/components/BrowseCard.test.tsx`:

```tsx
  it('renders a meta note beside the status when given one', () => {
    render(
      <MemoryRouter>
        <BrowseCard page={makePage()} meta="3 months ago" />
      </MemoryRouter>,
    )
    expect(screen.getByText('3 months ago')).toBeTruthy()
  })

  it('omits the meta element entirely when not given one', () => {
    // Without this, every /browse and /tag card would carry an empty node.
    const { container } = render(<MemoryRouter><BrowseCard page={makePage()} /></MemoryRouter>)
    expect(container.querySelector('.browse-card-meta')).toBeNull()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/BrowseCard.test.tsx`
Expected: FAIL — the first with `Unable to find an element with the text: 3 months ago`. (TypeScript will also reject the unknown `meta` prop.)

- [ ] **Step 3: Add the prop**

Rewrite `src/components/BrowseCard.tsx`'s signature and status row. The full file:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { categoryColor, statusColor, pageStatus, type LorePage } from '../db'

export default function BrowseCard({
  page,
  index = 0,
  meta,
}: {
  page: LorePage
  index?: number
  /** Optional note beside the status badge — e.g. Home's "3 months ago". */
  meta?: ReactNode
}) {
  const color = categoryColor(page.category)
  return (
    <Link
      to={`/page/${page.id}`}
      className="browse-card"
      style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}
    >
      <div className="browse-card-img">
        {page.infobox?.image ? (
          <img src={page.infobox.image} alt={page.title} />
        ) : (
          <div className="browse-card-placeholder" style={{ background: color + '33' }}>
            <span style={{ color }}>{page.title.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="browse-card-body">
        <div className="browse-card-name">{page.title}</div>
        {page.summary && <div className="browse-card-summary">{page.summary}</div>}
        <div className="browse-card-footer">
          <span
            className="browse-card-status"
            style={{ borderColor: statusColor(pageStatus(page)), color: statusColor(pageStatus(page)) }}
          >
            {pageStatus(page)}
          </span>
          {meta && <span className="browse-card-meta">{meta}</span>}
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 4: Add the CSS**

In `src/index.css`, `.browse-card-status` currently carries `margin-top: 6px` and `align-self: flex-start` — that alignment now belongs to the footer row. Replace the `.browse-card-status` rule with:

```css
.browse-card-footer {
  margin-top: 6px;
  display: flex; align-items: center; gap: 8px;
  align-self: flex-start;
}
.browse-card-status {
  font-size: 11px; border: 1px solid; border-radius: 20px;
  padding: 1px 7px; font-family: var(--sans);
}
.browse-card-meta {
  font-size: 11px; color: var(--ink-faint); font-family: var(--sans);
}
```

- [ ] **Step 4b: Un-wipe the card's parchment grain**

`.browse-card` is on the `.parchment` list (`index.css:127`), but its own rule (`:1112`) then re-declares the **`background:` shorthand**, which resets `background-image` to `none` — so the grain has never actually rendered on a browse card. Same specificity, later in the file, shorthand wins. Change that one declaration to the longhand:

```css
.browse-card {
  background-color: var(--panel); border: 1px solid var(--border); border-radius: var(--radius);
  overflow: hidden; text-decoration: none; color: inherit;
  display: flex; flex-direction: column;
  transition: transform var(--dur-1), box-shadow var(--dur-1);
}
```

**Only `background:` → `background-color:` changes.** Leave every other declaration exactly as it is.

This is a real (pre-existing) visual change to `/browse` and `/tag`, not just to Home — the cards gain the grain they were always supposed to have. It is deliberate and signed off; call it out in the PR body.

Verify it took, rather than trusting the source:

```bash
grep -n "^\.browse-card {" -A2 src/index.css
```
Expected: the rule now reads `background-color: var(--panel);`. There must be **no** `background:` shorthand on `.browse-card` anywhere.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/BrowseCard.test.tsx`
Expected: PASS — 4 passed (the 2 original + 2 new).

- [ ] **Step 6: Confirm `/browse` did not move**

Run: `npm run test:run`
Expected: all green. Then `npm run dev`, visit a category — the cards must look exactly as before (the footer wraps a lone badge, so nothing shifts).

- [ ] **Step 7: Commit**

```bash
git add src/components/BrowseCard.tsx src/components/BrowseCard.test.tsx src/index.css
git commit -m "feat: BrowseCard takes an optional meta slot (#170)"
```

---

## Task 4: Home adopts `BrowseCard`

**Files:**
- Modify: `src/routes/HomeRoute.tsx` (the Recently-edited and Dusty-corners sections, ~lines 310-357; imports)
- Modify: `src/routes/HomeRoute.test.tsx` (append one test)
- Modify: `src/index.css` (delete the bespoke card rules)

**Interfaces:**
- Consumes: `BrowseCard` with the `meta` prop from Task 3; `staleLabel(updatedAt: number, nowMs?: number): string` from `src/rediscovery.ts`.

- [ ] **Step 1: Write the failing test**

Append to `src/routes/HomeRoute.test.tsx`, inside the `describe('HomeRoute — Dusty corners', …)` block:

```tsx
  it('shows how long a dusty page has been neglected', async () => {
    // The one piece of information the shared card does not carry on its own —
    // it rides in via BrowseCard's `meta` slot, so it is worth pinning down.
    const id = await createPage({ title: 'Forgotten Ruin' })
    await db.pages.update(id, { updatedAt: Date.now() - 200 * DAY })
    renderHome()
    const heading = await screen.findByText('Dusty corners')
    const section = heading.closest('section')!
    expect(within(section).getByText('6 months ago')).toBeTruthy()
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: the new test FAILS (`Unable to find an element with the text: 6 months ago`); the 7 existing tests PASS.

> `"6 months ago"` is exact, not a guess: `staleLabel` (`src/rediscovery.ts:41`) computes `Math.floor(200 / 30)` → `6`. Do not change `staleLabel`.

- [ ] **Step 3: Swap the cards**

In `src/routes/HomeRoute.tsx`:

Add the import beside the other component imports:

```tsx
import BrowseCard from '../components/BrowseCard'
```

Replace the **Recently edited** grid (the `<div className="card-grid">` … `</div>` block inside the `cfg.showRecent` section) with:

```tsx
            <div className="browse-grid">
              {recent.map((p, i) => (
                <BrowseCard key={p.id} page={p} index={i} />
              ))}
            </div>
```

Replace the **Dusty corners** grid the same way, passing the stale label through the new slot:

```tsx
          <div className="browse-grid">
            {dusty.map((p, i) => (
              <BrowseCard key={p.id} page={p} index={i} meta={staleLabel(p.updatedAt)} />
            ))}
          </div>
```

`staleLabel` is already imported at the top of the file. `categoryColor`, `statusColor`, and `pageStatus` may now be unused in `HomeRoute` — **check before deleting them from the import**: `categoryColor` is still used by the type chips in the Overview section. Let `npm run lint` tell you.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: PASS — 8 passed. The 7 pre-existing tests must pass **unedited**; they assert on text, which the shared card still renders.

- [ ] **Step 5: Delete the bespoke card CSS**

In `src/index.css`, now that nothing renders these:

1. Delete the `.lore-card` rule, `.lore-card:hover`, `.lore-card h3`, `.lore-card p` (~lines 382-388).
2. Delete `.card-grid` (~line 381).
3. Delete `.card-badges` (~line 393).
4. In the shared badge rule `.card-badge, .category-badge { … }` (~line 389), **drop `.card-badge` and keep `.category-badge`** — `PageRoute` still renders `.category-badge`. The selector becomes `.category-badge { … }`.
5. Remove `.lore-card` from the `.parchment` selector list (~line 125) and from the `.elevated` selector list (~line 148). **Leave `.ov-card` in both.**

- [ ] **Step 6: Verify nothing else referenced them**

Run: `grep -rn "lore-card\|card-grid\|card-badges\|card-badge" src/`
Expected: **no matches** except `.category-badge` in `src/index.css` and `src/routes/PageRoute.tsx`. If `lore-card` still appears anywhere, stop — something else was using it and the deletion is wrong.

- [ ] **Step 7: Verify the suite and by eye**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all green.

Then `npm run dev` → `/home`. Recently edited and Dusty corners now show thumbnail cards identical to `/browse`, entering on the stagger. Dusty cards carry their "N months ago" note beside the status.

- [ ] **Step 8: Commit**

```bash
git add src/routes/HomeRoute.tsx src/routes/HomeRoute.test.tsx src/index.css
git commit -m "refactor: home adopts the shared BrowseCard, gaining the stagger (#170)"
```

---

## Task 5: The ornament, the hero, and the cleanup

The remaining work is CSS, plus one `className` in `HomeRoute.tsx`.

**Files:**
- Modify: `src/routes/HomeRoute.tsx` (the hero div, ~lines 140-147)
- Modify: `src/index.css` (the Home block, ~lines 316-400)

- [ ] **Step 1: Give the hero an honest class**

In `src/routes/HomeRoute.tsx`, the hero currently keys its banner styling off an inline style, which `index.css` then matches with the fragile attribute-substring selector `[style*="background-image"]`. Replace the hero's opening tag:

```tsx
      <div
        className={activeLore?.banner ? 'home-hero has-banner' : 'home-hero'}
        style={activeLore?.banner ? {
          backgroundImage: `url(${activeLore.banner})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : undefined}
      >
```

- [ ] **Step 2: Rewrite the Home CSS block**

In `src/index.css`, replace the whole run from `.home {` through `.ghost-btn.active` (~lines 318-345 — i.e. everything under the `/* --- Home --- */` comment, up to but **not** including the `/* Home personalisation (edit mode) */` comment) with the following. This carries five changes at once: the hero type, the banner scrim (keyed on the new class), the ornament, the dead-CSS deletion, and the rem→px conversion of this run.

```css
.home { max-width: 880px; margin: 0 auto; padding: 48px 40px 80px; }
.home-hero { position: relative; }

/* The world's title page — engraved in the same hand as the selector's gateway,
   but tuned down from its clamp(44px, 6vw, 64px) / 0.14em: that hero is the
   fixed short string "LORE CODEX", while this one is a user's world name and
   may well be "The Chronicles of the Shattered Kingdoms". */
.home-hero h1 {
  font-family: var(--display);
  font-size: clamp(32px, 4vw, 46px);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 6px;
  color: var(--ink);
}
.home-hero p { color: var(--ink-dim); font-size: 17px; margin: 0 0 20px; font-family: var(--serif); }

/* Banner mode. A gradient scrim, not a text-shadow: it stays legible over a
   bright banner, which a shadow does not. */
.home-hero.has-banner {
  color: #fff;
  min-height: 220px;
  padding: 48px 32px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  border-radius: var(--radius);
  overflow: hidden;
}
.home-hero.has-banner::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.72), rgba(0,0,0,0.25) 45%, transparent);
}
.home-hero.has-banner > * { position: relative; z-index: 1; }

.home-banner-controls { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.home-cta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.home-cta .primary-btn { width: auto; }
.home-section { margin-top: 40px; }
.home-section h2 {
  font-family: var(--display); font-size: 20px; color: var(--ink);
  border-bottom: 1px solid transparent; padding-bottom: 8px;
  border-image: linear-gradient(to right, var(--accent) 0%, var(--border) 28%, var(--border) 100%) 1;
}

/* The program's one decorative flourish: a gold hairline with a centre diamond,
   closing each section. The header's gradient underline LABELS a section; this
   CLOSES one — different jobs, so they don't compete.

   Two details carry it. (1) The gradient's hard stops punch a 32px hole in the
   middle of the rule, and the glyph sits in that hole — that is what gives a
   real line-with-centred-diamond from a single pseudo-element instead of a line
   running through the glyph. (2) The adjacent-sibling selector does the
   placement: Home has six conditionally-rendered sections, and `+` guarantees
   the ornament only ever appears BETWEEN two that actually rendered — never
   above the first, never below the last, whatever the user has toggled off. No
   markup, no "is this the first section?" logic.

   `content: '✦' / ''` supplies empty alt text so screen readers skip it. */
.home-section + .home-section::before {
  /* Rule-scoped alias for the gold hairline this file writes inline elsewhere
     (the book spine, the gateway's tooled rule). Local — names no new material. */
  --rule: color-mix(in srgb, var(--accent) 22%, transparent);

  content: '✦' / '';
  display: block;
  text-align: center;
  font-size: 11px;
  line-height: 1;
  color: color-mix(in srgb, var(--accent) 55%, transparent);
  margin: 44px 0 40px;
  background: linear-gradient(to right,
      transparent,
      var(--rule) 15%,
      var(--rule) calc(50% - 16px),
      transparent calc(50% - 16px),
      transparent calc(50% + 16px),
      var(--rule) calc(50% + 16px),
      var(--rule) 85%,
      transparent)
    center / 100% 1px no-repeat;
}

.home-section-sub { color: var(--ink-faint); margin: -4px 0 12px; font-size: 14px; }
.muted { color: var(--ink-faint); }
.ghost-btn.active { border-color: var(--accent); color: var(--accent); }
```

**Note what this deleted:** `.home-stats`, `.stat`, and `.stat-num` are gone. They are dead — they appear nowhere in `src/` outside `index.css` (Step 4 re-verifies).

- [ ] **Step 3: Match the customize input to the new hero, and rule the stat cards**

Still in `src/index.css`, replace the `.home-title-input` rule with one that matches the `h1` it stands in for — otherwise clicking "✎ Customize" visibly jumps the hero's size and case:

```css
.home-title-input {
  font-family: var(--display);
  font-size: clamp(32px, 4vw, 46px);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  background: transparent; border: none;
  border-bottom: 1px dashed var(--border); color: var(--ink); width: 100%;
  padding: 0 0 4px; margin-bottom: 8px;
}
```

Then add the engraved rule to the stat cards, replacing the `.ov-label` rule (~line 368):

```css
.ov-label {
  color: var(--ink-faint); font-size: 12.5px;
  text-transform: uppercase; letter-spacing: 0.5px;
  border-top: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  margin-top: 8px;
  padding-top: 8px;
}
```

**And un-wipe the stat card's grain.** `.ov-card` is on the `.parchment` list (`index.css:126`), but its own rule (`:366`) re-declares the **`background:` shorthand**, resetting `background-image` to `none` — so the grain has never rendered on a stat card. Change that one declaration to the longhand (everything else in the rule stays byte-for-byte):

```css
.ov-card { background-color: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px 18px; display: flex; flex-direction: column; gap: 2px; }
```

That is what actually delivers the spec's "stat cards on the shared elevation language" — the elevation was already there, the *material* was not. `.ov-card` needs nothing else, and gets **no hover state**: a stat card is not interactive.

Verify:

```bash
grep -n "^\.ov-card" src/index.css
```
Expected: `background-color: var(--panel)`. No `background:` shorthand on `.ov-card` anywhere.

- [ ] **Step 4: Finish the rem→px conversion and re-verify the dead code**

The `.on-this-day` rule (~line 395) still holds two rem values. Convert them (`px = round(rem × 16)`):

- `gap: 0.9rem;` → `gap: 14px;`
- `padding: 1rem 1.15rem;` → `padding: 16px 18px;`

Then confirm the block is clean:

```bash
sed -n '316,400p' src/index.css | grep -n "rem\|home-stats\|stat-num"
```
Expected: **no output**. (`grep` will not match `rem` inside `transparent` — it is `rem` with a digit before it you are hunting; if a hit appears, read it before converting.)

And confirm the deleted classes are truly gone repo-wide:

```bash
grep -rn "home-stats\|stat-num" src/
```
Expected: no matches.

- [ ] **Step 5: Verify**

Run: `npm run test:run && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 6: Verify by hand — the ornament's placement logic is the risk**

Run `npm run dev` → `/home`, click **✎ Customize**, and toggle sections off and on. Confirm:
1. The ornament appears **between** sections only — never above the first visible one, never below the last. Toggle *About* off (it is usually first) and check the ornament did not strand at the top.
2. A **long world name** ("The Chronicles of the Shattered Kingdoms") wraps sanely in the hero, both plain and with a banner.
3. With a banner set, the title stays legible over a **bright** image (the scrim's job), and the hero's corners are rounded with the scrim clipped inside them.
4. Entering and leaving Customize does **not** jump the hero's size or case.
5. The stat cards show a gold hairline between figure and label.

- [ ] **Step 7: Commit**

```bash
git add src/routes/HomeRoute.tsx src/index.css
git commit -m "feat: home becomes the world's title page — hero, ornament, engraved stats (#170)"
```

---

## Task 6: Ship it

- [ ] **Step 1: Full verification, one more time, from clean**

```bash
npm run lint && npm run build && npm run test:run
```
Expected: three green runs. Do not open the PR on a red or unrun suite.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin feat/170-home-atmosphere
gh pr create --label version:minor --title "feat: home atmosphere pass — the world's title page (#170)" --body "$(cat <<'EOF'
Session 4 of the visual-polish program. Home becomes the leaf you turn to after
the selector's gateway.

- **Card unification.** Home's two grids adopt the shared `BrowseCard` (which
  gains one optional `meta` slot for Dusty corners' stale label), deleting the
  bespoke `.lore-card` / `.card-grid` that only Home used — and picking up the
  stagger for free, since `.browse-card` is already in the stagger selector list.
- **The "Saved" whisper** — the last item deferred from the motion-system spec.
  It watches `page.updatedAt`, so it covers *every* write path (body, summary,
  status, tags, infobox), not just typing. No timer and no `useEffect`: detection
  is the derive-during-render idiom `PageRoute` already uses, and the decay is a
  keyed CSS animation. Reduced motion gets an explicit rule, so the whisper
  persists statically rather than flashing invisibly.
- **The ornament** — a gold hairline with a centre diamond, closing each section.
  Pure CSS: a hard-stop gap punched in the gradient, placed by
  `.home-section + .home-section::before`, so Home's six conditional sections are
  handled with no markup and no placement logic.
- **Hero** — the world name is engraved in the selector's hand (tuned down, since
  it is user text, not a fixed string); banner mode gets a real scrim instead of
  a raw text-shadow; stat cards get a hairline between figure and label.
- **Cleanup** — `.home-stats` / `.stat` / `.stat-num` deleted (verified dead), and
  the Home block converted rem → px, shrinking #216's sweep.

Design: `docs/superpowers/specs/2026-07-12-home-atmosphere-design.md`
Plan: `docs/superpowers/plans/2026-07-12-home-atmosphere.md`

Closes #170.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm CI is green** before asking for a merge.

---

## Notes for the implementer

- **Read the spec first.** `docs/superpowers/specs/2026-07-12-home-atmosphere-design.md` explains *why* each of these is shaped the way it is — particularly why the whisper watches `updatedAt` rather than the content debounce, and why the ornament is a pseudo-element rather than a component.
- **The one accepted regression:** Home's cards lose their *labelled* category badge ("Character"), because `BrowseCard` conveys category as the thumbnail placeholder's tint. This is deliberate and signed off — it is already how `/browse` and `/tag` present a page. Do not add the badge back to `BrowseCard`; that would restyle `/browse` under the banner of a Home pass.
- **If a pre-existing test goes red, do not edit the test.** Every existing assertion in `HomeRoute.test.tsx` is on text that survives the card swap. A red one means the change drifted.
