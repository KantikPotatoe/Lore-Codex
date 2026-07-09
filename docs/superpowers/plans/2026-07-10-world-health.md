# World Health Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/health` route and a Home summary panel that surface a world's broken links, orphan pages, and stub pages in one place.

**Architecture:** A pure function `computeWorldHealth(pages)` in `src/db/worldHealth.ts` does one pass over every page's links (via the existing `linkedTitles` primitive) and returns three lists. `HealthRoute` renders them; a one-line Home panel shows the counts and links to the route. No new storage, no schema change, no backup change.

**Tech Stack:** TypeScript (strict), React 19, Dexie + `useLiveQuery`, react-router-dom (hash routing), Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-07-10-world-health-design.md`

## Global Constraints

- Branch is `feat/179-world-health` (already created; the spec is already committed to it).
- TypeScript `strict`. Before claiming done, all three of `npm run lint`, `npm run build`, `npm run test:run` must pass.
- Any new public data-layer symbol MUST be re-exported from `src/db/index.ts` (it already does `export * from './worldHealth'` after Task 2) AND added to `EXPECTED_FUNCTIONS` in `src/db/barrel.test.ts`, or `barrel.test.ts` fails.
- **No host `alert()` / `confirm()`.** User-facing notices use the `ConfirmDialog` component with `hideCancel`. The desktop shell's webview renders host dialogs unreliably.
- Only `src/platform.ts` may import from `@tauri-apps/*` or trigger an `<a download>`. Nothing in this plan should touch either.
- Definitions, fixed by the spec and not to be reinterpreted:
  - **Broken link** = a distinct page title that is linked to but does not exist. Counted **by missing title**, not by occurrence.
  - **Orphan** = a page with **no incoming links** (nothing links *to* it), even if it links outward.
  - **Stub** = `pageStatus(page) === 'Stub'`. `pageStatus()` defaults to `'Draft'`, so a page with no status set is NOT a stub.
  - Self-links count as neither an incoming link nor a broken link.
- The PR closes #179 and carries the `version:minor` label.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/db/pages.ts` | Modify | Add `linkedTitlesRaw` (author's casing); reimplement `linkedTitles` on top of it; widen the memo to cache both views. |
| `src/db/barrel.test.ts` | Modify | Pin `linkedTitlesRaw` and `computeWorldHealth` on the public surface. |
| `src/db/pages.test.ts` | Modify | Pin the casing-preservation contract of `linkedTitlesRaw`. |
| `src/db/worldHealth.ts` | Create | Pure `computeWorldHealth(pages) → WorldHealth`. |
| `src/db/worldHealth.test.ts` | Create | Unit tests for the core. |
| `src/db/index.ts` | Modify | `export * from './worldHealth'`. |
| `src/routes/HealthRoute.tsx` | Create | The `/health` view: three sections + Create action. |
| `src/App.tsx` | Modify | Register the `/health` route. |
| `src/components/Sidebar.tsx` | Modify | "Health" nav entry after Graph. |
| `src/routes/HomeRoute.tsx` | Modify | `showHealth` config flag + summary panel. |
| `src/components/HubsOrphansPanel.tsx` | Modify | Rename "Orphans" → "Isolated". |
| `src/routes/GraphRoute.tsx` | Modify | Rename the `orphans` local + toggle-button label. |
| `src/index.css` | Modify | `.health-*` styles. |

---

### Task 1: `linkedTitlesRaw` — preserve the author's casing

`linkedTitles()` lowercases as it extracts, so a link written `[[the Shire]]` comes back as `the shire`. The health dashboard's Create button needs the original text. Split the extraction out, keep `linkedTitles()` as a lowercased view over it, and widen the existing memo so both views share one cache entry.

**Files:**
- Modify: `src/db/pages.ts:217-260`
- Modify: `src/db/barrel.test.ts` (the `pages.ts` group in `EXPECTED_FUNCTIONS`)
- Test: `src/db/pages.test.ts`

**Interfaces:**
- Consumes: `wikiLinkTitles(html)` from `src/html.ts` (already imported by `pages.ts`); it trims and drops empty titles.
- Produces:
  - `linkedTitlesRaw(page: LorePage): string[]` — linked titles in the author's casing, deduped by lowercased title, first occurrence wins.
  - `linkedTitlesRawCached(page: LorePage): string[]` — the same, memoized by `(id, updatedAt)`.
  - `linkedTitles(page: LorePage): Set<string>` — unchanged behavior, now derived.
  - `linkedTitlesCached(page: LorePage): Set<string>` — unchanged behavior.
  - `clearLinkedTitlesCache(): void` — unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `src/db/pages.test.ts`. If the file has no `linkedTitlesRaw` import yet, add it to the existing import from `'./pages'`.

```ts
describe('linkedTitlesRaw', () => {
  function page(over: Partial<LorePage>): LorePage {
    return {
      id: 'p', title: 'P', titleLc: 'p', category: 'Concept', content: '',
      summary: '', status: 'Draft', tags: [], createdAt: 0, updatedAt: 0, ...over,
    }
  }
  const link = (t: string) => `<p><a data-wikilink data-title="${t}">${t}</a></p>`

  it('preserves the casing the author typed', () => {
    expect(linkedTitlesRaw(page({ content: link('the Shire') }))).toEqual(['the Shire'])
  })

  it('reads infobox [[refs]] as well as body links', () => {
    const p = page({
      content: link('Frodo'),
      infobox: {
        template: 'Character', image: null, caption: '',
        fields: [{ id: 'f1', label: 'Home', value: '[[the Shire]]', fieldType: 'ref' }],
      },
    })
    expect(linkedTitlesRaw(p)).toEqual(['Frodo', 'the Shire'])
  })

  it('dedupes by lowercased title, first occurrence winning the casing', () => {
    const p = page({ content: link('Mordor') + link('mordor') })
    expect(linkedTitlesRaw(p)).toEqual(['Mordor'])
  })

  it('trims surrounding whitespace in infobox refs', () => {
    const p = page({
      infobox: {
        template: 'Character', image: null, caption: '',
        fields: [{ id: 'f1', label: 'Home', value: '[[  Mordor  ]]', fieldType: 'ref' }],
      },
    })
    expect(linkedTitlesRaw(p)).toEqual(['Mordor'])
  })

  it('still lowercases through linkedTitles', () => {
    const p = page({ content: link('the Shire') })
    expect([...linkedTitles(p)]).toEqual(['the shire'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/pages.test.ts`
Expected: FAIL — `linkedTitlesRaw is not a function` (or a TS resolution error on the import).

- [ ] **Step 3: Implement `linkedTitlesRaw` and rebase `linkedTitles` on it**

In `src/db/pages.ts`, replace the body of `linkedTitles` (currently lines 219-235) with:

```ts
/** Every page title a page links to, in the casing the author typed, gathered
 *  from its rich-text body and its infobox field values. Deduped by lowercased
 *  title — the first occurrence wins the casing. The health dashboard creates
 *  missing pages from these strings, so the original text matters. */
