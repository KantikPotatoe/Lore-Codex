# Quiet-Library Motion System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one consistent motion vocabulary (tokens, entrances, stagger, feedback) to Lore Codex and apply it app-wide, per `docs/superpowers/specs/2026-07-04-motion-system-design.md`.

**Architecture:** Nearly all work lands in `src/index.css` (single theme file, tokens in `:root`). Three components get a one-line inline `--stagger-i` CSS variable for grid stagger; `Sidebar.tsx` swaps its ternary chevron glyph for a rotatable span. No new modules, no db/barrel changes.

**Tech Stack:** Plain CSS custom properties + keyframes; React 18 + TypeScript strict; Vitest + happy-dom + fake-indexeddb for the two touched route tests.

## Global Constraints

- Personality: **quiet library** — fast (120–240ms), decelerating, no bounce/overshoot, opacity + small translate only.
- The global `prefers-reduced-motion` clamp at `src/index.css:76-83` must keep neutering everything — do not add animation rules outside its reach (it covers `*`, so any rule in this file is fine).
- Entrance animations must end at the element's natural resting state; **no static `opacity: 0` rules** — use `animation-fill-mode: backwards` to cover stagger delays.
- Existing behavior unchanged: same properties transition, only timing is unified.
- CI gate before claiming done: `npm run lint && npm run build && npm run test:run`.
- PR label: `version:minor`.
- Line numbers below were verified on `feat/motion-system` @ `5d1a622`; if an anchor doesn't match, search for the quoted selector instead.

---

### Task 1: Motion tokens + shared keyframes

**Files:**
- Modify: `src/index.css` (`:root` block, lines 6–25; foundations section ~line 83)

**Interfaces:**
- Produces: CSS custom properties `--dur-1` (120ms), `--dur-2` (180ms), `--dur-3` (240ms), `--ease-out`, `--ease-settle`; keyframes `fade-in`, `rise-in`. Every later task consumes these names verbatim.

- [ ] **Step 1: Add tokens to `:root`**

In `src/index.css`, after the `--radius: 10px;` line inside `:root`, add:

```css
  /* Motion — quiet library: fast, decelerating, never bouncy.
     dur-1 hover/press feedback · dur-2 entrances (modals, popovers) ·
     dur-3 larger settles (route change, grid stagger). */
  --dur-1: 120ms;
  --dur-2: 180ms;
  --dur-3: 240ms;
  --ease-out: ease-out;
  --ease-settle: cubic-bezier(0.22, 1, 0.36, 1);
```

- [ ] **Step 2: Add shared keyframes**

Immediately after the `@media (prefers-reduced-motion: reduce)` block (after line 83), add:

```css
/* Shared entrance keyframes. No `to` frame — elements settle at their natural
   resting state, so a skipped/cancelled animation can never hide content. */
@keyframes fade-in { from { opacity: 0; } }
@keyframes rise-in { from { opacity: 0; transform: translateY(6px); } }
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: exits 0 (CSS-only change; tsc + vite both pass).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat: motion tokens + shared entrance keyframes (quiet-library motion system)"
```

---

### Task 2: Normalize existing ad-hoc transitions onto tokens

**Files:**
- Modify: `src/index.css` — 14 `transition:` declarations

**Interfaces:**
- Consumes: `--dur-1`, `--ease-out` from Task 1.
- Produces: nothing new — pure timing unification.

- [ ] **Step 1: Retime every hover/feedback transition to `--dur-1`**

All of these are feedback-tier (hover) transitions → `var(--dur-1)`. Make exactly these replacements (selector · old → new):

