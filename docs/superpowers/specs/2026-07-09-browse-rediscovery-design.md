# Browse & rediscovery — design spec

**Issue:** #178 — Browse & rediscovery: random page, stale pages, on-this-day
**Labels:** enhancement, navigation, effort:small
**Date:** 2026-07-09

## Goal

Lore Codex is optimised for lookup, not wandering. For hobby worldbuilding,
re-reading your own world is half the joy. This adds three cheap "make the
world feel alive" affordances:

1. **Random page** — jump to a random page from the sidebar.
2. **Dusty corners** — a Home panel surfacing pages not touched in a while.
3. **On this day** — a Home panel featuring one timeline event, rotating daily.

No schema change, no new dependency.

## Pure core — `src/rediscovery.ts` (new)

All randomness/time lives here, keeping `Math.random()`/`Date.now()` out of
component render (per the repo's `react-hooks/purity` lint rule) and making the
selection logic deterministically unit-testable. Functions take explicit
`nowMs`/`dayIndex`/`rng` parameters; the "now" seam defaults to `Date.now()`.

```ts
// Random page target. Returns null for an empty list.
pickRandomId(ids: string[], rng: () => number = Math.random): string | null

// Pages whose updatedAt is older than the cutoff, oldest-first, capped.
selectStalePages(
  pages: LorePage[],
  nowMs: number = Date.now(),
  opts?: { thresholdDays?: number; limit?: number }, // defaults: 90, 6
): LorePage[]

// Stable-sort events by (startAbsolute, id); return events[dayIndex % len].
// Deterministic -> rotates daily, stable within a day. Null for empty.
pickFeaturedEvent(events: TimelineEvent[], dayIndex: number): TimelineEvent | null

// Integer day bucket used as the rotation seed.
todayIndex(nowMs: number = Date.now()): number   // Math.floor(nowMs / 86_400_000)
```

Notes:
- `selectStalePages` cutoff = `nowMs - thresholdDays * 86_400_000`; keep pages
  with `updatedAt < cutoff`, sort ascending by `updatedAt`, slice to `limit`.
- `pickFeaturedEvent` sorts a copy (never mutates the input); the `(startAbsolute,
  id)` tiebreak makes the daily pick stable regardless of DB return order.

## ① Random page — Sidebar

- Add a `🎲 Random page` button in `.sidebar-actions`, next to `+ New page`.
- Uses the already-loaded `pages` live query (`pageRepo.listByTitle()`).
- onClick: exclude the current page id (from `location.pathname`) so the pick
  always moves, then `pickRandomId(candidateIds)` → `navigate('/page/' + id)`.
- Disabled when there are 0 pages (or only the current page).

## ② Dusty corners — Home panel

- New `HomeConfig` flag `showDusty` (default `true`) + a Customize checkbox.
- Panel title "Dusty corners", subtext "Pages you haven't touched in a while —
  revisit?".
- Renders `selectStalePages(pages)` as a compact `.lore-card` grid (reusing the
  Recently-edited card markup), each linking to `/page/:id`, with a relative
  "last touched" hint. (`nowMs` defaults to `Date.now()` *inside*
  `rediscovery.ts` — the component never writes `Date.now()` in render.)
- **Hidden entirely when the selection is empty** (a fresh or all-fresh world
  shows nothing) — no empty state.

## ③ On this day — Home panel

- New `HomeConfig` flag `showOnThisDay` (default `true`) + a Customize checkbox.
- Loads events via `db.events.toArray()` (live query). Picks one with
  `pickFeaturedEvent(events, todayIndex())`, then loads that event's calendar
  (`db.calendars.get(event.calendarId)`).
- Renders: the event's `icon` (if any), `title`, the in-world date via
  `formatDate(cal, startYear, startMonth, startDay)`, a `stripHtml(description)`
  snippet, and a link — to `/page/:pageId` when the event is page-linked, else
  `/timeline`.
- **Hidden when there are no events** (or the calendar can't be resolved).

## Config & Customize

Extend `HomeConfig`:

```ts
interface HomeConfig {
  tagline: string
  about: string
  showAbout: boolean
  showOverview: boolean
  showRecent: boolean
  showDusty: boolean       // new, default true
  showOnThisDay: boolean   // new, default true
}
```

`DEFAULT_HOME` gains both flags (`true`). Two more checkboxes join the existing
About/Overview/Recent toggles in the Customize panel. Because `getMeta` merges
onto `DEFAULT_HOME`, existing saved configs without the new keys default to on.

## Data flow / dependencies

- All reads through existing `db`/`pageRepo` live queries — reactive, no new
  wiring. `formatDate` (`src/calendar.ts`) and `stripHtml` (`src/html.ts`) reused.
- No IndexedDB schema change, no `CURRENT_SCHEMA_VERSION` bump, no new npm dep.
- `src/rediscovery.ts` re-exported through the appropriate barrel only if a
  component imports it via `../db`; it's app-level (not `db/`), so components
  import it directly from `../rediscovery`.

## Testing

**`src/rediscovery.test.ts` (pure):**
- `pickRandomId`: empty → null; single → that id; seeded `rng` → deterministic pick.
- `selectStalePages`: threshold boundary (just-inside/just-outside cutoff),
  oldest-first ordering, `limit` cap, empty when all fresh.
- `pickFeaturedEvent`: rotates as `dayIndex` increments, stable for same index
  regardless of input order, empty → null, single event.
- `todayIndex`: floors to the day bucket.

**Component tests:**
- Sidebar: random button navigates to a `/page/:id`; disabled with 0 pages.
- HomeRoute: Dusty panel appears with stale data and is absent when all pages
  are fresh; On-this-day panel appears with an event + calendar and is absent
  with no events; the two new Customize toggles hide their panels.

## Out of scope (YAGNI)

- Real-world-date → in-world-calendar mapping for On this day (rejected as
  semantically fuzzy; rotating featured event chosen instead).
- Configurable staleness threshold / card counts (fixed at 90 days / 6).
- Random page on the Home hero (sidebar only).