export function linkedTitlesRaw(page: LorePage): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const add = (raw: string) => {
    const t = raw.trim()
    if (!t) return
    const key = t.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }
  // Body: editor wiki links render as <a data-wikilink data-title="...">.
  for (const t of wikiLinkTitles(page.content)) add(t)
  // Infobox field values keep the raw [[Name]] syntax.
  if (page.infobox) {
    for (const field of page.infobox.fields) {
      for (const m of field.value.matchAll(WIKILINK_RE)) add(m[1])
    }
  }
  return out
}

/** Every page title (lowercased) that a page links to. */
export function linkedTitles(page: LorePage): Set<string> {
  return new Set(linkedTitlesRaw(page).map((t) => t.toLowerCase()))
}
```

- [ ] **Step 4: Widen the memo to cache both views**

Still in `src/db/pages.ts`, replace the cache block (currently lines 242-260) with:

```ts
interface LinkCacheEntry {
  updatedAt: number
  raw: string[]
  titles: Set<string>
}
const linkedTitlesCache = new Map<string, LinkCacheEntry>()

function linkCacheEntry(page: LorePage): LinkCacheEntry {
  const prev = linkedTitlesCache.get(page.id)
  if (prev && prev.updatedAt === page.updatedAt) return prev
  const raw = linkedTitlesRaw(page)
  const entry: LinkCacheEntry = {
    updatedAt: page.updatedAt,
    raw,
    titles: new Set(raw.map((t) => t.toLowerCase())),
  }
  linkedTitlesCache.set(page.id, entry)
  return entry
}