| Selector (line) | Old | New |
|---|---|---|
| `.nav-item` (139) | `transition: background 0.12s, color 0.12s, transform 0.12s;` | `transition: background var(--dur-1), color var(--dur-1), transform var(--dur-1);` |
| `.page-link` (187) | `transition: background 0.12s, color 0.12s, transform 0.12s, box-shadow 0.12s;` | `transition: background var(--dur-1), color var(--dur-1), transform var(--dur-1), box-shadow var(--dur-1);` |
| `.tag-link` (197) | `transition: background 0.12s, color 0.12s, transform 0.12s;` | `transition: background var(--dur-1), color var(--dur-1), transform var(--dur-1);` |
| `.lore-card` (328) | `transition: transform 0.08s, border-color 0.08s;` | `transition: transform var(--dur-1), border-color var(--dur-1);` |
| `a.tag` (404) | `transition: border-color 0.12s, color 0.12s;` | `transition: border-color var(--dur-1), color var(--dur-1);` |
| `.browse-card` (1021) | `transition: transform 0.15s, box-shadow 0.15s;` | `transition: transform var(--dur-1), box-shadow var(--dur-1);` |
| `.toc-entry` (1075) | `transition: color 0.1s, border-color 0.1s;` | `transition: color var(--dur-1), border-color var(--dur-1);` |
| `.world-card` (1477) | `transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;` | `transition: border-color var(--dur-1), box-shadow var(--dur-1), transform var(--dur-1);` |
| `.world-card-enter` (1535) | `transition: opacity 0.15s;` | `transition: opacity var(--dur-1);` |
| `.world-card-actions` (1619) | `transition: opacity 0.15s;` | `transition: opacity var(--dur-1);` |
| `.world-card-add` (1651) | `transition: border-color 0.15s, color 0.15s;` | `transition: border-color var(--dur-1), color var(--dur-1);` |
| `.tl-event-card` (1814) | `transition: background 0.15s;` | `transition: background var(--dur-1);` |
| `.horiz-event` (1892) | `transition: filter 0.1s;` (keep the rest of that line) | `transition: filter var(--dur-1);` |
| `.book-card` (2069) | `transition: border-color 0.15s ease, box-shadow 0.15s ease;` | `transition: border-color var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);` |

Where the old declaration named no easing, keep naming none (browser default `ease` stays — minimal diff).

- [ ] **Step 2: Verify no stray literal durations remain on transitions**

Run: `grep -n "transition:.*0\.[0-9]" src/index.css`
Expected: no output. (If a new line appeared since this plan was written, normalize it the same way.)

- [ ] **Step 3: Run the suite**

Run: `npm run test:run`
Expected: all tests pass (timing values are not asserted anywhere).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "refactor: normalize all transition timings onto motion tokens"
```

---

### Task 3: Entrances — modals, search modal, wiki popover

**Files:**
- Modify: `src/index.css` — `.modal-overlay`/`.modal-dialog` (218–236), `.search-overlay`/`.search-modal` (1342–1353), `.wiki-hover-popover` (1383–1389)

**Interfaces:**
- Consumes: `--dur-1`, `--dur-2`, `--ease-settle`, `fade-in` from Task 1.
- Produces: keyframes `modal-in`, `popover-in` (used only here).

- [ ] **Step 1: Modal entrance (covers ConfirmDialog, CalendarEditor, EventEditor via shared classes)**

Add to the existing `.modal-overlay` rule: `animation: fade-in var(--dur-2) var(--ease-out);`
Add to the existing `.modal-dialog` rule: `animation: modal-in var(--dur-2) var(--ease-settle);`

After the `.modal-dialog` rule, add:

```css
@keyframes modal-in {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
}
```

- [ ] **Step 2: Search modal**

Add to `.search-overlay`: `animation: fade-in var(--dur-2) var(--ease-out);`
Add to `.search-modal`: `animation: modal-in var(--dur-2) var(--ease-settle);`

- [ ] **Step 3: Wiki-link hover popover (fast tier — hover UI must feel instant)**

Add to `.wiki-hover-popover`: `animation: popover-in var(--dur-1) var(--ease-settle);`

After that rule, add:

```css
@keyframes popover-in {
  from { opacity: 0; transform: translateY(2px); }
}
```

- [ ] **Step 4: Manual smoke check**

Run: `npm run dev` → open http://localhost:5174. Open the search modal (Ctrl+K), a confirm dialog (e.g. delete a tag), and hover a wiki link. Each should fade/rise in quickly and settle; nothing should bounce or linger.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat: entrance animations for modals, search, and wiki popover"
```

---

### Task 4: Staggered grid entrances (browse, books, worlds)

**Files:**
- Modify: `src/index.css` (stagger rule, near the shared keyframes from Task 1)
- Modify: `src/components/BrowseGrid.tsx:56-58`, `src/components/BrowseCard.tsx`
- Modify: `src/routes/ManuscriptRoute.tsx:40-49`
- Modify: `src/routes/LoreSelectorRoute.tsx:120-126,185-194`
- Test: `src/routes/ManuscriptRoute.test.tsx`

**Interfaces:**
- Consumes: `rise-in`, `--dur-3`, `--ease-settle` from Task 1.
- Produces: `BrowseCard` gains an optional `index?: number` prop (default `0`). Convention: card components set inline `'--stagger-i': Math.min(index, 12)`.

- [ ] **Step 1: Write the failing test (stagger index on book cards)**

Append to the `describe('ManuscriptRoute', ...)` block in `src/routes/ManuscriptRoute.test.tsx`:

```tsx
  it('staggers book cards by index, capped at 12', async () => {
    const books = Array.from({ length: 15 }, (_, i) => ({
      id: `b${i}`, title: `Book ${i}`, synopsis: '', order: i, createdAt: 1, updatedAt: 1,
    }))
    await db.books.bulkAdd(books)
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    const first = (await screen.findByText('Book 0')).closest('.book-card') as HTMLElement
    const last = (await screen.findByText('Book 14')).closest('.book-card') as HTMLElement
    expect(first.style.getPropertyValue('--stagger-i')).toBe('0')
    expect(last.style.getPropertyValue('--stagger-i')).toBe('12')
  })
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/routes/ManuscriptRoute.test.tsx`
Expected: FAIL — `--stagger-i` is `''` (property not set).

- [ ] **Step 3: Set `--stagger-i` in the three grids**

`src/routes/ManuscriptRoute.tsx` — the book map at line 40 becomes:

```tsx
          {books.map((b, i) => {
            const st = stats.get(b.id) ?? { count: 0, words: 0 }
            return (
              <Link
                key={b.id}
                to={`/book/${b.id}`}
                className="book-card"
                style={{ '--stagger-i': Math.min(i, 12) } as CSSProperties}
              >
```

Add `import type { CSSProperties } from 'react'` at the top of the file.

`src/components/BrowseGrid.tsx` — line 56 becomes:

```tsx
          {pages.map((page, i) => (
            <BrowseCard key={page.id} page={page} index={i} />
          ))}
```

`src/components/BrowseCard.tsx` — signature and root element become:

```tsx
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { categoryColor, statusColor, pageStatus, type LorePage } from '../db'

export default function BrowseCard({ page, index = 0 }: { page: LorePage; index?: number }) {
  const color = categoryColor(page.category)
  return (
    <Link
      to={`/page/${page.id}`}
      className="browse-card"
      style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}
    >
```

(rest of the component unchanged)

`src/routes/LoreSelectorRoute.tsx` — the world-card div at line 123 gains a style (the map at 120 already has `lore` — add the index param `(lore, i)`):

```tsx
        {lores.map((lore, i) => {
          const isActive = lore.id === activeId
          return (
            <div
              key={lore.id}
              className={`world-card${isActive ? ' world-card--active' : ''}`}
              style={{ '--stagger-i': Math.min(i, 12) } as CSSProperties}
            >
```

and the add-world tile (line 186) enters with the last wave:

```tsx
          <button
            className="world-card-add"
            onClick={handleCreate}
            disabled={creating}
            style={{ '--stagger-i': Math.min(lores.length, 12) } as CSSProperties}
          >
```

Add `import type { CSSProperties } from 'react'` to `LoreSelectorRoute.tsx` too.

- [ ] **Step 4: Add the stagger CSS**

In `src/index.css`, after the shared keyframes from Task 1, add:

```css
/* Staggered grid entrances. Components set --stagger-i (capped at 12 so big
   grids don't ripple for seconds; everything past 12 arrives with the last
   wave). fill-mode backwards holds the `from` frame during the delay —
   without it, delayed cards flash visible then vanish. */
.browse-card, .book-card, .world-card, .world-card-add {
  animation: rise-in var(--dur-3) var(--ease-settle) backwards;
  animation-delay: calc(var(--stagger-i, 0) * 25ms);
}
```

- [ ] **Step 5: Run the test to verify it passes, plus the touched suites**

Run: `npm run test:run -- src/routes/ManuscriptRoute.test.tsx src/routes/LoreSelectorRoute.test.tsx src/routes/TagRoute.test.tsx`
Expected: PASS (all).

- [ ] **Step 6: Manual smoke check**

