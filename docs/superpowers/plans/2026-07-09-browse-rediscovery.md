# Browse & rediscovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three low-cost "rediscovery" affordances — a sidebar Random-page button, a Home "Dusty corners" panel, and a Home "On this day" featured-event panel.

**Architecture:** All randomness/time logic lives in one pure, unit-tested module `src/rediscovery.ts` (keeping `Math.random()`/`Date.now()` out of component render, per the repo's `react-hooks/purity` lint rule). Two components consume it: `Sidebar.tsx` (random page) and `HomeRoute.tsx` (both panels). Reads go through existing `db`/`pageRepo` live queries. No schema change, no new dependency.

**Tech Stack:** React 18, TypeScript (strict), Dexie + dexie-react-hooks (`useLiveQuery`), react-router-dom (hash routing), Vitest + happy-dom + fake-indexeddb, @testing-library/react.

## Global Constraints

- TypeScript `strict` — no `any` leaks; type all params/returns.
- **No literal `Date.now()` / `Math.random()` in component render** — they live in `src/rediscovery.ts` (helper-module pattern). Components call the helpers with no time/rng argument.
- Import app modules directly (`../rediscovery`, `../calendar`, `../html`); import data-layer types/values from the `../db` barrel. `formatDate` comes from `../calendar` (pure), `stripHtml` from `../html`.
- Follow existing card markup (`.lore-card`, `.card-badges`, `.card-badge`) and button classes (`.ghost-btn`, `.primary-btn`) — do not invent new visual systems.
- Run `npm run lint`, `npm run test:run`, and `npm run build` before claiming done (CI runs all three).
- Commit after each task. PR gets a `version:minor` label (new feature).

---

### Task 1: Pure core — `src/rediscovery.ts`

**Files:**
- Create: `src/rediscovery.ts`
- Test: `src/rediscovery.test.ts`

**Interfaces:**
- Consumes: `LorePage`, `TimelineEvent` types from `./db`.
- Produces:
  - `pickRandomId(ids: string[], rng?: () => number): string | null`
  - `todayIndex(nowMs?: number): number`
  - `selectStalePages(pages: LorePage[], nowMs?: number, opts?: { thresholdDays?: number; limit?: number }): LorePage[]`
  - `pickFeaturedEvent(events: TimelineEvent[], dayIndex: number): TimelineEvent | null`
  - `staleLabel(updatedAt: number, nowMs?: number): string`

- [ ] **Step 1: Write the failing test**

Create `src/rediscovery.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { LorePage, TimelineEvent } from './db'
import {
  pickRandomId, todayIndex, selectStalePages, pickFeaturedEvent, staleLabel,
} from './rediscovery'

const DAY = 86_400_000

function page(id: string, updatedAt: number): LorePage {
  return { id, title: id, updatedAt } as unknown as LorePage
}
function event(id: string, startAbsolute: number): TimelineEvent {
  return { id, startAbsolute } as unknown as TimelineEvent
}

describe('pickRandomId', () => {
  it('returns null for an empty list', () => {
    expect(pickRandomId([])).toBeNull()
  })
  it('returns the only id for a singleton', () => {
    expect(pickRandomId(['a'])).toBe('a')
  })
  it('uses the injected rng to index deterministically', () => {
    expect(pickRandomId(['a', 'b', 'c'], () => 0)).toBe('a')
    expect(pickRandomId(['a', 'b', 'c'], () => 0.99)).toBe('c')
  })
})

describe('todayIndex', () => {
  it('floors ms to a day bucket', () => {
    expect(todayIndex(0)).toBe(0)
    expect(todayIndex(DAY + 5)).toBe(1)
    expect(todayIndex(2 * DAY - 1)).toBe(1)
  })
})

describe('selectStalePages', () => {
  const now = 1_000 * DAY
  it('keeps only pages older than the threshold, oldest first', () => {
    const pages = [
      page('fresh', now - 10 * DAY),
      page('old', now - 200 * DAY),
      page('older', now - 400 * DAY),
    ]
    expect(selectStalePages(pages, now).map((p) => p.id)).toEqual(['older', 'old'])
  })
  it('excludes a page exactly at the cutoff boundary', () => {
    const pages = [page('edge', now - 90 * DAY)]
    expect(selectStalePages(pages, now)).toEqual([])
  })
  it('caps at the limit', () => {
    const pages = Array.from({ length: 10 }, (_, i) => page(`p${i}`, now - (100 + i) * DAY))
    expect(selectStalePages(pages, now, { limit: 3 })).toHaveLength(3)
  })
  it('is empty when all pages are fresh', () => {
    expect(selectStalePages([page('a', now)], now)).toEqual([])
  })
})

describe('pickFeaturedEvent', () => {
  it('returns null with no events', () => {
    expect(pickFeaturedEvent([], 5)).toBeNull()
  })
  it('rotates as the day index advances', () => {
    const events = [event('a', 0), event('b', 10), event('c', 20)]
    expect(pickFeaturedEvent(events, 0)!.id).toBe('a')
    expect(pickFeaturedEvent(events, 1)!.id).toBe('b')
    expect(pickFeaturedEvent(events, 3)!.id).toBe('a')
  })
  it('is stable regardless of input order', () => {
    const a = [event('a', 0), event('b', 10), event('c', 20)]
    const b = [event('c', 20), event('a', 0), event('b', 10)]
    expect(pickFeaturedEvent(a, 2)!.id).toBe(pickFeaturedEvent(b, 2)!.id)
  })
  it('handles a negative day index safely', () => {
    const events = [event('a', 0), event('b', 10)]
    expect(pickFeaturedEvent(events, -1)!.id).toBe('b')
  })
})

describe('staleLabel', () => {
  it('renders months for sub-year gaps', () => {
    expect(staleLabel(0, 200 * DAY)).toBe('6 months ago')
    expect(staleLabel(0, 40 * DAY)).toBe('1 month ago')
  })
  it('renders years past 365 days', () => {
    expect(staleLabel(0, 400 * DAY)).toBe('1 year ago')
    expect(staleLabel(0, 800 * DAY)).toBe('2 years ago')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/rediscovery.test.ts`
Expected: FAIL — cannot resolve `./rediscovery` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/rediscovery.ts`:

```ts
import type { LorePage, TimelineEvent } from './db'

const MS_PER_DAY = 86_400_000

/** Pick a random id, or null for an empty list. `rng` injectable for tests. */
export function pickRandomId(ids: string[], rng: () => number = Math.random): string | null {
  if (ids.length === 0) return null
  return ids[Math.floor(rng() * ids.length)] ?? null
}

/** Integer day bucket, used as the featured-event rotation seed. */
export function todayIndex(nowMs: number = Date.now()): number {
  return Math.floor(nowMs / MS_PER_DAY)
}

/** Pages whose `updatedAt` is strictly older than the cutoff, oldest first, capped. */
export function selectStalePages(
  pages: LorePage[],
  nowMs: number = Date.now(),
  opts: { thresholdDays?: number; limit?: number } = {},
): LorePage[] {
  const { thresholdDays = 90, limit = 6 } = opts
  const cutoff = nowMs - thresholdDays * MS_PER_DAY
  return pages
    .filter((p) => p.updatedAt < cutoff)
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .slice(0, limit)
}

/** Deterministic daily pick: stable-sort by (startAbsolute, id), index by day. */
export function pickFeaturedEvent(events: TimelineEvent[], dayIndex: number): TimelineEvent | null {
  if (events.length === 0) return null
  const sorted = [...events].sort(
    (a, b) => a.startAbsolute - b.startAbsolute || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
  const i = ((dayIndex % sorted.length) + sorted.length) % sorted.length
  return sorted[i]
}

/** Human "N months/years ago" for the Dusty-corners hint. */
export function staleLabel(updatedAt: number, nowMs: number = Date.now()): string {
  const days = Math.floor((nowMs - updatedAt) / MS_PER_DAY)
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? '' : 's'} ago`
  }
  const months = Math.max(1, Math.floor(days / 30))
  return `${months} month${months === 1 ? '' : 's'} ago`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/rediscovery.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add src/rediscovery.ts src/rediscovery.test.ts
git commit -m "feat: pure rediscovery core — random/stale/featured selection (#178)"
```

---

### Task 2: Random page — Sidebar button

**Files:**
- Modify: `src/components/Sidebar.tsx` (import; `handleRandom`; button in `.sidebar-actions` ~line 106-108)
- Test: `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `pickRandomId` from `../rediscovery`; existing `pages` live query (`pageRepo.listByTitle()`), `navigate`, and `currentId` (already computed in the component from `location.pathname`).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `src/components/Sidebar.test.tsx` (inside the file, add a new `describe` block; reuse the existing `renderSidebar` helper — but this test needs to observe navigation, so add a local render with a location probe):

```ts
import { MemoryRouter, useLocation } from 'react-router-dom'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="loc">{loc.pathname}</div>
}

describe('Sidebar random page', () => {
  beforeEach(async () => { await db.pages.clear() })

  it('navigates to a page when clicked', async () => {
    await createPage({ title: 'Solo Page' })
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Sidebar onOpenSearch={() => {}} />
        <LocationProbe />
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: /random page/i })
    fireEvent.click(btn)
    await waitFor(() =>
      expect(screen.getByTestId('loc').textContent).toMatch(/^\/page\//),
    )
  })

  it('disables the button when there are no pages', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <Sidebar onOpenSearch={() => {}} />
      </MemoryRouter>,
    )
    const btn = await screen.findByRole('button', { name: /random page/i })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })
})
```

Note: `describe`, `it`, `expect`, `beforeEach` are already imported at the top of the file; add `fireEvent`, `waitFor`, `useLocation` to the existing imports if not present.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — no button matching `/random page/i`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/Sidebar.tsx`, add the import (alongside existing imports):