/** linkedTitles(page), memoized by (id, updatedAt). */
export function linkedTitlesCached(page: LorePage): Set<string> {
  return linkCacheEntry(page).titles
}

/** linkedTitlesRaw(page), memoized by (id, updatedAt). */
export function linkedTitlesRawCached(page: LorePage): string[] {
  return linkCacheEntry(page).raw
}

/** Drop the memoized linked-titles cache (tests; harmless to call otherwise). */
export function clearLinkedTitlesCache(): void {
  linkedTitlesCache.clear()
}
```

Leave the comment block above `LinkCacheEntry` (lines 237-241) in place — it still describes why the memo exists. Leave `getBacklinks` untouched: it prunes `linkedTitlesCache` by key and calls `linkedTitlesCached`, both of which still work.

- [ ] **Step 5: Add `linkedTitlesRaw` to the barrel test**

In `src/db/barrel.test.ts`, in the `// pages.ts` group of `EXPECTED_FUNCTIONS`, change:

```ts
  'linkedTitles', 'getBacklinks',
```

to:

```ts
  'linkedTitles', 'linkedTitlesRaw', 'getBacklinks',
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/db/pages.test.ts src/db/barrel.test.ts src/db/graph.test.ts`
Expected: PASS. `graph.test.ts` is included because `buildGraphData` consumes `linkedTitles` — it pins that the refactor is behavior-preserving.

- [ ] **Step 7: Commit**

```bash
git add src/db/pages.ts src/db/pages.test.ts src/db/barrel.test.ts
git commit -m "refactor: linkedTitlesRaw preserves author casing (#179)"
```

---

### Task 2: `computeWorldHealth` — the pure core

**Files:**
- Create: `src/db/worldHealth.ts`
- Create: `src/db/worldHealth.test.ts`
- Modify: `src/db/index.ts`
- Modify: `src/db/barrel.test.ts`

**Interfaces:**
- Consumes: `linkedTitlesRawCached(page): string[]` from `./pages` (Task 1); `pageStatus(page): string` from `./schema`; `LorePage` from `./types`.
- Produces:
  - `interface BrokenLink { title: string; sources: LorePage[] }`
  - `interface WorldHealth { brokenLinks: BrokenLink[]; orphans: LorePage[]; stubs: LorePage[] }`
  - `computeWorldHealth(pages: LorePage[]): WorldHealth`

- [ ] **Step 1: Write the failing tests**