`npm run dev` → visit `/browse/<any category>`, `/manuscript`, and `/` (selector). Cards should ripple in quickly (25ms apart), settle by ~mid-scroll, and hover lifts should still work after entrance.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/components/BrowseGrid.tsx src/components/BrowseCard.tsx src/routes/ManuscriptRoute.tsx src/routes/LoreSelectorRoute.tsx src/routes/ManuscriptRoute.test.tsx
git commit -m "feat: staggered grid entrances for browse, book, and world cards"
```

---

### Task 5: Press feedback + sidebar chevron rotation

**Files:**
- Modify: `src/index.css` (buttons section, ~line 208; sidebar section)
- Modify: `src/components/Sidebar.tsx:130,150,175`

**Interfaces:**
- Consumes: `--dur-1`, `--ease-out` from Task 1.
- Produces: `.chev` / `.chev--open` classes (Sidebar-internal).

- [ ] **Step 1: Button press-down**

In the Buttons section of `src/index.css` (after the `.ghost-btn.danger:hover` rule), add:

```css
/* Press feedback — buttons dip 1px while held. */
.ghost-btn:active, .primary-btn:active, .nav-item:active { transform: translateY(1px); }
```

- [ ] **Step 2: Check no test asserts the chevron glyphs**

Run: `grep -rn "▸\|▾" src --include="*.test.*"`
Expected: no output. (If a test matches, update its assertion alongside Step 3.)

- [ ] **Step 3: Rotatable chevron in `Sidebar.tsx`**

There are three identical ternaries (lines 130, 150, 175). Replace each — the glyph is now always `▸`, rotated open via class:

Line 130: `{collapsed.has(RECENT_GROUP) ? '▸' : '▾'}` →
```tsx
<span className={collapsed.has(RECENT_GROUP) ? 'chev' : 'chev chev--open'}>▸</span>
```

Line 150: `{collapsed.has(category) ? '▸' : '▾'}` →
```tsx
<span className={collapsed.has(category) ? 'chev' : 'chev chev--open'}>▸</span>
```

Line 175: `{collapsed.has(TAGS_GROUP) ? '▸' : '▾'}` →
```tsx
<span className={collapsed.has(TAGS_GROUP) ? 'chev' : 'chev chev--open'}>▸</span>
```

- [ ] **Step 4: Chevron CSS**

In the Sidebar section of `src/index.css` (near the `.group-toggle` rules), add:

```css
.group-toggle .chev {
  display: inline-block;
  transition: transform var(--dur-1) var(--ease-out);
}
.group-toggle .chev--open { transform: rotate(90deg); }
```

- [ ] **Step 5: Run the suite + manual check**

Run: `npm run test:run`
Expected: PASS. Then in the dev app: collapse/expand a sidebar group — the chevron rotates smoothly; buttons dip on press.

- [ ] **Step 6: Commit**

```bash
git add src/index.css src/components/Sidebar.tsx
git commit -m "feat: button press feedback + animated sidebar chevrons"
```

---

### Task 6: Route transition retiming

**Files:**
- Modify: `src/index.css:1968-1972` (`.route-fade` + `@keyframes route-fade-in`)

**Interfaces:**
- Consumes: `--dur-3`, `--ease-settle` from Task 1. (`App.tsx`'s keyed `.route-fade` div is unchanged.)

- [ ] **Step 1: Retime**

Replace:

```css
.route-fade { height: 100%; animation: route-fade-in 120ms ease-out; }
@keyframes route-fade-in {
  from { opacity: 0; transform: translateY(6px); }
```

with:

```css
.route-fade { height: 100%; animation: route-fade-in var(--dur-3) var(--ease-settle); }
@keyframes route-fade-in {
  from { opacity: 0; transform: translateY(4px); }
```

(keep the existing `to`/closing lines as-is)

- [ ] **Step 2: Manual check + commit**

Navigate between routes in the dev app — the content should rise in perceptibly but quietly (no flash).

```bash
git add src/index.css
git commit -m "feat: retime route transition onto motion tokens (240ms settle)"
```

---

### Task 7: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: CI gate locally**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three exit 0.

- [ ] **Step 2: Reduced-motion check**

In the dev app, emulate `prefers-reduced-motion: reduce` (DevTools → Rendering). Modals, grids, routes must appear instantly, fully visible — no stuck-invisible cards (the `backwards` fill + 0.01ms clamp guarantee this; verify anyway).

- [ ] **Step 3: Full manual sweep**

One pass through: search modal (Ctrl+K), confirm dialog, calendar/event editors, wiki-link hover, `/browse/:category`, `/manuscript`, `/` selector, sidebar collapse, several route changes.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin feat/motion-system
gh pr create --title "Quiet-library motion system: tokens, entrances, stagger, feedback" --label version:minor --body "$(cat <<'EOF'
Implements docs/superpowers/specs/2026-07-04-motion-system-design.md

- Motion tokens (dur-1/2/3, ease-settle) + shared fade-in/rise-in keyframes
- All 14 ad-hoc transition timings normalized onto tokens
- Entrances: modal/search dialogs (fade + rise + 0.98 scale), wiki popover
- Staggered grid entrances (browse/book/world cards, 25ms, capped at 12)
- Button press feedback; animated sidebar chevrons
- Route transition retimed to 240ms settle

Reduced motion: covered by the existing global clamp; entrances end at
natural resting state and use fill-mode backwards (nothing can be left
invisible).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