```ts
import { pickRandomId } from '../rediscovery'
```

Add the handler next to `handleNew` (after the `currentId` const so it is in scope at call time; `currentId` is defined later in render but the handler only reads it when clicked):

```ts
  function handleRandom() {
    const ids = pages.map((p) => p.id).filter((id) => id !== currentId)
    const id = pickRandomId(ids)
    if (id) navigate(`/page/${id}`)
  }
```

Update the `.sidebar-actions` block (currently just the New-page button):

```tsx
      <div className="sidebar-actions">
        <button className="primary-btn" onClick={handleNew}>+ New page</button>
        <button
          className="ghost-btn sidebar-random"
          onClick={handleRandom}
          disabled={pages.length === 0}
        >🎲 Random page</button>
      </div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add spacing CSS**

In `src/index.css`, find `.sidebar-actions` (search for it). If it lacks vertical spacing between stacked buttons, add:

```css
.sidebar-random { margin-top: 0.4rem; width: 100%; }
```

- [ ] **Step 6: Commit**

```bash
git add src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/index.css
git commit -m "feat: random-page button in sidebar (#178)"
```

---

### Task 3: HomeConfig flags + "Dusty corners" panel

**Files:**
- Modify: `src/routes/HomeRoute.tsx` (`HomeConfig` interface ~line 21; `DEFAULT_HOME` ~line 35; Customize checkboxes ~line 186-197; new panel section after the "Recently edited" section ~line 301; imports)
- Modify: `src/index.css` (subtext style)
- Test: `src/routes/HomeRoute.test.tsx` (create)

**Interfaces:**
- Consumes: `selectStalePages`, `staleLabel` from `../rediscovery`; existing `pages` live query, `categoryColor`.
- Produces: `HomeConfig` now includes `showDusty: boolean` and `showOnThisDay: boolean` (both default `true`). Task 4 relies on `showOnThisDay` and the checkbox already existing.

- [ ] **Step 1: Write the failing test**

Create `src/routes/HomeRoute.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { db, createPage } from '../db'
import HomeRoute from './HomeRoute'

