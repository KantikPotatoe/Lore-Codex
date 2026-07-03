# Polish Sprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Global search shortcut with recents + create-from-search, category-identity hero headers on browse/tag routes, drop caps + h2 underlines on article bodies, a real spine in the vertical timeline, and a graph minimap (closes #128).

**Architecture:** All items are additive UI work on the existing React + Dexie app. New logic lives in three small pure/testable modules (`searchShortcut.ts`, `graphMinimap.ts`, plus SearchModal row-building); everything else is markup + CSS refinement inside existing components. No data-model, backup, or schema changes.

**Tech Stack:** React 19, TypeScript strict, Vite, Vitest (happy-dom + fake-indexeddb + @testing-library/react), Dexie/useLiveQuery, react-force-graph-2d, one global stylesheet (`src/index.css`).

**Spec:** `docs/superpowers/specs/2026-07-03-polish-sprint-design.md`

## Global Constraints

- Always import DB API from the barrel: `import { … } from '../db'`; re-export any new public db API from `src/db/index.ts` (none is added by this plan).
- `src/platform.ts` is the only file allowed to touch `@tauri-apps/*` or `<a download>` — this plan never does either.
- TS `strict`; run `npm run lint && npm run build && npm run test:run` before claiming any task set done.
- Component tests that use `useLiveQuery` MUST have `afterEach(cleanup)` or teardown throws "window is not defined".
- No literal `Date.now()` / `Math.random()` in render paths (react-hooks/purity lint rule).
- Working branch: `feat/polish-sprint` (already created off `main`). PR label: `version:minor`.
- Dev server port is pinned to 5174 — do not touch `vite.config.ts`.

---

### Task 1: Global search shortcut (`Ctrl/Cmd+K`, `/`) + sidebar kbd hint

**Files:**
- Create: `src/searchShortcut.ts`
- Create: `src/searchShortcut.test.ts`
- Modify: `src/App.tsx` (add one `useEffect` + import)
- Modify: `src/components/Sidebar.tsx:110-116` (wrap search box, add kbd hint)
- Modify: `src/index.css` (after the `.search-box::placeholder` rule, ~line 156)

**Interfaces:**
- Produces: `shouldOpenSearch(e: KeyLike, target: EventTarget | null): boolean` from `src/searchShortcut.ts`, where `KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }`. Task 2 does not depend on it; nothing else consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/searchShortcut.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldOpenSearch } from './searchShortcut'

function key(over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) {
  return { key: '/', ctrlKey: false, metaKey: false, altKey: false, ...over }
}

