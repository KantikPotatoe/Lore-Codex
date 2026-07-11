# Manuscript & Book Atmosphere Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the manuscript book library into a shelf of bound books, give `Book.synopsis` its first editor, and sweep the manuscript CSS onto the app's shared type/spacing/motion vocabulary.

**Architecture:** One new pure module (`src/bookCover.ts`) derives a deterministic cover colour from a book's title. `ManuscriptRoute` renders books as portrait covers carrying that hue as a CSS custom property; the CSS mixes it down into a leather register. `BookRoute` gains a blurb textarea. The manuscript block of `src/index.css` converts rem → px. No schema change, no new dependency, no new motion token.

**Tech Stack:** React 19 + TypeScript (strict), Dexie/`useLiveQuery`, plain CSS custom properties in `src/index.css`, Vitest + happy-dom + `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-07-11-manuscript-atmosphere-design.md`
**Branch:** `feat/168-manuscript-atmosphere` (already exists, spec already committed)
**Issue:** #168

## Global Constraints

- **Import from the barrel.** Always `import { … } from '../db'` (or `'../../db'`), never from `src/db/schema.ts` directly. `barrel.test.ts` fails if new public API isn't re-exported from `src/db/index.ts`. (This plan adds no new `db` API, so nothing to re-export.)
- **Preserve these exact strings** — existing tests match on them and must stay green without edits: `no books yet`, `no plotlines yet`, `select a scene` (all case-insensitive substring matches).
- **Preserve the `.book-card` class name.** It is listed in the shared stagger selector in `src/index.css` and `ManuscriptRoute.test.tsx` locates cards with `.closest('.book-card')`.
- **No rem in `src/index.css`.** The manuscript block is the file's last rem holdout; the whole file is px after Task 2.
- **Motion tokens only** — `--dur-1` (120ms), `--dur-2` (180ms), `--dur-3` (240ms), `--ease-out`, `--ease-settle`. Introduce no new durations or easings.
- **TypeScript is `strict`.** No `any`, no non-null assertions added.
- **Definition of done:** `npm run lint`, `npm run build`, and `npm run test:run` all pass. CI runs all three.
- **PR label:** `version:minor` (this adds a user-visible feature — the blurb editor).

---

### Task 1: `coverHue()` — deterministic cover colour from a title

A book carries no colour of its own, so the shelf derives one. The palette is passed **as an argument, not imported**: `TYPE_COLORS` lives in `src/db/schema.ts`, which constructs the Dexie `db` singleton at module load — importing it here would drag the database into a colour lookup and force this module's test onto fake-indexeddb for no reason.

**Files:**
- Create: `src/bookCover.ts`
- Test: `src/bookCover.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `coverHue(title: string, palette: readonly string[]): string` — used by `ManuscriptRoute` in Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/bookCover.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { coverHue } from './bookCover'

const PALETTE = ['#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd'] as const

describe('coverHue', () => {
  it('returns a colour from the supplied palette', () => {
    expect(PALETTE).toContain(coverHue('The Ashen Crown', PALETTE))
  })

  it('is deterministic — the same title always yields the same colour', () => {
    expect(coverHue('Salt and Iron', PALETTE)).toBe(coverHue('Salt and Iron', PALETTE))
  })

  it('spreads different titles across the palette rather than collapsing to one bucket', () => {
    const titles = [
      'The Ashen Crown', 'Salt and Iron', 'The Long Thaw',
      'Vespers', 'Tidewrack', 'The Gilded Hour',
    ]
    const hues = new Set(titles.map((t) => coverHue(t, PALETTE)))
    expect(hues.size).toBeGreaterThan(1)
  })

  it('handles an empty title (a book created but not yet named)', () => {
    expect(PALETTE).toContain(coverHue('', PALETTE))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/bookCover.test.ts`
Expected: FAIL — `Failed to resolve import "./bookCover"`.

- [ ] **Step 3: Write the implementation**

Create `src/bookCover.ts`:

```ts
/** Deterministic cover colour for a book, derived from its title.
 *
 *  Books carry no colour of their own. Rather than add a field, the shelf hashes
 *  the title (djb2) into the caller's palette — so every book looks distinct and
 *  looks the same on every visit. The trade: renaming a book re-colours its cover.
 *
 *  The palette is a parameter, not an import: TYPE_COLORS lives in db/schema.ts,
 *  which builds the Dexie singleton at module load, and a colour lookup has no
 *  business dragging the database in behind it. */
export function coverHue(title: string, palette: readonly string[]): string {
  let hash = 5381
  for (let i = 0; i < title.length; i++) {
    // `| 0` keeps the running hash a 32-bit int rather than drifting into floats.
    hash = ((hash << 5) + hash + title.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/bookCover.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bookCover.ts src/bookCover.test.ts
git commit -m "feat: coverHue() — deterministic book cover colour from title (#168)"
```

---

### Task 2: Normalize the manuscript CSS block from rem to px

Purely mechanical, no visual change intended. Do this **before** the cover work so later CSS lands on an already-normalized block.

**Files:**
- Modify: `src/index.css` — the manuscript block, currently lines ~2143–2665 (from the `/* Manuscript — books index + book workspace */` banner down to, but **not including**, the `/* --- Cross-tab world-change guard (#185) --- */` banner).

**Interfaces:**
- Consumes: nothing.
- Produces: a rem-free manuscript CSS block for Tasks 3–5 to edit.

- [ ] **Step 1: Convert every rem value in the block to px**