Create `src/db/worldHealth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { computeWorldHealth } from './worldHealth'
import { clearLinkedTitlesCache } from './pages'
import type { LorePage } from './types'

function page(over: Partial<LorePage>): LorePage {
  return {
    id: 'p', title: 'P', titleLc: 'p', category: 'Concept', content: '',
    summary: '', status: 'Draft', tags: [], createdAt: 0, updatedAt: 0, ...over,
  }
}
const link = (t: string) => `<p><a data-wikilink data-title="${t}">${t}</a></p>`
const titles = (ps: LorePage[]) => ps.map((p) => p.title)

// computeWorldHealth reads through the (id, updatedAt) memo, so pages sharing an
// id across tests would otherwise serve each other's cached links.
beforeEach(clearLinkedTitlesCache)

describe('computeWorldHealth — broken links', () => {
  it('groups references to one missing title into a single row', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('Mordor') }),
      page({ id: 'b', title: 'B', content: link('Mordor') }),
      page({ id: 'c', title: 'C', content: link('Mordor') }),
    ]
    const { brokenLinks } = computeWorldHealth(pages)
    expect(brokenLinks).toHaveLength(1)
    expect(brokenLinks[0].title).toBe('Mordor')
    expect(titles(brokenLinks[0].sources)).toEqual(['A', 'B', 'C'])
  })

  it('orders most-referenced first, then by title', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('Rare') }),
      page({ id: 'b', title: 'B', content: link('Common') }),
      page({ id: 'c', title: 'C', content: link('Common') }),
    ]
    expect(computeWorldHealth(pages).brokenLinks.map((b) => b.title)).toEqual(['Common', 'Rare'])
  })

  it('gives the first occurrence the display casing', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('the Shire') }),
      page({ id: 'b', title: 'B', content: link('The Shire') }),
    ]
    const { brokenLinks } = computeWorldHealth(pages)
    expect(brokenLinks).toHaveLength(1)
    expect(brokenLinks[0].title).toBe('the Shire')
  })

  it('resolves links case- and whitespace-insensitively', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link(' mordor ') }),
      page({ id: 'b', title: 'Mordor' }),
    ]
    expect(computeWorldHealth(pages).brokenLinks).toEqual([])
  })

  it('does not count a self-link as broken', () => {
    const pages = [page({ id: 'a', title: 'A', content: link('A') })]
    expect(computeWorldHealth(pages).brokenLinks).toEqual([])
  })

  it('counts a broken infobox ref', () => {
    const pages = [page({
      id: 'a', title: 'A',
      infobox: {
        template: 'Character', image: null, caption: '',
        fields: [{ id: 'f1', label: 'Home', value: '[[Mordor]]', fieldType: 'ref' }],
      },
    })]
    expect(computeWorldHealth(pages).brokenLinks.map((b) => b.title)).toEqual(['Mordor'])
  })
})

describe('computeWorldHealth — orphans', () => {
  it('flags a page nothing links to, even when it links outward', () => {
    const pages = [
      page({ id: 'a', title: 'A', content: link('B') }),
      page({ id: 'b', title: 'B' }),
    ]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('does not let a self-link rescue a page', () => {
    const pages = [page({ id: 'a', title: 'A', content: link('A') })]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('lets an infobox ref rescue a page', () => {
    const pages = [
      page({
        id: 'a', title: 'A',
        infobox: {
          template: 'Character', image: null, caption: '',
          fields: [{ id: 'f1', label: 'Home', value: '[[B]]', fieldType: 'ref' }],
        },
      }),
      page({ id: 'b', title: 'B' }),
    ]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['A'])
  })

  it('sorts orphans by title', () => {
    const pages = [page({ id: 'b', title: 'Beta' }), page({ id: 'a', title: 'Alpha' })]
    expect(titles(computeWorldHealth(pages).orphans)).toEqual(['Alpha', 'Beta'])
  })
})

describe('computeWorldHealth — stubs', () => {
  it('collects pages whose status is Stub', () => {
    const pages = [
      page({ id: 'a', title: 'A', status: 'Stub' }),
      page({ id: 'b', title: 'B', status: 'Complete' }),
    ]
    expect(titles(computeWorldHealth(pages).stubs)).toEqual(['A'])
  })

  it('does not treat a page with no status as a stub (pageStatus defaults to Draft)', () => {
    const pages = [page({ id: 'a', title: 'A', status: undefined })]
    expect(computeWorldHealth(pages).stubs).toEqual([])
  })
})

describe('computeWorldHealth — empty world', () => {
  it('returns three empty lists', () => {
    expect(computeWorldHealth([])).toEqual({ brokenLinks: [], orphans: [], stubs: [] })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/db/worldHealth.test.ts`
Expected: FAIL — cannot resolve `./worldHealth`.

- [ ] **Step 3: Implement the core**

Create `src/db/worldHealth.ts`:

```ts
import { linkedTitlesRawCached } from './pages'
import { pageStatus } from './schema'
import type { LorePage } from './types'

// ---------------------------------------------------------------------------
// World health — the worldbuilder's to-do list: what's dangling, unreachable,
// or unwritten. A pure function over the page list, like buildGraphData.
// ---------------------------------------------------------------------------

/** A page title that is linked to but does not exist, plus every page that
 *  references it. Counted by title, not by occurrence: creating the page once
 *  clears all of `sources` at a stroke. `title` keeps the casing the author
 *  typed, because that is what the Create action names the new page. */
export interface BrokenLink {
  title: string
  sources: LorePage[]
}

export interface WorldHealth {
  /** Most-referenced first, ties broken by title. */
  brokenLinks: BrokenLink[]
  /** Pages nothing links to, by title. Linking outward does not save a page. */
  orphans: LorePage[]
  /** Pages still marked Stub, by title. */
  stubs: LorePage[]
}

/** Analyse a world's pages for broken links, orphans, and stubs.
 *
 *  Self-links count as neither an incoming link nor a broken link, matching
 *  `buildGraphData` — so a page whose only inbound reference is itself is
 *  correctly an orphan. Title resolution is case- and whitespace-insensitive;
 *  display and page creation use the author's original casing. */
export function computeWorldHealth(pages: LorePage[]): WorldHealth {
  const idByTitle = new Map<string, string>()
  for (const p of pages) idByTitle.set(p.title.trim().toLowerCase(), p.id)

  const hasIncoming = new Set<string>()
  const brokenByKey = new Map<string, BrokenLink>()

  for (const page of pages) {
    // Already trimmed and deduped by lowercased title, first casing winning.
    for (const raw of linkedTitlesRawCached(page)) {
      const key = raw.toLowerCase()
      const targetId = idByTitle.get(key)
      if (targetId === page.id) continue // self-link
      if (targetId) {
        hasIncoming.add(targetId)
        continue
      }
      const existing = brokenByKey.get(key)
      if (existing) existing.sources.push(page)
      else brokenByKey.set(key, { title: raw, sources: [page] })
    }
  }

  const byTitle = (a: LorePage, b: LorePage) => a.title.localeCompare(b.title)

  return {
    brokenLinks: [...brokenByKey.values()]
      .map((b) => ({ ...b, sources: [...b.sources].sort(byTitle) }))
      .sort((a, b) => b.sources.length - a.sources.length || a.title.localeCompare(b.title)),
    orphans: pages.filter((p) => !hasIncoming.has(p.id)).sort(byTitle),
    stubs: pages.filter((p) => pageStatus(p) === 'Stub').sort(byTitle),
  }
}
```

