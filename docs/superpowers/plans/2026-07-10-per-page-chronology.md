# Per-Page Chronology Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "History" panel to the page aside listing every timeline event that references the page, chronologically, each row deep-linking to that event on the timeline.

**Architecture:** A pure matcher (`src/pageChronology.ts`) takes `(pageId, title, events, calendars)` and returns sorted entries tagged with roles — `linked` (the event's `pageId` ref) and/or `mention` (a wiki link to the page title in the event description). A thin component (`PageHistory.tsx`) feeds it live Dexie data via `useLiveQuery` and renders the aside panel. A new `/timeline?event=<id>` deep link mirrors the existing `/map?pin=<id>` pattern.

**Tech Stack:** React 19, TypeScript (strict), Dexie + `dexie-react-hooks`, React Router (hash routing), Vitest + happy-dom.

Spec: `docs/superpowers/specs/2026-07-10-per-page-chronology-design.md` · Issue [#177](https://github.com/KantikPotatoe/Lore-Codex/issues/177)

## Global Constraints

- Branch `feat/177-page-chronology` already exists off `main`. Work there.
- TypeScript `strict`. Before claiming done, all three must pass: `npm run lint`, `npm run build`, `npm run test:run`.
- The PR needs a version label. This is a new feature ⇒ **`version:minor`**.
- `pageChronology` is **pure**: no React, no Dexie, no side effects. It may import `wikiLinkTitles` from `src/html.ts` (pure) and must take `TimelineEvent` / `Calendar` via `import type` only. It is **not** re-exported from the `db/` barrel — do not touch `src/db/index.ts` or `src/db/barrel.test.ts`.
- Do **not** write state inside a `useEffect` body. The repo's `react-hooks` config makes `set-state-in-effect` a lint error. Derive instead.
- Do not use literal `Date.now()` / `Math.random()` in render.
- No host `alert()` / `confirm()`.
- Role order is always `['linked', 'mention']` when both apply.
- Collapsed row cap is **8**, exported as a named constant.

---

### Task 1: The pure matcher

**Files:**
- Create: `src/pageChronology.ts`
- Test: `src/pageChronology.test.ts`

**Interfaces:**
- Consumes: `wikiLinkTitles(html: string): string[]` from `src/html.ts`. Types `TimelineEvent`, `Calendar` from `src/db`.
- Produces:
  - `type ChronologyRole = 'linked' | 'mention'`
  - `interface ChronologyEntry { event: TimelineEvent; calendar: Calendar | null; roles: ChronologyRole[] }`
  - `function pageChronology(pageId: string, title: string, events: TimelineEvent[], calendars: Calendar[]): ChronologyEntry[]`

- [ ] **Step 1: Write the failing test**

Create `src/pageChronology.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pageChronology } from './pageChronology'
import type { Calendar, TimelineEvent } from './db'

const CAL: Calendar = {
  id: 'cal-1',
  name: 'Standard Calendar',
  anchor: 0,
  months: [{ name: 'Firstmonth', days: 30 }, { name: 'Secondmonth', days: 30 }],
  weekdays: ['Moonday', 'Sunday'],
  eras: [],
  createdAt: 0,
}

const CAL_2: Calendar = { ...CAL, id: 'cal-2', name: 'Elven Reckoning', anchor: 1000 }

function ev(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 'e1',
    calendarId: 'cal-1',
    title: 'An Event',
    description: '',
    category: '',
    pageId: null,
    startYear: 0,
    startMonth: 0,
    startDay: 1,
    startAbsolute: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

/** An event description containing a wiki link to `title`, as Tiptap stores it. */
function mentions(title: string): string {
  return `<p>Fought at <a data-wikilink data-title="${title}">${title}</a>.</p>`
}

describe('pageChronology', () => {
  it('matches an event whose pageId is this page', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ pageId: 'p1' })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['linked'])
    expect(entries[0].calendar?.id).toBe('cal-1')
  })

  it('matches an event whose description wiki-links this page title', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ description: mentions('Aldric') })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['mention'])
  })

  it('yields one row with both roles when an event links and mentions', () => {
    const event = ev({ pageId: 'p1', description: mentions('Aldric') })
    const entries = pageChronology('p1', 'Aldric', [event], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['linked', 'mention'])
  })

  it('compares titles ignoring case and surrounding whitespace', () => {
    const entries = pageChronology('p1', '  aLdRiC ', [ev({ description: mentions('Aldric') })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].roles).toEqual(['mention'])
  })

  it('skips events that neither link nor mention the page', () => {
    const events = [ev({ pageId: 'other' }), ev({ id: 'e2', description: mentions('Someone Else') })]
    expect(pageChronology('p1', 'Aldric', events, [CAL])).toEqual([])
  })

  it('interleaves events from calendars with different anchors by startAbsolute', () => {
    const events = [
      ev({ id: 'late', calendarId: 'cal-2', pageId: 'p1', startAbsolute: 1200, title: 'Late' }),
      ev({ id: 'early', calendarId: 'cal-1', pageId: 'p1', startAbsolute: 30, title: 'Early' }),
    ]
    const entries = pageChronology('p1', 'Aldric', events, [CAL, CAL_2])
    expect(entries.map((e) => e.event.id)).toEqual(['early', 'late'])
    expect(entries[1].calendar?.name).toBe('Elven Reckoning')
  })

  it('breaks startAbsolute ties by title, stably', () => {
    const events = [
      ev({ id: 'b', pageId: 'p1', startAbsolute: 5, title: 'Siege of Bel' }),
      ev({ id: 'a', pageId: 'p1', startAbsolute: 5, title: 'Alms of Ash' }),
    ]
    const entries = pageChronology('p1', 'Aldric', events, [CAL])
    expect(entries.map((e) => e.event.id)).toEqual(['a', 'b'])
  })

  it('yields calendar: null for an event whose calendar was deleted, without throwing', () => {
    const entries = pageChronology('p1', 'Aldric', [ev({ calendarId: 'gone', pageId: 'p1' })], [CAL])
    expect(entries).toHaveLength(1)
    expect(entries[0].calendar).toBeNull()
  })

  it('returns an empty array when the page title is blank', () => {
    expect(pageChronology('p1', '   ', [ev({ description: mentions('Aldric') })], [CAL])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/pageChronology.test.ts
```

Expected: FAIL — `Failed to resolve import "./pageChronology"`.

- [ ] **Step 3: Write the implementation**

Create `src/pageChronology.ts`:

```ts
// src/pageChronology.ts
// Pure matcher: which timeline events reference a given page, in chronological
// order. No React, no Dexie — the component supplies the rows. Lives at src/
// (not src/db/) because it imports nothing from the database at runtime: types
// are erased and wikiLinkTitles is itself pure. A runtime db import here would
// drag the Dexie singleton into every consumer.

import { wikiLinkTitles } from './html'
import type { Calendar, TimelineEvent } from './db'

/** How an event refers to the page. `linked` is the curated `event.pageId` ref
 *  (survives a rename, it stores an id); `mention` is a wiki link to the page
 *  title in the event's description. An event can be both. */
export type ChronologyRole = 'linked' | 'mention'

export interface ChronologyEntry {
  event: TimelineEvent
  /** The event's calendar, or null if it has since been deleted. */
  calendar: Calendar | null
  /** Never empty. `linked` precedes `mention` when both apply. */
  roles: ChronologyRole[]
}

/**
 * Every event that references this page, sorted by the shared absolute-day axis
 * so events recorded in different calendars still read as one chronology.
 * Ties break by title, keeping the order stable across renders.
 */
export function pageChronology(
  pageId: string,
  title: string,
  events: TimelineEvent[],
  calendars: Calendar[],
): ChronologyEntry[] {
  const titleLc = title.trim().toLowerCase()
  const calById = new Map(calendars.map((c) => [c.id, c]))

  const entries: ChronologyEntry[] = []
  for (const event of events) {
    const roles: ChronologyRole[] = []
    if (pageId && event.pageId === pageId) roles.push('linked')
    if (
      titleLc &&
      wikiLinkTitles(event.description).some((t) => t.trim().toLowerCase() === titleLc)
    ) {
      roles.push('mention')
    }
    if (roles.length === 0) continue
    entries.push({ event, calendar: calById.get(event.calendarId) ?? null, roles })
  }

  entries.sort(
    (a, b) =>
      a.event.startAbsolute - b.event.startAbsolute ||
      a.event.title.localeCompare(b.event.title),
  )
  return entries
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/pageChronology.test.ts
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Lint the new files**

```bash
npm run lint
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pageChronology.ts src/pageChronology.test.ts
git commit -m "feat: pure page-chronology matcher — linked + mention roles (#177)"
```

---

### Task 2: The History panel

**Files:**
- Create: `src/components/PageHistory.tsx`
- Modify: `src/routes/PageRoute.tsx` (import near line 12; mount after line 333)
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `pageChronology`, `ChronologyRole` (Task 1). `absoluteToDate`, `formatDate` from `src/calendar.ts`. `db` from `src/db`.
- Produces: default export `PageHistory({ pageId, title }: { pageId: string; title: string })`. Exported constant `COLLAPSED_COUNT = 8`.

- [ ] **Step 1: Create the component**

Create `src/components/PageHistory.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Calendar } from '../db'
import { absoluteToDate, formatDate } from '../calendar'
import { pageChronology, type ChronologyRole } from '../pageChronology'

const ROLE_LABEL: Record<ChronologyRole, string> = {
  linked: 'Linked',
  mention: 'Mention',
}

/** Rows shown before the "Show all N" control appears. */
export const COLLAPSED_COUNT = 8

/** The era is noise at aside width, so it is omitted here (the timeline shows it). */
function dateLabel(cal: Calendar, absolute: number): string {
  const { year, month, day } = absoluteToDate(cal, absolute)
  return formatDate(cal, year, month, day, { showEra: false })
}

/** "History": timeline events that reference this page — the entity-scoped
 *  chronology, as opposed to the global /timeline. Quiet when empty. */
export default function PageHistory({ pageId, title }: { pageId: string; title: string }) {
  const events = useLiveQuery(() => db.events.orderBy('startAbsolute').toArray(), [])
  const calendars = useLiveQuery(() => db.calendars.toArray(), [])
  const [expanded, setExpanded] = useState(false)

  const entries = useMemo(
    () => pageChronology(pageId, title, events ?? [], calendars ?? []),
    [pageId, title, events, calendars],
  )

  if (entries.length === 0) return null

  // Name the calendar on each row only when the chronology actually spans more
  // than one reckoning; single-calendar worlds stay clean.
  const multiCalendar = new Set(entries.map((e) => e.event.calendarId)).size > 1
  const shown = expanded ? entries : entries.slice(0, COLLAPSED_COUNT)

  return (
    <div className="page-history">
      <div className="page-history-head">
        History <span className="backlinks-count">{entries.length}</span>
      </div>
      <ul className="page-history-list">
        {shown.map(({ event, calendar, roles }) => (
          <li key={event.id}>
            <Link to={`/timeline?event=${event.id}`} className="page-history-row">
              <span className="page-history-date">
                {calendar ? dateLabel(calendar, event.startAbsolute) : '—'}
                {calendar && event.endAbsolute != null &&
                  ` — ${dateLabel(calendar, event.endAbsolute)}`}
              </span>
              <span className="page-history-title">
                {event.icon && <span className="page-history-icon">{event.icon}</span>}
                {event.title}
              </span>
              {multiCalendar && calendar && (
                <span className="page-history-cal">{calendar.name}</span>
              )}
            </Link>
            <span className="appears-in-roles">
              {roles.map((r) => (
                <span key={r} className="appears-in-role">{ROLE_LABEL[r]}</span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      {!expanded && entries.length > COLLAPSED_COUNT && (
        <button className="ghost-btn page-history-more" onClick={() => setExpanded(true)}>
          Show all {entries.length}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Mount it in the page aside**

In `src/routes/PageRoute.tsx`, add the import beside the other aside components (after the `SceneAppearances` import on line 12):

```tsx
import SceneAppearances from '../components/SceneAppearances'
import PageHistory from '../components/PageHistory'
```

Then extend the aside (currently lines 332-333):

```tsx
          <Backlinks pageId={id} />
          <SceneAppearances pageId={id} />
          <PageHistory pageId={id} title={page.title} />
```

- [ ] **Step 3: Add the styles**

Append to `src/index.css`:

```css
/* Page aside — History (per-page chronology, #177) */
.page-history {
  margin-top: 16px; background: var(--panel); border: 1px solid var(--border);
  border-radius: var(--radius); padding: 12px 14px;
}
.page-history-head {
  font-family: var(--display); font-size: 12px; text-transform: uppercase;
  letter-spacing: 1px; color: var(--ink-dim); margin-bottom: 8px;
  display: flex; align-items: center; gap: 6px;
}
.page-history-list {
  list-style: none; margin: 0; padding: 0;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.page-history-row {
  display: flex; flex-direction: column; text-decoration: none; color: var(--ink);
}
.page-history-row:hover .page-history-title { color: var(--accent); }
.page-history-date { font-size: 0.75rem; color: var(--ink-faint); }
.page-history-title { font-size: 0.9rem; }
.page-history-icon { margin-right: 0.3rem; }
.page-history-cal { font-size: 0.7rem; color: var(--ink-faint); font-style: italic; }
.page-history-more {
  margin-top: 0.5rem; width: 100%; font-size: 0.75rem;
}
```

- [ ] **Step 4: Verify it type-checks and lints**

```bash
npm run build && npm run lint
```

Expected: build succeeds, no lint errors.

- [ ] **Step 5: Verify in the running app**

```bash
npm run dev
```

Open `http://localhost:5174`. In a world with a timeline: create an event whose description wiki-links a page, and set another event's linked page to that same page via the Event editor. Open that page. Confirm: the History panel appears in the right aside below "Appears in"; rows show date + title; badges read `Linked` and `Mention`; a page with no matching events shows no panel at all.

- [ ] **Step 6: Commit**

```bash
git add src/components/PageHistory.tsx src/routes/PageRoute.tsx src/index.css
git commit -m "feat: History panel on the page aside (#177)"
```

---

### Task 3: The `/timeline?event=<id>` deep link

**Files:**
- Modify: `src/components/TimelineVertical.tsx` (Props at lines 5-11; row div at line 89)
- Modify: `src/routes/TimelineRoute.tsx` (imports lines 2-4; `displayCal` at lines 23-24; `<TimelineVertical>` at line 103)
- Modify: `src/index.css` (append)

**Interfaces:**
- Consumes: `useSearchParams` from `react-router-dom`.
- Produces: `TimelineVertical` gains an optional prop `focusEventId?: string | null`. Each rendered row gets DOM id `tl-event-<eventId>`; the focused row also gets class `is-focused`.

**Why no state is set in an effect:** navigating from `/page/:id` to `/timeline` unmounts `TimelineRoute`, so `view` is already `'vertical'` and `categoryFilter` already `''` on arrival. The display calendar is *derived* from the focused event rather than assigned, which keeps the component clear of the `set-state-in-effect` lint rule. The only effect is the scroll — a DOM side effect.

- [ ] **Step 1: Give timeline rows a stable id and a focus class**

In `src/components/TimelineVertical.tsx`, extend `Props` (lines 5-11):

```tsx
interface Props {
  events: TimelineEvent[]
  calendars: Calendar[]
  displayCalendar: Calendar | null
  allPages: LorePage[]
  onEdit: (event: TimelineEvent) => void
  /** Row to scroll to and flash, from `/timeline?event=<id>`. */
  focusEventId?: string | null
}
```

Destructure it in the signature:

```tsx
export default function TimelineVertical({
  events,
  calendars,
  displayCalendar,
  allPages,
  onEdit,
  focusEventId,
}: Props) {
```

Replace the row div (line 89):

```tsx
                <div key={event.id} className="tl-row">
```

with:

```tsx
                <div
                  key={event.id}
                  id={`tl-event-${event.id}`}
                  className={event.id === focusEventId ? 'tl-row is-focused' : 'tl-row'}
                >
```

- [ ] **Step 2: Read `?event=` and derive the display calendar**

In `src/routes/TimelineRoute.tsx`, change the imports (lines 2-4):

```tsx
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pageRepo, type TimelineEvent } from '../db'
```

After the `managingCals` state declaration (line 21), add:

```tsx
  // Deep link (#/timeline?event=<id>) — mirrors MapRoute's `?pin=`. A stale or
  // deleted id resolves to nothing and the whole thing is a harmless no-op.
  const [searchParams] = useSearchParams()
  const focusEventId = searchParams.get('event')
  const focusEvent = focusEventId ? events.find((e) => e.id === focusEventId) : undefined
```

Replace the `displayCal` derivation (lines 23-24):

```tsx
  const displayCal =
    calendars.find((c) => c.id === displayCalId) ?? calendars[0] ?? null
```

with one that prefers the focused event's calendar until the user picks another. Arriving via a deep link remounts this route, so `displayCalId` is null and the focused event's reckoning wins:

```tsx
  const displayCal =
    calendars.find((c) => c.id === displayCalId) ??
    calendars.find((c) => c.id === focusEvent?.calendarId) ??
    calendars[0] ??
    null
```

- [ ] **Step 3: Scroll the focused row into view**

Still in `src/routes/TimelineRoute.tsx`, after the `categories` derivation (line 30), add:

```tsx
  // Scroll after the row has rendered. Re-runs as the live query fills in and as
  // the calendar changes, so it lands whether or not events had loaded on mount.
  useEffect(() => {
    if (!focusEventId) return
    document
      .getElementById(`tl-event-${focusEventId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [focusEventId, displayCal?.id, visibleEvents.length])
```

- [ ] **Step 4: Pass the prop through**

In the `<TimelineVertical>` call (line 103), add the prop:

```tsx
          <TimelineVertical
            events={visibleEvents}
            calendars={calendars}
            displayCalendar={displayCal}
            allPages={allPages}
            onEdit={(e) => setEditingEvent(e)}
            focusEventId={focusEventId}
          />
```

Leave `<TimelineHorizontal>` untouched — the axis view has no stable scroll target.

- [ ] **Step 5: Add the highlight flash**

Append to `src/index.css`. The animation runs once on mount and leaves no permanent state, so no JS timer is needed:

```css
/* Deep-linked timeline row (#/timeline?event=<id>) — flash, then settle. */
@keyframes tl-focus-flash {
  from { background: color-mix(in srgb, var(--accent) 22%, transparent); }
  to   { background: transparent; }
}
.tl-row.is-focused {
  animation: tl-focus-flash 2s ease-out 1;
  border-radius: var(--radius);
}
@media (prefers-reduced-motion: reduce) {
  .tl-row.is-focused { animation: none; }
}
```

- [ ] **Step 6: Verify it type-checks, lints, and tests clean**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass. In particular, no `set-state-in-effect` and no `react-hooks/exhaustive-deps` warnings from the new effect.

- [ ] **Step 7: Verify in the running app**

```bash
npm run dev
```

From a page's History panel, click a row. Confirm: the timeline opens in List view scrolled to that event, the row flashes gold and settles, and the reckoning selector shows the event's own calendar. Then hand-edit the URL to `#/timeline?event=does-not-exist` and confirm the timeline renders normally with no error.

- [ ] **Step 8: Commit**

```bash
git add src/components/TimelineVertical.tsx src/routes/TimelineRoute.tsx src/index.css
git commit -m "feat: /timeline?event=<id> deep link, scroll + flash (#177)"
```

---

### Task 4: Documentation, full verification, PR

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything from Tasks 1-3. Produces: nothing consumed downstream.

- [ ] **Step 1: Document the module and the panel**

In `CLAUDE.md`, in the **Timeline & calendars** section, after the sentence ending `CalendarEditor`/`EventEditor` modals.`, append:

```markdown
`src/pageChronology.ts` is the **pure** per-page view of the same data: `pageChronology(pageId, title, events, calendars)` returns the events that reference a page — by `event.pageId` (role `linked`) or by a wiki link to its title in `description` (role `mention`) — sorted on the shared `startAbsolute` axis so several calendars read as one chronology. Rendered by `PageHistory.tsx` in the page aside; rows deep-link to `/timeline?event=<id>`, which `TimelineRoute` resolves by deriving the display calendar from the event, scrolling to row id `tl-event-<id>` and flashing it (`.is-focused`), the same shape as `/map?pin=<id>`.
```

In the **Page right sidebar** section, change the heading line to name the new panel — it currently reads:

```markdown
### Page right sidebar — `Infobox.tsx`, `TableOfContents.tsx`, `Backlinks.tsx`
```

to:

```markdown
### Page right sidebar — `Infobox.tsx`, `TableOfContents.tsx`, `Backlinks.tsx`, `PageHistory.tsx`
```

and append to that section's prose:

> · **History** (`PageHistory.tsx`, per-page chronology; quiet when empty, first 8 rows then "Show all N")

- [ ] **Step 2: Run the full check the way CI does**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass. Do not proceed until they do — CI (`.github/workflows/ci.yml`) runs exactly these.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: per-page chronology in CLAUDE.md (#177)"
```

- [ ] **Step 4: Push and open the PR with a version label**

```bash
git push -u origin feat/177-page-chronology
gh pr create --label version:minor --title "feat: per-page chronology — History panel on the page aside (#177)" --body "$(cat <<'EOF'
Closes #177.

Adds a **History** panel to the page aside: every timeline event that references
the page, in chronological order, each row deep-linking to that event.

- `src/pageChronology.ts` — pure matcher. An event matches by `event.pageId`
  (badge `Linked`) or by a wiki link to the page title in its `description`
  (badge `Mention`); an event doing both yields one row with both badges. Sorted
  on the shared `startAbsolute` axis, so a world with several calendars still
  reads as one chronology. Ties break by title.
- `src/components/PageHistory.tsx` — the panel. Quiet when empty, first 8 rows
  then "Show all N" (the header count is always the true total).
- `/timeline?event=<id>` — new deep link, mirroring `/map?pin=<id>`. Derives the
  display calendar from the event, scrolls to it and flashes it. A stale id no-ops.

Design: `docs/superpowers/specs/2026-07-10-per-page-chronology-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Confirm CI is green**

```bash
gh pr checks --watch
```

Expected: lint, build, and test all pass.

---

## Self-Review

**Spec coverage.** Every section maps to a task: the pure core and its nine test cases → Task 1; the component, the 8-row cap, the multi-calendar row label, the aside mount → Task 2; the `?event=` deep link, the row `id`, `focusEventId`, `.is-focused` → Task 3; `CLAUDE.md` → Task 4. The spec's "Files" table is fully consumed. Out-of-scope items (lifespan, multi-ref cast, the `renamePage` gap) appear nowhere as tasks, correctly, and the `renamePage` gap is surfaced in the PR body.

**One deliberate divergence from the spec.** The spec's deep-link section listed `setDisplayCalId` / `setView(‘vertical’)` / clearing `categoryFilter` inside the focus effect. That would trip the repo's `set-state-in-effect` lint rule. Task 3 derives the display calendar instead, and relies on `TimelineRoute` remounting on navigation (so `view` and `categoryFilter` are already at their defaults). Behaviour is identical; the lint rule stays satisfied. The `useEffect` that remains only scrolls.

**Type consistency.** `pageChronology(pageId, title, events, calendars)` is called with that arity in Task 2. `ChronologyRole` keys `linked`/`mention` match `ROLE_LABEL`'s keys. `focusEventId` is `string | null` in `TimelineRoute` (from `searchParams.get`) and typed `string | null | undefined` in `TimelineVertical`'s Props, which accepts it. `dateLabel(cal, absolute)` is called only where `calendar` is non-null (guarded by `calendar ? … : '—'`). `COLLAPSED_COUNT` is defined and used in one file.

**No placeholders.** Every code step carries complete code; every command carries its expected output.