The rule is `px = round(rem × 16)` (the root font-size is the browser default 16px — `body`'s `font-size: 15px` does **not** affect rem). These are the only 30 distinct rem values in the block; replace each occurrence:

| rem | px | rem | px | rem | px |
|---|---|---|---|---|---|
| `0.05rem` | `1px` | `0.5rem` | `8px` | `1.1rem` | `18px` |
| `0.1rem` | `2px` | `0.6rem` | `10px` | `1.25rem` | `20px` |
| `0.15rem` | `2px` | `0.65rem` | `10px` | `1.4rem` | `22px` |
| `0.2rem` | `3px` | `0.7rem` | `11px` | `1.5rem` | `24px` |
| `0.25rem` | `4px` | `0.75rem` | `12px` | `2rem` | `32px` |
| `0.3rem` | `5px` | `0.8rem` | `13px` | `3rem` | `48px` |
| `0.35rem` | `6px` | `0.85rem` | `14px` | `4rem` | `64px` |
| `0.4rem` | `6px` | `0.9rem` | `14px` | `9rem` | `144px` |
| | | `0.95rem` | `15px` | `12rem` | `192px` |
| | | `1rem` | `16px` | `15rem` | `240px` |
| | | | | `16rem` | `256px` |
| | | | | `18rem` | `288px` |

Do not touch anything else in the block — no reordering, no renaming, no property changes. The `calc(var(--stagger-i, 0) * 25ms)` stagger rule lives in the foundations section and is not in scope here.

- [ ] **Step 2: Verify no rem survives in the block**

Run: `sed -n '2143,2665p' src/index.css | grep -c rem`
Expected: `0`

Then confirm the file as a whole is rem-free:

Run: `grep -n "[0-9.]rem" src/index.css`
Expected: no output.

- [ ] **Step 3: Verify the build and tests still pass**

Run: `npm run build && npm run test:run`
Expected: build succeeds; all tests pass. (No test asserts on CSS, so this is a regression check that nothing else broke.)

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style: normalize manuscript CSS from rem to px (#168)"
```

---

### Task 3: The shelf — book cards become bound covers

**Files:**
- Modify: `src/routes/ManuscriptRoute.tsx`
- Modify: `src/index.css` — the `.book-grid` / `.book-card` rules in the manuscript block, plus the `.parchment`, `.elevated`, and stagger selector lists in the foundations section (~lines 106–142)
- Test: `src/routes/ManuscriptRoute.test.tsx`

**Interfaces:**
- Consumes: `coverHue(title, palette)` from Task 1; `TYPE_COLORS` and `createBook` from the `../db` barrel; `EmptyState` from `../components/EmptyState`.
- Produces: the `.book-card` cover markup (`.book-card-title`, `.book-card-rule`, `.book-card-stats`, `.book-card-blurb`) and the `.book-card-add` tile.

- [ ] **Step 1: Write the failing tests**

Add these three tests to the existing `describe('ManuscriptRoute')` block in `src/routes/ManuscriptRoute.test.tsx`, and extend the import line at the top to `import { db, createBook, createChapter, createScene, updateScene, TYPE_COLORS } from '../db'` plus a new `import { coverHue } from '../bookCover'`:

```tsx
  it('gives each cover a deterministic hue derived from the title', async () => {
    await db.books.add({ id: 'b1', title: 'The Ashen Crown', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    const card = (await screen.findByText('The Ashen Crown')).closest('.book-card') as HTMLElement
    expect(card.style.getPropertyValue('--cover-hue')).toBe(coverHue('The Ashen Crown', TYPE_COLORS))
  })

  it('shows the blurb on the cover when the book has one', async () => {
    await db.books.add({
      id: 'b1', title: 'Salt and Iron', synopsis: 'Two smugglers, one debt.',
      order: 0, createdAt: 1, updatedAt: 1,
    })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    expect(await screen.findByText('Two smugglers, one debt.')).toBeTruthy()
  })

  it('offers an add-tile on the shelf once a book exists', async () => {
    await db.books.add({ id: 'b1', title: 'One', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    render(<MemoryRouter><ManuscriptRoute /></MemoryRouter>)
    expect(await screen.findByRole('button', { name: /new book/i })).toBeTruthy()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/routes/ManuscriptRoute.test.tsx`
Expected: the three new tests FAIL (no `--cover-hue` property, no blurb text, no add-tile button). The five existing tests still PASS.

- [ ] **Step 3: Rewrite `ManuscriptRoute.tsx`**

Replace the whole file with:

```tsx
import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { db, createBook, TYPE_COLORS, type Book, type Scene } from '../db'
import EmptyState from '../components/EmptyState'
import { coverHue } from '../bookCover'

const NO_BOOKS: Book[] = []
const NO_SCENES: Scene[] = []

export default function ManuscriptRoute() {
  const navigate = useNavigate()
  const books = useLiveQuery(() => db.books.orderBy('order').toArray(), []) ?? NO_BOOKS
  const scenes = useLiveQuery(() => db.scenes.toArray(), []) ?? NO_SCENES

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; words: number }>()
    for (const s of scenes) {
      const cur = m.get(s.bookId) ?? { count: 0, words: 0 }
      cur.count += 1
      cur.words += s.wordCount
      m.set(s.bookId, cur)
    }
    return m
  }, [scenes])

  async function handleNew() {
    const book = await createBook('Untitled Book')
    navigate(`/book/${book.id}`)
  }

  return (
    <div className="manuscript-page">
      <div className="manuscript-head">
        <h1 className="page-title">Manuscript</h1>
      </div>
      {books.length === 0 ? (
        <EmptyState
          icon="📖"
          title="No books yet"
          message="Your world has a story in it. Start the manuscript that tells it."
        >
          <button className="primary-btn" onClick={handleNew}>＋ New book</button>
        </EmptyState>
      ) : (
        <div className="book-grid">
          {books.map((b, i) => {
            const st = stats.get(b.id) ?? { count: 0, words: 0 }
            return (
              <Link
                key={b.id}
                to={`/book/${b.id}`}
                className="book-card"
                style={{
                  '--stagger-i': Math.min(i, 12),
                  '--cover-hue': coverHue(b.title, TYPE_COLORS),
                } as CSSProperties}
              >
                <span className="book-card-title">{b.title}</span>
                <span className="book-card-rule" aria-hidden="true" />
                <span className="book-card-stats">
                  {st.count} scene{st.count === 1 ? '' : 's'} · {st.words} words
                </span>
                {b.synopsis && <span className="book-card-blurb">{b.synopsis}</span>}
              </Link>
            )
          })}
          <button
            className="book-card-add"
            onClick={handleNew}
            style={{ '--stagger-i': Math.min(books.length, 12) } as CSSProperties}
          >
            <span className="book-card-add-icon" aria-hidden="true">＋</span>
            <span>New book</span>
          </button>
        </div>
      )}
    </div>
  )
}
```

Note the header's old `＋ New book` button is gone — the shelf's add-tile is now the affordance, and the empty state carries the CTA when there is no shelf.

- [ ] **Step 4: Add the cover to the shared grain / elevation / stagger lists**

In `src/index.css` foundations (~lines 106–142), add the cover and its add-tile to three existing selector lists.

Stagger list — add `.book-card-add`:

```css
.browse-card, .book-card, .world-card, .world-card-add, .book-card-add {
  animation: rise-in var(--dur-3) var(--ease-settle) backwards;
  animation-delay: calc(var(--stagger-i, 0) * 25ms);
}
```

Parchment list — add `.book-card` (the cover is the one manuscript surface with a solid fill to carry grain):

```css
.parchment,
.infobox,
.lore-card,
.ov-card,
.browse-card,
.book-card,
.modal-dialog,
.sidebar {
  background-image: var(--parchment-noise);
}
```

Elevation list — add `.book-card` (its `:hover` rule below overrides with a deeper shadow; `.book-card:hover` outranks this selector on specificity):

```css
.elevated,
.lore-card,
.infobox,
.book-card,
.ov-card {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 6px 18px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 5: Replace the `.book-grid` / `.book-card` CSS**

In the manuscript block of `src/index.css`, replace the existing `.book-grid`, `.book-card`, `.book-card:hover`, `.book-card-title`, `.book-card-synopsis`, and `.book-card-stats` rules with:

```css
/* The shelf. Each cover carries --cover-hue inline (deterministic from the title,
   see src/bookCover.ts). TYPE_COLORS are bright accents tuned for small marks, so
   the spine and board mix the hue down into a bookbinding register rather than
   using it raw — a shelf of bound books in a dim room, not a colour picker. */
.book-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 16px;
}
.book-card {
  position: relative;
  aspect-ratio: 2 / 3;
  display: flex;
  flex-direction: column;
  text-align: center;
  padding: 22px 16px 16px 30px; /* left padding clears the spine */
  background-color: color-mix(in srgb, var(--cover-hue, var(--accent)) 7%, var(--panel));
  border: 1px solid var(--border);
  border-radius: 3px 8px 8px 3px; /* square at the spine, rounded at the fore-edge */
  overflow: hidden;
  text-decoration: none;
  color: var(--ink);
  transition: transform var(--dur-1) var(--ease-settle),
              box-shadow var(--dur-1) var(--ease-settle);
}
/* The spine. */
.book-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 14px;
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--cover-hue, var(--accent)) 55%, #1a1512),
    color-mix(in srgb, var(--cover-hue, var(--accent)) 30%, #120f0c)
  );
  border-right: 1px solid rgba(0, 0, 0, 0.5);
}
/* Gold rule tooled just inboard of the spine. */
.book-card::after {
  content: '';
  position: absolute;
  left: 20px;
  top: 12px;
  bottom: 12px;
  width: 1px;
  background: color-mix(in srgb, var(--accent) 30%, transparent);
}
.book-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
}
.book-card-title {
  font-family: var(--display);
  font-size: 17px;
  font-weight: 600;
  line-height: 1.25;
  letter-spacing: 0.02em;
  color: var(--accent-soft);
  margin: auto 0; /* centres the title in the space above the rule */
}
.book-card-rule {
  width: 34px;
  height: 1px;
  margin: 10px auto;
  background: color-mix(in srgb, var(--accent) 45%, transparent);
}
.book-card-stats {
  font-size: 11px;
  color: var(--ink-faint);
}
/* Back-of-the-book blurb. Supplementary, never the only copy — hover content
   doesn't exist on touch, so the book workspace always shows it too. Revealed on
   keyboard focus as well as hover; the card is a <Link>, so :focus-visible fires. */
.book-card-blurb {
  position: absolute;
  left: 14px; /* starts at the spine's inner edge */
  right: 0;
  bottom: 0;
  padding: 30px 14px 14px 16px;
  text-align: left;
  font-family: var(--serif);
  font-size: 13px;
  line-height: 1.4;
  color: var(--ink);
  background: linear-gradient(
    180deg,
    rgba(21, 19, 15, 0) 0%,
    rgba(21, 19, 15, 0.92) 38%,
    rgba(21, 19, 15, 0.97) 100%
  );
  opacity: 0;
  transition: opacity var(--dur-2) var(--ease-settle);
}
.book-card:hover .book-card-blurb,
.book-card:focus-visible .book-card-blurb {
  opacity: 1;
}
/* An empty slot at the end of the shelf. Mirrors .world-card-add. */
.book-card-add {
  aspect-ratio: 2 / 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 2px dashed var(--border);
  border-radius: var(--radius);
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  font-family: var(--sans);
  font-size: 13px;
  transition: border-color var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.book-card-add:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.book-card-add-icon {
  font-size: 35px;
  line-height: 1;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/routes/ManuscriptRoute.test.tsx`
Expected: PASS — all 8 tests (5 pre-existing + 3 new). The pre-existing empty-state test still matches `/no books yet/i` against the new `EmptyState` title, and the stagger test still finds `.book-card`.

- [ ] **Step 7: Commit**

```bash
git add src/routes/ManuscriptRoute.tsx src/routes/ManuscriptRoute.test.tsx src/index.css
git commit -m "feat: book cards become bound covers with title-derived spines (#168)"
```

---

### Task 4: The blurb — `Book.synopsis` gets its first editor

`Book.synopsis` exists in the type and travels in backups, but nothing in the app has ever written it: `createBook` sets `''` and its only reader was the book card's synopsis line. Task 3 put that line back on the cover as a hover-revealed blurb; this task makes the field writable so it can actually hold something.

**Files:**
- Modify: `src/routes/BookRoute.tsx`
- Modify: `src/index.css` — the `.book-head` rule in the manuscript block
- Test: `src/routes/BookRoute.test.tsx`

**Interfaces:**
- Consumes: `updateBook(id, changes)` from the `../db` barrel (already imported in `BookRoute`).
- Produces: a `<textarea aria-label="Book blurb">` writing `Book.synopsis`.

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('BookRoute')` block in `src/routes/BookRoute.test.tsx`:

```tsx
  it('edits the blurb, which is what the shelf shows on the cover', async () => {
    await db.books.add({ id: 'b1', title: 'My Novel', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 })
    renderAt('/book/b1')
    const blurb = await screen.findByLabelText('Book blurb') as HTMLTextAreaElement
    fireEvent.change(blurb, { target: { value: 'A queen burns her own capital.' } })
    await waitFor(async () =>
      expect((await db.books.get('b1'))?.synopsis).toBe('A queen burns her own capital.'),
    )
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/routes/BookRoute.test.tsx`
Expected: FAIL — `Unable to find a label with the text of: Book blurb`.

- [ ] **Step 3: Add the blurb textarea to the book header**

In `src/routes/BookRoute.tsx`, replace the `<div className="book-head">…</div>` block with a two-row header:

```tsx
      <div className="book-head">
        <div className="book-head-row">
          <input
            className="page-title book-title-input"
            aria-label="Book title"
            value={book?.title ?? ''}
            placeholder="Untitled Book"
            disabled={!book}
            onChange={(e) => updateBook(bookId, { title: e.target.value })}
          />
          <div className="seg-control">
            <button className={view === 'write' ? 'seg active' : 'seg'} onClick={() => setView('write')}>Write</button>
            <button className={view === 'grid' ? 'seg active' : 'seg'} onClick={() => setView('grid')}>Grid</button>
          </div>
          <div className="book-compile">
            <button className="ghost-btn" onClick={() => exportBookEpub(bookId)}>EPUB</button>
            <button className="ghost-btn" onClick={() => printBook(bookId)}>Print / PDF</button>
          </div>
        </div>
        <textarea
          className="book-blurb-input"
          aria-label="Book blurb"
          placeholder="A line about this book — shown on its cover."
          value={book?.synopsis ?? ''}
          disabled={!book}
          onChange={(e) => updateBook(bookId, { synopsis: e.target.value })}
        />
      </div>
```

- [ ] **Step 4: Restyle the header for two rows**

In the manuscript block of `src/index.css`, replace the existing `.book-head` rule with:

```css
.book-head {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
}
.book-head-row {
  display: flex;
  align-items: center;
  gap: 16px;
}
/* Quiet until touched: the blurb reads as text, and only shows its edges on
   hover/focus, so the header doesn't sprout a form field. */
.book-blurb-input {
  width: 100%;
  min-height: 38px;
  resize: vertical;
  padding: 5px 8px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--ink-dim);
  font-family: var(--serif);
  font-size: 14px;
  line-height: 1.5;
  transition: border-color var(--dur-1) var(--ease-out), background var(--dur-1) var(--ease-out);
}
.book-blurb-input:hover:not(:disabled) {
  border-color: var(--border);
}
.book-blurb-input:focus {
  outline: none;
  border-color: var(--accent);
  background: var(--bg);
  color: var(--ink);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/routes/BookRoute.test.tsx`
Expected: PASS — all 5 tests (4 pre-existing + 1 new).

- [ ] **Step 6: Commit**

```bash
git add src/routes/BookRoute.tsx src/routes/BookRoute.test.tsx src/index.css
git commit -m "feat: book blurb editor — Book.synopsis gets its first writer (#168)"
```

---

### Task 5: Empty states adopt the shared `EmptyState` component

The two remaining manuscript empties are bare `<p className="empty-hint">` paragraphs where the rest of the app shows a designed empty state. Both **keep their current copy**, so the existing assertions keep matching.

**Files:**
- Modify: `src/components/manuscript/BookGridView.tsx:89`
- Modify: `src/components/manuscript/BookWriteView.tsx:25`

**Interfaces:**
- Consumes: `EmptyState` from `../EmptyState` (props: `icon: string`, `title: string`, `message?: ReactNode`, `children?: ReactNode`).
- Produces: nothing new.

- [ ] **Step 1: Replace the plotline-grid empty**

In `src/components/manuscript/BookGridView.tsx`, add `import EmptyState from '../EmptyState'` to the imports, then replace:

```tsx
        <p className="empty-hint">No plotlines yet. Add one to start plotting.</p>
```

with:

```tsx
        <EmptyState
          icon="🧵"
          title="No plotlines yet"
          message="Add a plotline to start weaving threads through your chapters."
        />
```

No CTA is needed — the `＋ Plotline` button already sits directly above in `.grid-board-actions`.

- [ ] **Step 2: Replace the no-scene-selected empty**

In `src/components/manuscript/BookWriteView.tsx`, add `import EmptyState from '../EmptyState'` to the imports, then replace:

```tsx
          <p className="empty-hint">Select a scene to start writing.</p>
```

with:

```tsx
          <EmptyState
            icon="✍️"
            title="Select a scene to start writing"
            message="Pick one from the binder, or add a scene to a chapter."
          />
```

- [ ] **Step 3: Run the affected tests to verify they still pass**

The copy is preserved, so the existing assertions (`/no plotlines yet/i`, `/select a scene/i`) match the new `EmptyState` titles unchanged.

Run: `npx vitest run src/components/manuscript src/routes/BookRoute.test.tsx`
Expected: PASS — all tests, with no edits to any assertion. **If one goes red, the copy drifted — fix the copy, do not edit the test.**

- [ ] **Step 4: Commit**

```bash
git add src/components/manuscript/BookGridView.tsx src/components/manuscript/BookWriteView.tsx
git commit -m "feat: manuscript empty states adopt the shared EmptyState (#168)"
```

---

### Task 6: Full verification and PR

**Files:** none modified.

- [ ] **Step 1: Run the full check suite**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass. This is exactly what CI runs.

- [ ] **Step 2: Verify in the running app**

Run: `npm run dev` (serves on port 5174 — pinned; do not change it).

Walk the flow and confirm each:
- `/manuscript` with no books → designed empty state with a working `＋ New book` CTA.
- Create two or three books → covers appear as a shelf, each with a distinct muted spine, staggered in.
- Add a blurb in the book workspace → return to `/manuscript`, hover the cover → the blurb fades up over the lower cover. Tab to the cover with the keyboard → the blurb reveals on focus too.
- The add-tile sits at the end of the shelf and creates a book.
- Book workspace: Write view (binder + editor + meta) and Grid view both render with no layout regression from the rem→px conversion.
- Grid view with no plotlines → designed empty state.
- DevTools → Rendering → emulate `prefers-reduced-motion: reduce` → covers appear instantly, no fades or lifts.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/168-manuscript-atmosphere
gh pr create --title "feat: manuscript & book atmosphere pass (#168)" --label "version:minor" --body "$(cat <<'EOF'
Session 2 of the visual-polish program. Closes #168.

Spec: `docs/superpowers/specs/2026-07-11-manuscript-atmosphere-design.md`

- **Book cards become bound covers** — 2:3 portrait, spine down the left edge, Cinzel title, gold rule. Each cover's hue is derived deterministically from its title (`src/bookCover.ts`) and mixed down into a leather register, so the shelf reads as bound books rather than a colour picker. No schema change.
- **`Book.synopsis` gets its first editor.** The field has existed (and travelled in backups) since the manuscript feature landed, but nothing in the app could write it — so the book card's synopsis line had never once rendered. It's now a blurb textarea in the book workspace, revealed on the cover on hover *and* keyboard focus.
- **Manuscript CSS normalized rem → px**, the file's last rem holdout.
- **Empty states** adopt the shared `EmptyState` component.

Deliberate narrowing of the issue's scope, recorded in the spec: the binder, editor, and scene-meta panes get **no** panels or elevation. Grain only reads on a solid fill, and those panes are transparent over the body gradient — noise there paints a dirty rectangle rather than material. So grain and elevation go where there's material to carry them: the covers.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** §1 shelf → Task 3. §2 cover hue → Tasks 1 and 3. §3 blurb → Tasks 3 (cover reveal) and 4 (workspace editor). §4 bare-rules workspace → Task 2 (the only change those panes get is unit normalization, which is precisely what "no new furniture" means) plus the grain/elevation lists in Task 3 Step 4, which add `.book-card` *only*. §5 units → Task 2; empty states → Tasks 3 and 5; motion → reuses existing tokens throughout. §6 testing → Tasks 1, 3, 4 write the tests; Task 6 runs the full suite and the manual pass.

**Placeholders:** none — every code step carries complete code, every command carries expected output.

**Type consistency:** `coverHue(title: string, palette: readonly string[]): string` is defined in Task 1 and called identically in Task 3's component and its test. `TYPE_COLORS` (`readonly string[]`, from the `db` barrel) satisfies that parameter. `EmptyState`'s props (`icon`, `title`, `message`, `children`) match its actual signature in `src/components/EmptyState.tsx`. `updateBook(bookId, { synopsis })` matches the existing `updateBook(id, changes: Partial<Book>)` already used for `title` in the same file.