const DAY = 86_400_000

afterEach(cleanup)
beforeEach(async () => {
  await Promise.all([db.pages.clear(), db.events.clear(), db.calendars.clear(), db.meta.clear()])
})

function renderHome() {
  return render(<MemoryRouter initialEntries={['/home']}><HomeRoute /></MemoryRouter>)
}

describe('HomeRoute — Dusty corners', () => {
  it('surfaces a page untouched beyond the threshold', async () => {
    const id = await createPage({ title: 'Forgotten Ruin' })
    await db.pages.update(id, { updatedAt: Date.now() - 200 * DAY })
    renderHome()
    expect(await screen.findByText('Dusty corners')).toBeTruthy()
    expect(await screen.findByText('Forgotten Ruin')).toBeTruthy()
  })

  it('hides the panel when every page is fresh', async () => {
    await createPage({ title: 'Fresh Page' })
    renderHome()
    await screen.findByText('Fresh Page') // in Recently edited
    expect(screen.queryByText('Dusty corners')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: FAIL — "Dusty corners" text never appears.

- [ ] **Step 3: Add config flags + imports**

In `src/routes/HomeRoute.tsx`, extend the imports from `../db` to include `db` (needed in Task 4; add now to avoid a second edit) and add the rediscovery import. The `../db` import block becomes:

```ts
import {
  db,
  pageRepo,
  mapRepo,
  getMeta,
  setMeta,
  categoryColor,
  statusColor,
  pageStatus,
  STATUSES,
  type LorePage,
} from '../db'
import { selectStalePages, staleLabel } from '../rediscovery'
```

Extend the `HomeConfig` interface:

```ts
interface HomeConfig {
  tagline: string
  about: string
  showAbout: boolean
  showOverview: boolean
  showRecent: boolean
  showDusty: boolean
  showOnThisDay: boolean
}
```

Extend `DEFAULT_HOME`:

```ts
const DEFAULT_HOME: HomeConfig = {
  tagline: 'Write, link, and map the lore of everything you create.',
  about: '',
  showAbout: true,
  showOverview: true,
  showRecent: true,
  showDusty: true,
  showOnThisDay: true,
}
```

- [ ] **Step 4: Add the derived selection + Customize checkboxes**

After the `recent`/`mapCount` live queries (~line 70), add:

```ts
  const dusty = useMemo(() => selectStalePages(pages), [pages])
```

In the Customize panel, after the "Recently edited" toggle (~line 194-197), add two checkboxes:

```tsx
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showDusty} onChange={(e) => saveConfig({ showDusty: e.target.checked })} />
              Dusty corners
            </label>
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showOnThisDay} onChange={(e) => saveConfig({ showOnThisDay: e.target.checked })} />
              On this day
            </label>
```

- [ ] **Step 5: Add the Dusty-corners panel**

After the closing `)}` of the "Recently edited" section (~line 301, before the `<ConfirmDialog>`), add:

```tsx
      {/* Dusty corners */}
      {cfg.showDusty && dusty.length > 0 && (
        <section className="home-section">
          <h2>Dusty corners</h2>
          <p className="home-section-sub">Pages you haven't touched in a while — revisit?</p>
          <div className="card-grid">
            {dusty.map((p) => (
              <Link key={p.id} to={`/page/${p.id}`} className="lore-card">
                <div className="card-badges">
                  <span className="card-badge" style={{ background: categoryColor(p.category) }}>{p.category}</span>
                  <span className="muted">{staleLabel(p.updatedAt)}</span>
                </div>
                <h3>{p.title}</h3>
                {p.summary && <p>{p.summary}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: PASS (both cases).

- [ ] **Step 7: Add subtext CSS**

In `src/index.css`, near the `.home-section` rules, add:

```css
.home-section-sub { color: var(--ink-faint); margin: -0.25rem 0 0.75rem; font-size: 0.9rem; }
```

- [ ] **Step 8: Commit**

```bash
git add src/routes/HomeRoute.tsx src/routes/HomeRoute.test.tsx src/index.css
git commit -m "feat: Dusty corners home panel + config flags (#178)"
```

---

### Task 4: "On this day" featured-event panel

**Files:**
- Modify: `src/routes/HomeRoute.tsx` (imports; live queries; new panel section after Dusty corners)
- Modify: `src/index.css` (`.on-this-day` styles)
- Test: `src/routes/HomeRoute.test.tsx` (extend)

**Interfaces:**
- Consumes: `pickFeaturedEvent`, `todayIndex` from `../rediscovery`; `formatDate` from `../calendar`; `stripHtml` from `../html`; `db.events`, `db.calendars`. `cfg.showOnThisDay` + its Customize checkbox already exist (Task 3).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Extend `src/routes/HomeRoute.test.tsx` with a new describe block. Use the DB calendar/event CRUD to build fixtures:

```tsx
import { createCalendar, addEvent } from '../db'

describe('HomeRoute — On this day', () => {
  it('features an event with its in-world date', async () => {
    const calId = await createCalendar('Imperial')
    await addEvent({
      calendarId: calId,
      title: 'The Sundering',
      description: '<p>The world cracked in two.</p>',
      category: 'Cataclysm',
      pageId: null,
      startYear: 412, startMonth: 0, startDay: 3,
    })
    renderHome()
    expect(await screen.findByText('On this day')).toBeTruthy()
    expect(await screen.findByText('The Sundering')).toBeTruthy()
    expect(screen.getByText(/The world cracked in two/)).toBeTruthy()
  })

  it('hides the panel when there are no events', async () => {
    await createPage({ title: 'Anything' })
    renderHome()
    await screen.findByText('Anything')
    expect(screen.queryByText('On this day')).toBeNull()
  })
})
```

Note: `addEvent` takes `NewEventData = Omit<TimelineEvent, 'id'|'startAbsolute'|'endAbsolute'|'createdAt'|'updatedAt'>` — the fixture above supplies every required key (`color`/`icon`/`end*` are optional); `startAbsolute` is computed internally. `createCalendar`/`addEvent` are re-exported from the `../db` barrel.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: FAIL — "On this day" never appears.

- [ ] **Step 3: Add imports + live queries**

In `src/routes/HomeRoute.tsx`, add imports:

```ts
import { pickFeaturedEvent, todayIndex } from '../rediscovery'
import { formatDate } from '../calendar'
import { stripHtml } from '../html'
```

(Consolidate the two `../rediscovery` imports into one line: `import { selectStalePages, staleLabel, pickFeaturedEvent, todayIndex } from '../rediscovery'`.)

After the `dusty` memo, add:

```ts
  const events = useLiveQuery(() => db.events.toArray(), []) ?? []
  const featured = useMemo(() => pickFeaturedEvent(events, todayIndex()), [events])
  const featuredCal = useLiveQuery(
    () => (featured ? db.calendars.get(featured.calendarId) : undefined),
    [featured?.calendarId],
  )
```

- [ ] **Step 4: Add the On-this-day panel**

After the Dusty-corners section, add:

```tsx
      {/* On this day */}
      {cfg.showOnThisDay && featured && featuredCal && (
        <section className="home-section">
          <h2>On this day</h2>
          <Link
            className="on-this-day"
            to={featured.pageId ? `/page/${featured.pageId}` : '/timeline'}
          >
            {featured.icon && <span className="otd-icon">{featured.icon}</span>}
            <span className="otd-body">
              <span className="otd-title">{featured.title}</span>
              <span className="otd-date">
                {formatDate(featuredCal, featured.startYear, featured.startMonth, featured.startDay)}
              </span>
              {featured.description && (
                <span className="otd-snippet">{stripHtml(featured.description).slice(0, 160)}</span>
              )}
              <span className="otd-link">View on timeline →</span>
            </span>
          </Link>
        </section>
      )}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/routes/HomeRoute.test.tsx`
Expected: PASS (all four HomeRoute cases).

- [ ] **Step 6: Add panel CSS**

In `src/index.css`, add:

```css
.on-this-day {
  display: flex;
  gap: 0.9rem;
  align-items: flex-start;
  padding: 1rem 1.15rem;
  border: 1px solid var(--border);
  border-radius: 10px;
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s ease;
}
.on-this-day:hover { border-color: var(--accent); }
.otd-icon { font-size: 1.8rem; line-height: 1; }
.otd-body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.otd-title { font-family: var(--display); font-size: 1.15rem; color: var(--ink); }
.otd-date { color: var(--accent-soft); font-size: 0.9rem; }
.otd-snippet { color: var(--ink-faint); font-size: 0.9rem; }
.otd-link { color: var(--accent); font-size: 0.85rem; margin-top: 0.2rem; }
```

- [ ] **Step 7: Commit**

```bash
git add src/routes/HomeRoute.tsx src/routes/HomeRoute.test.tsx src/index.css
git commit -m "feat: On this day featured-event home panel (#178)"
```

---

### Task 5: Full verification + PR

**Files:** none (verification + integration)

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: clean (0 errors). In particular, no `react-hooks/purity` violations — confirm no literal `Date.now()`/`Math.random()` was introduced in `Sidebar.tsx` or `HomeRoute.tsx`.

- [ ] **Step 2: Full test suite**

Run: `npm run test:run`
Expected: all suites pass, including `rediscovery.test.ts`, `Sidebar.test.tsx`, `HomeRoute.test.tsx`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: `tsc -b` clean + vite build succeeds (pre-existing chunk-size warning is fine).

- [ ] **Step 4: Push + open PR**

```bash
git push -u origin fix/178-browse-rediscovery
gh pr create --base main --title "feat: browse & rediscovery — random page, dusty corners, on this day (#178)" --label "version:minor" --body "Closes #178. Adds a sidebar Random-page button, a Home 'Dusty corners' panel (stale pages), and a Home 'On this day' rotating featured-event panel. Pure selection logic in src/rediscovery.ts (fully unit-tested); no schema change, no new dependency."
```

Expected: PR created against `main` with the `version:minor` label.

---

## Self-Review

**Spec coverage:**
- Pure core (`pickRandomId`/`selectStalePages`/`pickFeaturedEvent`/`todayIndex`/`staleLabel`) → Task 1. ✅ (`staleLabel` added to honor the spec's "last touched" hint.)
- Random page in sidebar, excludes current page, disabled at 0 pages → Task 2. ✅
- Dusty corners panel, 90d/6-cap, hidden when empty, toggle default on → Task 3. ✅
- On this day rotating event, in-world date, snippet, link, hidden when no events, toggle default on → Task 4. ✅
- Config flags merged onto `DEFAULT_HOME` (old saved configs default on) → Task 3 Steps 3-4. ✅
- No schema change / no new dep → confirmed across tasks; verification in Task 5. ✅

**Placeholder scan:** No TBD/TODO; all steps carry concrete code. Task 4's `addEvent` fixture is confirmed against `NewEventData` (all required keys present).

**Type consistency:** `selectStalePages`/`staleLabel`/`pickFeaturedEvent`/`todayIndex`/`pickRandomId` signatures match between Task 1 definitions and Tasks 2-4 call sites. `HomeConfig` fields `showDusty`/`showOnThisDay` defined in Task 3 and consumed in Task 4. `featured.calendarId`/`startYear`/`startMonth`/`startDay` match the `TimelineEvent` type.