describe('shouldOpenSearch', () => {
  it('Ctrl+K opens regardless of focus target', () => {
    const input = document.createElement('input')
    expect(shouldOpenSearch(key({ key: 'k', ctrlKey: true }), input)).toBe(true)
  })

  it('Cmd+K (uppercase K) opens too', () => {
    expect(shouldOpenSearch(key({ key: 'K', metaKey: true }), null)).toBe(true)
  })

  it('bare / opens when focus is on the body', () => {
    expect(shouldOpenSearch(key(), document.body)).toBe(true)
  })

  it('bare / is ignored inside inputs, textareas, selects', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(shouldOpenSearch(key(), document.createElement(tag))).toBe(false)
    }
  })

  it('bare / is ignored inside contenteditable (ProseMirror) and its descendants', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editor.appendChild(child)
    expect(shouldOpenSearch(key(), editor)).toBe(false)
    expect(shouldOpenSearch(key(), child)).toBe(false)
  })

  it('Alt combos and unrelated keys never open', () => {
    expect(shouldOpenSearch(key({ key: 'k', ctrlKey: true, altKey: true }), null)).toBe(false)
    expect(shouldOpenSearch(key({ key: 'a' }), document.body)).toBe(false)
    expect(shouldOpenSearch(key({ key: '/', ctrlKey: true }), document.body)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/searchShortcut.test.ts`
Expected: FAIL — cannot resolve `./searchShortcut`.

- [ ] **Step 3: Write the implementation**

Create `src/searchShortcut.ts`:

```ts
/** Decide whether a window-level keydown should open the search modal.
 *  Ctrl/Cmd+K always opens; a bare `/` opens only when focus isn't in an
 *  editable control (inputs, selects, contenteditable — incl. ProseMirror),
 *  so typing text is never hijacked. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // closest() (not isContentEditable) so descendants of a contenteditable host
  // match in every DOM implementation the tests run under.
  return target.closest('[contenteditable="true"]') !== null
}

export function shouldOpenSearch(e: KeyLike, target: EventTarget | null): boolean {
  if (e.altKey) return false
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') return true
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) return !isEditableTarget(target)
  return false
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/searchShortcut.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Wire it in `App.tsx`**

Add the import next to the other local imports:

```ts
import { shouldOpenSearch } from './searchShortcut'
```

Add this effect inside `App()`, right after the existing `searchOpen` state declarations (after the route-scroll effect is fine):

```ts
  // Open search from anywhere: Ctrl/Cmd+K always, `/` when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldOpenSearch(e, e.target)) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
```

Note: the listener is mounted unconditionally, but the `/` route early-returns before the modal exists — that's fine because `setSearchOpen(true)` has no effect there (the modal only renders in the shell branch, and the state resets on world switch anyway).

- [ ] **Step 6: Add the kbd hint in `Sidebar.tsx`**

Replace the search input (lines 110–116):

```tsx
      <input
        className="search-box"
        placeholder="Search lore…"
        readOnly
        onFocus={onOpenSearch}
        onClick={onOpenSearch}
      />
```

with:

```tsx
      <div className="search-box-wrap">
        <input
          className="search-box"
          placeholder="Search lore…"
          readOnly
          onFocus={onOpenSearch}
          onClick={onOpenSearch}
        />
        <kbd className="search-kbd">Ctrl K</kbd>
      </div>
```

- [ ] **Step 7: Style the wrapper + hint in `src/index.css`**

The existing rules (~line 152) are:

```css
.search-box {
  margin: 0 14px 10px; padding: 8px 11px; border-radius: 8px;
  background: var(--panel); border: 1px solid var(--border); color: var(--ink);
}
.search-box::placeholder { color: var(--ink-faint); }
```

Change `.search-box` (the wrapper takes over the margin) and add the two new rules directly below:

```css
.search-box {
  display: block; width: 100%; padding: 8px 58px 8px 11px; border-radius: 8px;
  background: var(--panel); border: 1px solid var(--border); color: var(--ink);
}
.search-box::placeholder { color: var(--ink-faint); }
.search-box-wrap { position: relative; margin: 0 14px 10px; }
.search-kbd {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  font-family: var(--sans); font-size: 10.5px; color: var(--ink-faint);
  border: 1px solid var(--border); border-radius: 5px; padding: 1px 6px;
  background: var(--bg-2); pointer-events: none;
}
```

- [ ] **Step 8: Verify the suite + lint still pass**

Run: `npm run lint && npx vitest run src/searchShortcut.test.ts src/components/Sidebar.test.tsx`
Expected: lint clean, tests pass (Sidebar tests confirm the markup change broke nothing).

- [ ] **Step 9: Commit**

```bash
git add src/searchShortcut.ts src/searchShortcut.test.ts src/App.tsx src/components/Sidebar.tsx src/index.css
git commit -m "feat: global search shortcut (Ctrl+K, /) with sidebar kbd hint"
```

---

### Task 2: SearchModal — recents when empty, create-from-search

**Files:**
- Modify: `src/components/SearchModal.tsx` (full rewrite below)
- Create: `src/components/SearchModal.test.tsx`
- Modify: `src/index.css` (search-modal section, ~line 1302)

**Interfaces:**
- Consumes: `getRecent()` from `src/recents.ts` (returns `string[]` of page ids, most recent first); `db.pages.bulkGet(ids)`, `pageRepo.listByTitle()`, `pageRepo.create({ title })` from `'../db'`; `searchPages`/`highlightSnippet` from `'../search'`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing tests**

Create `src/components/SearchModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import SearchModal from './SearchModal'
import { db, pageRepo } from '../db'
import { buildIndex } from '../search'
import { recordRecent } from '../recents'

afterEach(cleanup)

beforeEach(async () => {
  await db.pages.clear()
  localStorage.clear()
  buildIndex([]) // reset the module-level FlexSearch index between tests
})

function renderModal() {
  return render(
    <MemoryRouter>
      <SearchModal onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('SearchModal', () => {
  it('shows recently viewed pages when the query is empty', async () => {
    const id = await pageRepo.create({ title: 'Rivendell' })
    recordRecent(id)
    renderModal()
    expect(await screen.findByText('Recently viewed')).toBeTruthy()
    expect(await screen.findByText('Rivendell')).toBeTruthy()
  })

  it('offers a create row when no page has the queried title', async () => {
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('Search pages…'), { target: { value: 'Moria' } })
    expect(await screen.findByText(/Create page/)).toBeTruthy()
  })

  it('hides the create row when a page with that exact title exists', async () => {
    const page = await pageRepo.create({ title: 'Moria' })
    buildIndex([(await pageRepo.get(page))!])
    renderModal()
    fireEvent.change(screen.getByPlaceholderText('Search pages…'), { target: { value: 'moria' } })
    await waitFor(() => expect(screen.queryByText(/Create page/)).toBeNull())
  })

  it('creates the page and clears on Enter over the create row', async () => {
    renderModal()
    const input = screen.getByPlaceholderText('Search pages…')
    fireEvent.change(input, { target: { value: 'Khazad-dûm' } })
    await screen.findByText(/Create page/)
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => {
      expect(await pageRepo.findIdByTitle('Khazad-dûm')).toBeTruthy()
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/SearchModal.test.tsx`
Expected: FAIL — "Recently viewed" / "Create page" not found (current modal renders neither).

- [ ] **Step 3: Rewrite `src/components/SearchModal.tsx`**

Replace the whole file with:

```tsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { searchPages, highlightSnippet } from '../search'
import { db, pageRepo, categoryColor, type LorePage } from '../db'
import { getRecent } from '../recents'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'

interface Props {
  onClose: () => void
}

/** A selectable row: an existing page (hit or recent), or the trailing
 *  "create this page" action offered when nothing matches the query exactly. */
type Row =
  | { kind: 'page'; id: string; title: string; category: string; snippet: string }
  | { kind: 'create'; title: string }

const NO_PAGES: LorePage[] = []

export default function SearchModal({ onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const q = query.trim()
  const results = useMemo(() => searchPages(query), [query])

  // Recently-viewed pages for the empty-query state. bulkGet keeps the stored
  // order; ids of since-deleted pages come back undefined and are dropped.
  const recent =
    useLiveQuery(async () => {
      const ids = getRecent()
      if (ids.length === 0) return NO_PAGES
      const pages = await db.pages.bulkGet(ids)
      return pages.filter((p): p is LorePage => p != null)
    }, []) ?? NO_PAGES

  // All pages, for the exact-title check deciding whether to offer "create".
  const allPages = useLiveQuery(() => pageRepo.listByTitle(), []) ?? NO_PAGES
  const titleExists = useMemo(
    () => allPages.some((p) => p.title.trim().toLowerCase() === q.toLowerCase()),
    [allPages, q],
  )

  const rows = useMemo<Row[]>(() => {
    if (!q) {
      return recent.map((p) => ({
        kind: 'page' as const, id: p.id, title: p.title, category: p.category, snippet: '',
      }))
    }
    const pageRows: Row[] = results.map((r) => ({ kind: 'page' as const, ...r }))
    if (!titleExists) pageRows.push({ kind: 'create', title: q })
    return pageRows
  }, [q, results, recent, titleExists])

  // Reset the highlighted row whenever the query changes. Adjusting state during
  // render (rather than in an effect) avoids a redundant re-render — see
  // react.dev "You Might Not Need an Effect".
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setSelected(0)
  }

  useEffect(() => { inputRef.current?.focus() }, [])

  function go(id: string) {
    navigate(`/page/${id}`)
    onClose()
  }

  async function activate(row: Row) {
    if (row.kind === 'page') {
      go(row.id)
      return
    }
    const id = await pageRepo.create({ title: row.title })
    go(id)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, rows.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && rows[selected]) void activate(rows[selected])
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-modal-input"
          placeholder="Search pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
        />
        {!q && rows.length > 0 && <div className="search-section-label">Recently viewed</div>}
        {rows.length > 0 && (
          <div className="search-results">
            {rows.map((row, i) =>
              row.kind === 'page' ? (
                <div
                  key={row.id}
                  className={`search-result${i === selected ? ' is-selected' : ''}`}
                  onClick={() => go(row.id)}
                  onMouseEnter={(e) => { setSelected(i); showPageHover(row.id, row.title, e.currentTarget.getBoundingClientRect()) }}
                  onMouseLeave={scheduleWikiHoverClose}
                >
                  <div className="search-result-title">
                    <span
                      className="search-result-dot"
                      style={{ background: categoryColor(row.category) }}
                    />
                    {row.title}
                  </div>
                  {row.snippet && (
                    <div
                      className="search-result-snippet"
                      dangerouslySetInnerHTML={{ __html: highlightSnippet(row.snippet, query) }}
                    />
                  )}
                </div>
              ) : (
                <div
                  key="__create__"
                  className={`search-result search-create${i === selected ? ' is-selected' : ''}`}
                  onClick={() => void activate(row)}
                  onMouseEnter={() => setSelected(i)}
                >
                  ＋ Create page “{row.title}”
                </div>
              ),
            )}
          </div>
        )}
        {q && rows.length === 0 && (
          <div className="search-empty">No results for "{query}"</div>
        )}
      </div>
    </div>
  )
}
```

(Note the last block: with the create row, `rows` is only empty on a non-empty query when the exact title already exists **and** the index returned nothing — the old "No results" copy still covers it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/SearchModal.test.tsx`
Expected: 4 passing.

- [ ] **Step 5: Add the two new styles**

In `src/index.css`, find the search-modal section (`/* --- Search modal --- */`, ~line 1302) and add at its end:

```css
.search-section-label {
  padding: 10px 14px 4px; font-family: var(--display); font-size: 11px;
  text-transform: uppercase; letter-spacing: 1px; color: var(--ink-faint);
}
.search-result.search-create { color: var(--accent-soft); font-weight: 600; }
```

- [ ] **Step 6: Lint + full test sweep**

Run: `npm run lint && npm run test:run`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/components/SearchModal.tsx src/components/SearchModal.test.tsx src/index.css
git commit -m "feat: search modal shows recents when empty and offers create-from-search"
```

---

### Task 3: Browse/tag hero headers

**Files:**
- Modify: `src/components/BrowseGrid.tsx`
- Modify: `src/components/BrowseGrid.test.tsx`
- Modify: `src/routes/CategoryRoute.tsx`
- Modify: `src/routes/TagRoute.tsx`
- Modify: `src/index.css` (Category Browse section, ~line 964)

**Interfaces:**
- Produces: `BrowseGrid` gains an optional `glyph?: string` prop (page-type emoji). The count copy changes from a bare number to `N pages` / `1 page`.
- Consumes: `db.templates` rows (`{ name, icon? }`) for the category glyph.

- [ ] **Step 1: Update the tests first**

In `src/components/BrowseGrid.test.tsx` replace the two count assertions and add a glyph test — the `describe` block becomes:

```tsx
describe('BrowseGrid', () => {
  it('renders the title, a live count, and a card per page', () => {
    const pages = [makePage({ id: 'p1', title: 'Fireball' }), makePage({ id: 'p2', title: 'Frostbite' })]
    renderGrid(<BrowseGrid title="Spell" pages={pages} empty={EMPTY} />)

    expect(screen.getByRole('heading', { name: /Spell/ })).toBeTruthy()
    expect(screen.getByText('2 pages')).toBeTruthy()
    expect(screen.getByText('Fireball')).toBeTruthy()
    expect(screen.getByText('Frostbite')).toBeTruthy()
  })

  it('uses the singular for one page and renders the glyph when given', () => {
    renderGrid(<BrowseGrid title="Spell" glyph="✨" pages={[makePage()]} empty={EMPTY} />)
    expect(screen.getByText('1 page')).toBeTruthy()
    expect(screen.getByText('✨')).toBeTruthy()
  })

  it('shows the empty state (and no cards) when there are no pages', () => {
    renderGrid(<BrowseGrid title="Spell" pages={[]} empty={EMPTY} />)

    expect(screen.getByText('Nothing here')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('0 pages')).toBeTruthy()
  })

  it('renders the optional action control', () => {
    renderGrid(
      <BrowseGrid
        title="Spell"
        pages={[]}
        empty={EMPTY}
        action={<button>+ New Spell</button>}
      />,
    )
    expect(screen.getByRole('button', { name: '+ New Spell' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify the new assertions fail**

Run: `npx vitest run src/components/BrowseGrid.test.tsx`
Expected: FAIL — `2 pages` not found (current markup renders `2`), glyph test fails on unknown prop output.

- [ ] **Step 3: Rewrite the `BrowseGrid` header**

In `src/components/BrowseGrid.tsx`, change the import line and the component:

```tsx
import type { CSSProperties, ReactNode } from 'react'
import type { LorePage } from '../db'
import BrowseCard from './BrowseCard'
import EmptyState from './EmptyState'

/** Empty-state copy shown when a browse screen has no pages. */
export interface BrowseEmpty {
  icon: string
  title: string
  message: string
}

/** Shared layout for the "list of pages" screens (a category, a tag): an
 *  identity hero (accent bar + colour wash, mirroring .page-header), then
 *  either a card grid or an empty state. CategoryRoute / TagRoute differ only
 *  in the query and this copy. */
export default function BrowseGrid({
  title,
  titleColor,
  glyph,
  action,
  pages,
  empty,
}: {
  /** Heading content (e.g. a category name, or `#tag`). */
  title: ReactNode
  /** Accent colour driving the hero's bar + wash (defaults to gold). */
  titleColor?: string
  /** Optional page-type emoji shown large beside the title. */
  glyph?: string
  /** Optional header control, e.g. a "+ New" button. */
  action?: ReactNode
  pages: LorePage[]
  empty: BrowseEmpty
}) {
  return (
    <div className="browse-route">
      <header
        className="browse-header browse-hero"
        style={{ '--hero-color': titleColor ?? 'var(--accent)' } as CSSProperties}
      >
        {glyph && <span className="browse-hero-glyph">{glyph}</span>}
        <h1 className="browse-title">
          {title}
          <span className="browse-count">
            {pages.length === 1 ? '1 page' : `${pages.length} pages`}
          </span>
        </h1>
        {action}
      </header>

      {pages.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} message={empty.message} />
      ) : (
        <div className="browse-grid">
          {pages.map((page) => (
            <BrowseCard key={page.id} page={page} />
          ))}
        </div>
      )}
    </div>
  )
}
```

(The old `style={titleColor ? { color: titleColor } : undefined}` on the `h1` is intentionally dropped — identity now comes from the bar + wash, like `.page-header`, and the title stays `--ink`.)

- [ ] **Step 4: Style the hero**

In `src/index.css`, in the `/* ── Category Browse ── */` section, add right after the existing `.browse-header` rule:

```css
.browse-header.browse-hero {
  border-left: 3px solid var(--hero-color, var(--accent));
  border-radius: 0 8px 8px 0;
  padding: 14px 18px 12px;
  background: linear-gradient(to right, color-mix(in srgb, var(--hero-color, var(--accent)) 11%, transparent), transparent 62%);
}
.browse-hero-glyph { font-size: 32px; line-height: 1; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.5)); }
```

- [ ] **Step 5: Pass the glyph from the routes**

`src/routes/CategoryRoute.tsx` — add the templates query and glyph:

```tsx
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pageRepo, categoryColor } from '../db'
import BrowseGrid from '../components/BrowseGrid'

const NO_PAGES: import('../db').LorePage[] = []

export default function CategoryRoute() {
  const { category = '' } = useParams<{ category: string }>()
  const navigate = useNavigate()

  const pages =
    useLiveQuery(() => pageRepo.listByCategory(category), [category]) ?? NO_PAGES
  const templates = useLiveQuery(() => db.templates.toArray(), []) ?? []
  const glyph = templates.find((t) => t.name === category)?.icon

  async function handleNew() {
    const id = await pageRepo.create({ category })
    navigate(`/page/${id}`)
  }

  return (
    <BrowseGrid
      title={category}
      titleColor={categoryColor(category)}
      glyph={glyph}
      action={
        <button className="primary-btn" onClick={handleNew}>
          + New {category}
        </button>
      }
      pages={pages}
      empty={{
        icon: '📭',
        title: `No ${category} pages yet`,
        message: `Use “+ New ${category}” above to create the first one.`,
      }}
    />
  )
}
```

`src/routes/TagRoute.tsx` — one-line change, pass the tag glyph:

```tsx
    <BrowseGrid
      title={`#${tag}`}
      glyph="🏷️"
      pages={pages}
```

- [ ] **Step 6: Run tests + lint**

Run: `npm run lint && npx vitest run src/components/BrowseGrid.test.tsx src/components/BrowseCard.test.tsx`
Expected: clean, all passing.

- [ ] **Step 7: Commit**

```bash
git add src/components/BrowseGrid.tsx src/components/BrowseGrid.test.tsx src/routes/CategoryRoute.tsx src/routes/TagRoute.tsx src/index.css
git commit -m "feat: category-identity hero headers on browse and tag routes"
```

---

### Task 4: Drop caps + article h2 underlines

**Files:**
- Modify: `src/components/LoreEditor.tsx:354` (root class gains `is-reading` when not editable)
- Modify: `src/index.css` (Editor section, after the `.ProseMirror hr` rule ~line 433)

**Interfaces:**
- Consumes: `LoreEditor`'s existing `editable` prop.
- Produces: the read-mode editor root carries class `lore-editor is-reading` (CSS hook only).

- [ ] **Step 1: Tag read mode on the editor root**

In `src/components/LoreEditor.tsx` line 354, change:

```tsx
    <div className="lore-editor">
```

to:

```tsx
    <div className={editable ? 'lore-editor' : 'lore-editor is-reading'}>
```

(`editable` is already a prop in scope — it drives the toolbar render just below.)

- [ ] **Step 2: Add the CSS**

In `src/index.css`, after the `.ornament-divider, .ProseMirror hr` rule (~line 433), add:

```css
/* Drop cap — view mode only, and only when the article opens with a paragraph.
   Float technique (not initial-letter) so Firefox renders it too. */
.page-main .lore-editor.is-reading .ProseMirror > p:first-child::first-letter {
  float: left;
  font-family: var(--display);
  color: var(--accent);
  font-size: 3.05em;
  line-height: 0.82;
  padding: 4px 8px 0 0;
}

/* Article section headings share the Home-section gold underline. Scoped to
   .page-main so the manuscript scene editor keeps its plainer look. */
.page-main .ProseMirror h2 {
  border-bottom: 1px solid transparent;
  padding-bottom: 6px;
  border-image: linear-gradient(to right, var(--accent) 0%, var(--border) 28%, var(--border) 100%) 1;
}
```

- [ ] **Step 3: Verify lint/build/tests**

Run: `npm run lint && npm run build && npm run test:run`
Expected: clean. (Pure CSS + a class toggle; no new tests. Eyeball in the dev server during final verification.)

- [ ] **Step 4: Commit**

```bash
git add src/components/LoreEditor.tsx src/index.css
git commit -m "feat: drop caps and gold h2 underlines on article bodies (view mode)"
```

---

### Task 5: Timeline spine (vertical view)

**Files:**
- Modify: `src/components/TimelineVertical.tsx` (event row markup)
- Modify: `src/index.css` (TimelineVertical section, ~line 1722)

**Interfaces:**
- Consumes: nothing new — same props (`events`, `calendars`, `displayCalendar`, `allPages`, `onEdit`).
- Produces: nothing consumed later. `.tl-card-date` markup and CSS are removed; new classes `.tl-row`, `.tl-gutter`, `.tl-gutter-date`, `.tl-gutter-end`, `.tl-node`, `.tl-node-dot`.

- [ ] **Step 1: Restructure the event rows**

In `src/components/TimelineVertical.tsx`, replace the whole `return (...)` block of the inner `group.events.map` callback (currently the `<div key={event.id} className="tl-event-card" …>` element) with:

```tsx
              return (
                <div key={event.id} className="tl-row">
                  <div className="tl-gutter">
                    <span className="tl-gutter-date">{startLabel}</span>
                    {endLabel && <span className="tl-gutter-end">— {endLabel}</span>}
                  </div>

                  <div className="tl-node" style={{ borderColor: accent }}>
                    {event.icon
                      ? <span className="tl-node-icon">{event.icon}</span>
                      : <span className="tl-node-dot" style={{ background: accent }} />}
                  </div>

                  <div
                    className="tl-event-card"
                    onClick={() => onEdit(event)}
                  >
                    <div className="tl-card-header" style={{ background: headerBg }}>
                      <div className="tl-card-header-left">
                        {event.category && (
                          <span className="tl-card-cat" style={{ color: accent }}>
                            {event.category}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="tl-card-body">
                      <div className="tl-card-body-text">
                        <div className="tl-event-title">{event.title}</div>
                        {event.description && (
                          <div
                            className="tl-event-desc"
                            // Defence-in-depth: event descriptions are sanitized on import
                            // (db/backup.ts), but this is the one raw HTML render sink, so
                            // scrub again here in case content predates that pass. See #8.
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(event.description) }}
                          />
                        )}
                        {linkedPage && (
                          <button
                            className="ghost-btn tl-page-link"
                            onClick={(e) => { e.stopPropagation(); navigate(`/page/${linkedPage.id}`) }}
                          >
                            → {linkedPage.title}
                          </button>
                        )}
                      </div>
                      {thumbImage && (
                        <img src={thumbImage} alt="" className="tl-card-thumb" />
                      )}
                    </div>
                  </div>
                </div>
              )
```

Everything above the `return` (the `startLabel`/`endLabel`/`dateLabel`/`accent`/`headerBg`/`thumbImage` computations) stays, except `dateLabel` is now unused — delete the `const dateLabel = …` line. The date moved to the gutter and the icon to the spine node; both are gone from the card header.

- [ ] **Step 2: Restyle — spine, gutter, node**

In `src/index.css`, in the `/* --- TimelineVertical --- */` section:

Replace:

```css
.tl-era-events { display: flex; flex-direction: column; gap: 10px; padding-left: 0; }
```

with:

```css
.tl-era-events { display: flex; flex-direction: column; gap: 10px; padding-left: 0; position: relative; }
/* The spine: a continuous line behind the node column.
   left = gutter 96px + 12px column gap + node centre 11px − 1px (half the line). */
.tl-era-events::before {
  content: ''; position: absolute; top: 6px; bottom: 6px; left: 118px;
  width: 2px; background: var(--border);
}
.tl-row { display: grid; grid-template-columns: 96px 22px 1fr; gap: 0 12px; align-items: start; }
.tl-gutter { display: flex; flex-direction: column; gap: 2px; text-align: right; padding-top: 6px; }
.tl-gutter-date { font-family: var(--display); font-size: 12px; color: var(--ink-dim); }
.tl-gutter-end { font-size: 11px; color: var(--ink-faint); }
.tl-node {
  position: relative; z-index: 1; width: 22px; height: 22px; margin-top: 4px;
  border-radius: 50%; background: var(--bg); border: 2px solid var(--accent);
  display: flex; align-items: center; justify-content: center;
  font-size: 12px; line-height: 1;
}
.tl-node-dot { width: 8px; height: 8px; border-radius: 50%; }
@media (max-width: 640px) {
  .tl-row { grid-template-columns: 64px 22px 1fr; }
  .tl-era-events::before { left: 86px; }
  .tl-gutter-date { font-size: 11px; }
}
```

Delete the now-unused rule:

```css
.tl-card-date {
  font-size: 10px; color: var(--ink-dim); font-family: var(--sans);
  white-space: nowrap; flex-shrink: 0;
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build && npm run test:run`
Expected: clean (this component has no test file; the change is markup/CSS with unchanged data flow).

- [ ] **Step 4: Commit**

```bash
git add src/components/TimelineVertical.tsx src/index.css
git commit -m "feat: vertical timeline gets a real spine — date gutter, node per event"
```

---

### Task 6: Graph minimap — pure coordinate module

**Files:**
- Create: `src/graphMinimap.ts`
- Create: `src/graphMinimap.test.ts`

**Interfaces:**
- Produces (consumed by Task 7):
  - `nodeBounds(nodes: Array<{ x?: number; y?: number }>): Bounds | null` with `Bounds = { minX: number; minY: number; maxX: number; maxY: number }`
  - `fitMapping(bounds: Bounds, miniW: number, miniH: number, pad?: number): MiniMapping` with `MiniMapping = { scale: number; offsetX: number; offsetY: number }`
  - `toMini(m: MiniMapping, x: number, y: number): { x: number; y: number }`
  - `toGraph(m: MiniMapping, mx: number, my: number): { x: number; y: number }`
  - `viewportRect(m: MiniMapping, cam: { k: number; cx: number; cy: number }, viewW: number, viewH: number): { x: number; y: number; w: number; h: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/graphMinimap.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nodeBounds, fitMapping, toMini, toGraph, viewportRect } from './graphMinimap'

describe('graphMinimap', () => {
  it('nodeBounds spans positioned nodes and ignores unpositioned ones', () => {
    expect(nodeBounds([{ x: -10, y: 5 }, { x: 30, y: -20 }, {}])).toEqual({
      minX: -10, minY: -20, maxX: 30, maxY: 5,
    })
  })

  it('nodeBounds is null before the simulation has placed anything', () => {
    expect(nodeBounds([])).toBeNull()
    expect(nodeBounds([{}, {}])).toBeNull()
  })

  it('fitMapping fits the tight axis to the padded box and centres the loose one', () => {
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 50 }
    const m = fitMapping(b, 180, 130, 8)
    const tl = toMini(m, 0, 0)
    const br = toMini(m, 100, 50)
    expect(tl.x).toBeCloseTo(8)        // horizontal is tight: hits the padding
    expect(br.x).toBeCloseTo(172)
    expect((tl.y + br.y) / 2).toBeCloseTo(65) // vertical is loose: centred
  })

  it('toGraph inverts toMini', () => {
    const m = fitMapping({ minX: -50, minY: -50, maxX: 50, maxY: 50 }, 180, 130)
    const p = toMini(m, 12, -34)
    const g = toGraph(m, p.x, p.y)
    expect(g.x).toBeCloseTo(12)
    expect(g.y).toBeCloseTo(-34)
  })

  it('viewportRect is centred on the camera and shrinks as zoom grows', () => {
    const b = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const m = fitMapping(b, 100, 100, 0) // identity: scale 1, no offset
    const r = viewportRect(m, { k: 2, cx: 50, cy: 50 }, 100, 100)
    expect(r.x).toBeCloseTo(25)
    expect(r.y).toBeCloseTo(25)
    expect(r.w).toBeCloseTo(50)
    expect(r.h).toBeCloseTo(50)
  })

  it('degenerate bounds (single node) still produce a finite mapping', () => {
    const m = fitMapping({ minX: 5, minY: 5, maxX: 5, maxY: 5 }, 180, 130)
    const p = toMini(m, 5, 5)
    expect(Number.isFinite(p.x)).toBe(true)
    expect(Number.isFinite(p.y)).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/graphMinimap.test.ts`
Expected: FAIL — cannot resolve `./graphMinimap`.

- [ ] **Step 3: Implement**

Create `src/graphMinimap.ts`:

```ts
/** Pure coordinate math for the graph minimap: fit the simulation's node
 *  cloud into a small canvas, and project the main view's camera onto it.
 *  Kept React/canvas-free so it's trivially unit-testable. */

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** graph-space → minimap-px affine map: mini = graph * scale + offset. */
export interface MiniMapping {
  scale: number
  offsetX: number
  offsetY: number
}

/** Bounding box of all positioned nodes; null until the simulation has coords. */
export function nodeBounds(nodes: Array<{ x?: number; y?: number }>): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/** Fit `bounds` into a miniW×miniH canvas with `pad` px of breathing room,
 *  preserving aspect ratio and centring the loose axis. Degenerate bounds
 *  (single node) are clamped to a 1×1 span so the mapping stays finite. */
export function fitMapping(bounds: Bounds, miniW: number, miniH: number, pad = 8): MiniMapping {
  const w = Math.max(bounds.maxX - bounds.minX, 1)
  const h = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min((miniW - pad * 2) / w, (miniH - pad * 2) / h)
  const offsetX = pad + (miniW - pad * 2 - w * scale) / 2 - bounds.minX * scale
  const offsetY = pad + (miniH - pad * 2 - h * scale) / 2 - bounds.minY * scale
  return { scale, offsetX, offsetY }
}

export function toMini(m: MiniMapping, x: number, y: number): { x: number; y: number } {
  return { x: x * m.scale + m.offsetX, y: y * m.scale + m.offsetY }
}

export function toGraph(m: MiniMapping, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - m.offsetX) / m.scale, y: (my - m.offsetY) / m.scale }
}

/** The main viewport (viewW×viewH at zoom k, centred on cx,cy) in minimap px. */
export function viewportRect(
  m: MiniMapping,
  cam: { k: number; cx: number; cy: number },
  viewW: number,
  viewH: number,
): { x: number; y: number; w: number; h: number } {
  const gw = viewW / cam.k
  const gh = viewH / cam.k
  const tl = toMini(m, cam.cx - gw / 2, cam.cy - gh / 2)
  return { x: tl.x, y: tl.y, w: gw * m.scale, h: gh * m.scale }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/graphMinimap.test.ts`
Expected: 6 passing.

- [ ] **Step 5: Commit**

```bash
git add src/graphMinimap.ts src/graphMinimap.test.ts
git commit -m "feat: pure coordinate math for the graph minimap"
```

---

### Task 7: GraphMinimap component + GraphView integration

**Files:**
- Create: `src/components/GraphMinimap.tsx`
- Modify: `src/components/GraphView.tsx` (wrapper div + render the minimap)
- Modify: `src/index.css` (Relationship graph section, ~line 1049)

**Interfaces:**
- Consumes: everything Task 6 produced; `GraphNode`/`GraphLink` from `'../db'`; react-force-graph's `zoom()` / `centerAt()` getter-setters via the shared ref.
- Produces: `GraphMinimap` component, rendered only by `GraphView` (2D view; the lazy 3D view deliberately gets none).

- [ ] **Step 1: Write the component**

Create `src/components/GraphMinimap.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import type { GraphNode, GraphLink } from '../db'
import { nodeBounds, fitMapping, toMini, toGraph, viewportRect, type MiniMapping } from '../graphMinimap'

type GNode = NodeObject<GraphNode>
type GLink = LinkObject<GraphNode, GraphLink>

const W = 180
const H = 130

/** Always-on overview in the graph's corner: every node as a dot, plus a gold
 *  rectangle for the current viewport. Click / drag pans the main camera.
 *  Redraws on a rAF loop — node counts are wiki-scale, so a full repaint per
 *  frame is far cheaper than trying to diff simulation state. */
export default function GraphMinimap({
  nodes,
  fgRef,
  viewW,
  viewH,
}: {
  nodes: GNode[]
  /** The main view's force-graph ref (shared, not owned). */
  fgRef: { current: ForceGraphMethods<GNode, GLink> | undefined }
  viewW: number
  viewH: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Last mapping used to draw, so pointer events invert the same projection.
  const mappingRef = useRef<MiniMapping | null>(null)

  useEffect(() => {
    let raf = 0
    const dpr = window.devicePixelRatio || 1
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const fg = fgRef.current
      if (!canvas || !fg) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const bounds = nodeBounds(nodes)
      if (!bounds) return
      const m = fitMapping(bounds, W, H)
      mappingRef.current = m

      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        const p = toMini(m, n.x, n.y)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI)
        if (n.ghost) {
          ctx.strokeStyle = 'rgba(138, 130, 112, 0.7)'
          ctx.stroke()
        } else {
          ctx.fillStyle = 'rgba(233, 225, 210, 0.75)'
          ctx.fill()
        }
      }

      // Viewport rectangle from the live camera transform (zoom()/centerAt()
      // are getter-setters when called with no arguments).
      const k = fg.zoom()
      const c = fg.centerAt() as { x: number; y: number }
      const r = viewportRect(m, { k, cx: c.x, cy: c.y }, viewW, viewH)
      ctx.strokeStyle = 'rgba(201, 162, 75, 0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [nodes, fgRef, viewW, viewH])

  function panTo(e: React.MouseEvent<HTMLCanvasElement>) {
    const m = mappingRef.current
    const fg = fgRef.current
    if (!m || !fg) return
    const rect = e.currentTarget.getBoundingClientRect()
    const g = toGraph(m, e.clientX - rect.left, e.clientY - rect.top)
    fg.centerAt(g.x, g.y, 200)
  }

  return (
    <canvas
      ref={canvasRef}
      className="graph-minimap"
      width={W * (window.devicePixelRatio || 1)}
      height={H * (window.devicePixelRatio || 1)}
      style={{ width: W, height: H }}
      onMouseDown={panTo}
      onMouseMove={(e) => { if (e.buttons === 1) panTo(e) }}
    />
  )
}
```

- [ ] **Step 2: Render it from `GraphView`**

In `src/components/GraphView.tsx`:

Add the import:

```ts
import GraphMinimap from './GraphMinimap'
```

Change the wrapper div (line 216) from:

```tsx
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
```

to:

```tsx
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
```

And after the closing `/>` of `<ForceGraph2D …/>` (just before the final `</div>`), add:

```tsx
      {size.width > 0 && (
        <GraphMinimap
          nodes={data.nodes as GNode[]}
          fgRef={fgRef}
          viewW={size.width}
          viewH={size.height}
        />
      )}
```

(`GNode` is already defined at the top of `GraphView.tsx`; `fgRef` matches the `{ current: … | undefined }` structural type.)

- [ ] **Step 3: Style it**

In `src/index.css`, at the end of the `/* ---- Relationship graph ---- */` section, add:

```css
.graph-minimap {
  position: absolute; bottom: 14px; right: 14px; z-index: 10;
  background: rgba(29, 26, 20, 0.85); border: 1px solid var(--border);
  border-radius: 8px; box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build && npm run test:run`
Expected: clean. Then eyeball in the dev server (`npm run dev`, http://localhost:5174/#/graph): dots mirror the layout, the gold rect tracks pan/zoom, clicking the minimap pans the main view, dragging scrubs it.

- [ ] **Step 5: Commit**

```bash
git add src/components/GraphMinimap.tsx src/components/GraphView.tsx src/index.css
git commit -m "feat: graph minimap — overview dots + viewport rect, click to pan (closes #128)"
```

---

### Task 8: Final verification + PR

**Files:** none (verification + delivery only)

- [ ] **Step 1: Full gate**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all clean. Fix anything that isn't before proceeding.

- [ ] **Step 2: Walk the app once in the dev server**

Run `npm run dev`, open http://localhost:5174 and check each deliverable against the spec:
- `Ctrl+K` and `/` open search from Home; `/` typed inside the page editor inserts a slash instead.
- Empty search shows "Recently viewed"; searching a nonexistent name offers the create row; Enter creates + navigates.
- A category route and a tag route show the hero (accent bar, wash, glyph, "N pages").
- A page whose body starts with a paragraph shows the drop cap in view mode but not in edit mode; `h2`s show the gold underline.
- Timeline list view shows gutter dates, spine, and nodes; era dividers intact; mobile width (devtools) degrades gracefully.
- Graph shows the minimap; click/drag pans; viewport rect tracks.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/polish-sprint
gh pr create --title "Polish sprint: search shortcut, browse heroes, timeline spine, graph minimap" --label version:minor --body "$(cat <<'EOF'
## Summary
- Global search shortcut (Ctrl/Cmd+K, /) with a sidebar kbd hint; search modal shows recently-viewed pages when empty and offers create-from-search
- Browse/tag routes get category-identity hero headers (accent bar + colour wash + type glyph), mirroring the page header
- Article bodies (view mode) get drop caps and gold h2 underlines
- Vertical timeline gets a real spine: date gutter, node per event
- Relationship graph gets a minimap with a live viewport rect and click-to-pan — closes #128

Spec: docs/superpowers/specs/2026-07-03-polish-sprint-design.md

## Test plan
- New unit tests: searchShortcut predicate, SearchModal recents/create rows, graphMinimap coordinate math
- Updated: BrowseGrid tests for the new count copy + glyph
- `npm run lint && npm run build && npm run test:run` green; manual walkthrough of all five surfaces in the dev server

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR opens against `main` with the `version:minor` label.