- [ ] **Step 4: Re-export from the barrel and pin it**

In `src/db/index.ts`, after the `export * from './graph'` line, add:

```ts
export * from './worldHealth'
```

In `src/db/barrel.test.ts`, find the `// graph.ts` group (`'buildGraphData', ...`) and add a new group immediately after it:

```ts
  // worldHealth.ts
  'computeWorldHealth',
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/db/worldHealth.test.ts src/db/barrel.test.ts`
Expected: PASS — 13 tests in `worldHealth.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/db/worldHealth.ts src/db/worldHealth.test.ts src/db/index.ts src/db/barrel.test.ts
git commit -m "feat: pure world-health core — broken links, orphans, stubs (#179)"
```

---

### Task 3: The `/health` route

**Files:**
- Create: `src/routes/HealthRoute.tsx`
- Modify: `src/App.tsx:110` (route table)
- Modify: `src/components/Sidebar.tsx:107` (nav entries)
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `computeWorldHealth`, `BrokenLink`, `WorldHealth` (Task 2); `pageRepo.list()`, `createPage(partial)`, `categoryColor(category)` from `'../db'`; `ConfirmDialog` from `'../components/ConfirmDialog'`.
- Produces: default-exported `HealthRoute` component, mounted at `/health`.

- [ ] **Step 1: Create the route component**

Create `src/routes/HealthRoute.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, createPage, categoryColor, computeWorldHealth, type LorePage } from '../db'
import ConfirmDialog from '../components/ConfirmDialog'

/** Stable empty array so the live query doesn't feed `useMemo` a fresh `[]`
 *  (forcing a recompute) on every render while pages are still loading. */
const NO_PAGES: LorePage[] = []

function PageList({ pages, empty }: { pages: LorePage[]; empty: string }) {
  if (pages.length === 0) return <p className="muted">{empty}</p>
  return (
    <ul className="health-list">
      {pages.map((p) => (
        <li key={p.id}>
          <Link to={`/page/${p.id}`}>
            <span className="dot" style={{ background: categoryColor(p.category) }} />
            <span className="t">{p.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function HealthRoute() {
  const navigate = useNavigate()
  // In-app acknowledgement — host alert() is unreliable in the shell's webview.
  const [notice, setNotice] = useState<string | null>(null)

  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES
  const health = useMemo(() => computeWorldHealth(pages), [pages])

  // Another tab may have created the page since the live query last fired, in
  // which case createPage throws on the title clash. The live query then drops
  // the row on its own; we only have to explain what happened.
  async function handleCreate(title: string) {
    try {
      const id = await createPage({ title })
      navigate(`/page/${id}`)
    } catch {
      setNotice(`A page called “${title}” already exists.`)
    }
  }

  return (
    <div className="health">
      <header className="health-header">
        <h1>World health</h1>
        <p className="health-sub">What's dangling, unreachable, or still unwritten.</p>
      </header>

      <section className="health-section">
        <h2>Broken links <span className="count">{health.brokenLinks.length}</span></h2>
        <p className="health-section-sub">Pages you've linked to but never wrote.</p>
        {health.brokenLinks.length === 0 ? (
          <p className="muted">Every link lands somewhere. 🎉</p>
        ) : (
          <ul className="health-list">
            {health.brokenLinks.map((b) => (
              <li key={b.title.toLowerCase()} className="health-broken">
                <span className="t">{b.title}</span>
                <span className="health-sources">
                  linked from{' '}
                  {b.sources.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <Link to={`/page/${p.id}`}>{p.title}</Link>
                    </span>
                  ))}
                </span>
                <button className="ghost-btn" onClick={() => handleCreate(b.title)}>
                  + Create
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="health-section">
        <h2>Orphans <span className="count">{health.orphans.length}</span></h2>
        <p className="health-section-sub">Nothing links to these — you can't reach them by browsing.</p>
        <PageList pages={health.orphans} empty="Every page is linked to. 🎉" />
      </section>

      <section className="health-section">
        <h2>Stubs <span className="count">{health.stubs.length}</span></h2>
        <p className="health-section-sub">Pages still marked Stub.</p>
        <PageList pages={health.stubs} empty="No stubs left. 🎉" />
      </section>

      <ConfirmDialog
        open={notice !== null}
        hideCancel
        title="Couldn't create that page"
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      >
        <p>{notice}</p>
      </ConfirmDialog>
    </div>
  )
}
```

- [ ] **Step 2: Register the route**

In `src/App.tsx`, add the import next to the other non-lazy route imports (the ones NOT wrapped in `lazy(...)` — `MapRoute`, `GraphRoute`, and `BookRoute` are lazy; `HealthRoute` is not, because it pulls in no heavy dependencies):

```tsx
import HealthRoute from './routes/HealthRoute'
```

Then add the route after the `/graph` line (`App.tsx:104`):

```tsx
              <Route path="/health" element={<HealthRoute />} />
```

- [ ] **Step 3: Add the sidebar entry**

In `src/components/Sidebar.tsx`, after the Graph link (line 107), add:

```tsx
        <Link to="/health" className={location.pathname.startsWith('/health') ? 'nav-item active' : 'nav-item'}>Health</Link>
```

- [ ] **Step 4: Add the styles**

Append to `src/index.css`:

```css
/* --- World health -------------------------------------------------------- */
.health { max-width: 60rem; margin: 0 auto; }
.health-header { margin-bottom: 2rem; }
.health-sub { color: var(--ink-dim); margin-top: 0.25rem; }

.health-section { margin-bottom: 2.5rem; }
.health-section h2 { display: flex; align-items: baseline; gap: 0.5rem; }
.health-section h2 .count {
  font-size: 0.8rem; font-weight: 500; color: var(--ink-dim);
  background: var(--panel-2); border-radius: 999px; padding: 0.1rem 0.5rem;
}
.health-section-sub { color: var(--ink-faint); font-size: 0.9rem; margin: 0.25rem 0 0.75rem; }

.health-list { list-style: none; padding: 0; margin: 0; }
.health-list > li {
  display: flex; align-items: center; gap: 0.6rem;
  padding: 0.5rem 0; border-bottom: 1px solid var(--border);
}
.health-list > li:last-child { border-bottom: none; }
.health-list .dot { width: 0.6rem; height: 0.6rem; border-radius: 50%; flex: none; }
.health-list .t { font-weight: 500; }
.health-list a { display: inline-flex; align-items: center; gap: 0.6rem; }

.health-broken .health-sources {
  flex: 1; color: var(--ink-faint); font-size: 0.85rem;
}
.health-broken .ghost-btn { flex: none; }
```

These are the custom properties `index.css` actually defines (`--ink-dim`, `--ink-faint`, `--panel-2`, `--border`, all declared at the top of the file). Do not introduce new ones. `.muted` used elsewhere in this plan is an existing utility *class*, not a variable.

- [ ] **Step 5: Verify it builds and lints**

Run: `npm run lint && npm run build`
Expected: both exit 0, no new warnings.

- [ ] **Step 6: Verify in the app**

Run: `npm run dev`, open `http://localhost:5174/#/health`.
Expected: three sections render. Create a page linking to `[[Nowhere]]`, return to `/health`, confirm "Nowhere" appears under Broken links with your page listed as its source, and that "+ Create" makes a page titled exactly `Nowhere` and navigates to it.

- [ ] **Step 7: Commit**

```bash
git add src/routes/HealthRoute.tsx src/App.tsx src/components/Sidebar.tsx src/index.css
git commit -m "feat: /health route — broken links, orphans, stubs (#179)"
```

---

### Task 4: The Home summary panel

**Files:**
- Modify: `src/routes/HomeRoute.tsx` (`HomeConfig`, `DEFAULT_HOME`, the Customize block, a new section)
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `computeWorldHealth` (Task 2); the `/health` route (Task 3); the existing `pages` live query at `HomeRoute.tsx:78`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Extend the config type and defaults**

In `src/routes/HomeRoute.tsx`, add `showHealth` to `HomeConfig` (after `showOnThisDay`, line 34):

```ts
  showOnThisDay: boolean
  showHealth: boolean
```

and to `DEFAULT_HOME` (after line 50):

```ts
  showOnThisDay: true,
  showHealth: true,
```

Old saved configs lack the key, but `cfg` is built as `{ ...DEFAULT_HOME, ...savedConfig }` (line 76), so existing worlds get `true` for free.

- [ ] **Step 2: Compute the health figures**

Add `computeWorldHealth` to the existing `'../db'` import, then after the `dusty` memo (line 81) add:

```ts
  const health = useMemo(() => computeWorldHealth(pages), [pages])
  const healthTotal = health.brokenLinks.length + health.orphans.length + health.stubs.length
```

- [ ] **Step 3: Add the Customize toggle**

After the `showOnThisDay` toggle (lines 219-222), add:

```tsx
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showHealth} onChange={(e) => saveConfig({ showHealth: e.target.checked })} />
              World health
            </label>
```

- [ ] **Step 4: Add the panel**

After the "On this day" section (which ends at line 369), before the `<ConfirmDialog>`, add:

```tsx
      {/* World health — suppressed on an empty world; a fresh page shouldn't be
          greeted with a health report on nothing. Shows an all-clear line rather
          than vanishing when everything is fine: a panel that silently disappears
          is indistinguishable from one you turned off by accident. */}
      {cfg.showHealth && total > 0 && (
        <section className="home-section">
          <h2>World health</h2>
          <Link className="health-summary" to="/health">
            {healthTotal === 0 ? (
              <span className="health-clean">Nothing dangling. Your world is in good shape. 🎉</span>
            ) : (
              <>
                <span>{plural(health.brokenLinks.length, 'broken link')}</span>
                <span className="sep">·</span>
                <span>{plural(health.orphans.length, 'orphan')}</span>
                <span className="sep">·</span>
                <span>{plural(health.stubs.length, 'stub')}</span>
              </>
            )}
          </Link>
        </section>
      )}
```

and define `plural` at module scope, next to `DEFAULT_HOME`:

```ts
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
```

- [ ] **Step 5: Add the styles**

Append to `src/index.css`:

```css
.health-summary {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 0.6rem 0.9rem; border: 1px solid var(--border); border-radius: var(--radius);
}
.health-summary .sep { color: var(--ink-faint); }
.health-summary .health-clean { color: var(--ink-dim); }
```

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three exit 0.

Then `npm run dev`, open `/#/home`. Expected: the panel shows counts and links to `/health`; toggling "World health" off under Customize hides it and the choice survives a reload; a world with no pages shows no panel.

- [ ] **Step 7: Commit**

```bash
git add src/routes/HomeRoute.tsx src/index.css
git commit -m "feat: world-health summary panel on Home (#179)"
```

---

### Task 5: Rename the graph's "Orphans" to "Isolated"

The graph calls `degree === 0` nodes orphans. Under the dashboard's definition those are *isolated* — no links in **or** out. Both concepts are right for their surface; sharing a word makes the differing counts read as a bug. Rename in the graph; no logic changes.

**Files:**
- Modify: `src/components/HubsOrphansPanel.tsx`
- Modify: `src/routes/GraphRoute.tsx:124-126,354,396`

**Interfaces:**
- Consumes: nothing new.
- Produces: `HubsOrphansPanel`'s prop `orphans` is renamed to `isolated`. No other component uses it.

- [ ] **Step 1: Rename the prop and heading**

In `src/components/HubsOrphansPanel.tsx`, change the props destructure and type from `orphans` to `isolated`:

```tsx
export default function HubsOrphansPanel({
  hubs,
  isolated,
  onSelect,
}: {
  hubs: GraphNode[]
  isolated: GraphNode[]
  onSelect: (id: string) => void
}) {
```

Then change the second `<section>`'s heading and both `orphans` references in its body:

```tsx
      <section>
        <h3>Isolated <span className="count">{isolated.length}</span></h3>
        {isolated.length === 0 ? (
          <p className="muted">Every page is connected. 🎉</p>
        ) : (
          <ul>
            {isolated.map((n) => (
```

- [ ] **Step 2: Rename at the call site**

In `src/routes/GraphRoute.tsx`, rename the memo (lines 124-127):

```tsx
  const isolated = useMemo(
    () => filtered.nodes.filter((n) => n.degree === 0).sort((a, b) => a.title.localeCompare(b.title)),
    [filtered],
  )
```

Change the toggle-button label (line 354) from `'☰ Hubs & orphans'` to `'☰ Hubs & isolated'`, and the panel usage (line 396):

```tsx
          <HubsOrphansPanel hubs={hubs} isolated={isolated} onSelect={selectNode} />
```

- [ ] **Step 3: Verify nothing else referenced it**

Run: `grep -rn "orphans" src/ --include=*.tsx --include=*.ts`
Expected: hits only in `src/db/worldHealth.ts`, `src/db/worldHealth.test.ts`, `src/routes/HealthRoute.tsx`, and `src/routes/HomeRoute.tsx` — the dashboard's own, correct use of the word.

- [ ] **Step 4: Verify it builds**

Run: `npm run lint && npm run build`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/HubsOrphansPanel.tsx src/routes/GraphRoute.tsx
git commit -m "refactor: graph panel says Isolated, not Orphans (#179)"
```

---

### Task 6: Full verification and PR

- [ ] **Step 1: Run the full gate**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three exit 0. Do not proceed on a failure; fix it.

- [ ] **Step 2: Exercise the feature end-to-end**

Run `npm run dev` and confirm, in a world with pages:
- A page linking to a non-existent title appears under Broken links, listing that page as a source.
- "+ Create" creates a page with the *exact* casing shown, and navigates to it.
- After creating it, the broken-link row disappears without a reload (the live query fires).
- A page nothing links to appears under Orphans; adding a link to it from another page removes it.
- The Home panel counts match the route's, and links to it.
- `/graph`'s panel now says "Isolated".

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin feat/179-world-health
gh pr create --label version:minor \
  --title "feat: world health dashboard — broken links, orphans, stubs (#179)" \
  --body "$(cat <<'EOF'
Closes #179.

One place to see what needs work in a world: a `/health` route listing broken
links, orphan pages, and stubs, plus a one-line summary panel on Home.

- `computeWorldHealth(pages)` — a pure analysis beside `buildGraphData`.
- Broken links are counted **by missing title**, not occurrence, and each row can
  create the missing page with the casing the author typed. That needed
  `linkedTitlesRaw`, which `linkedTitles` is now a lowercased view over.
- Orphan means **no incoming links** here. The graph's `degree === 0` rule is a
  different concept, so its panel is renamed "Isolated" — no logic change.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage.** Definitions → Global Constraints. Pure core → Task 2. `linkedTitlesRaw` split and the widened memo → Task 1. `/health` route, sidebar entry, three sections, Create action → Task 3. Home panel, `showHealth`, all-clear line, empty-world suppression → Task 4. Graph rename → Task 5. Error handling (`ConfirmDialog` on title clash) → Task 3, Step 1. Every test case listed in the spec appears in Task 2, Step 1. Out-of-scope items (status-filtered browse, bulk create, inline status edit) appear in no task. No gaps.

**Type consistency.** `BrokenLink { title, sources }` and `WorldHealth { brokenLinks, orphans, stubs }` are defined in Task 2 and used with those exact names in Tasks 3 and 4. `linkedTitlesRaw` / `linkedTitlesRawCached` are produced in Task 1 and consumed in Task 2. `HubsOrphansPanel`'s `isolated` prop is renamed in Task 5, Step 1 and updated at its only call site in Step 2.

**CSS.** The custom properties used (`--ink-dim`, `--ink-faint`, `--panel-2`, `--border`, `--radius`) were checked against the declarations at the top of `src/index.css`. No new ones are introduced.
