# Polish Sprint — search shortcut, route identity, timeline spine, graph minimap

**Date:** 2026-07-03
**Status:** Approved

## Goal

One cross-cutting sprint attacking the three confirmed pain points — navigation
friction, route visual sameness, and timeline/graph usability — with
high-value, session-sized items. Visuals refine *within* the existing
parchment-and-gold theme; no re-theming, no layout rework.

## Scope (4 items)

### 1. Search: global shortcut, recents, create-from-search

**Problem:** the only way into `SearchModal` is clicking the sidebar search
box; an empty query shows a blank box; a failed search dead-ends.

- **Global shortcut** in `App.tsx`: `Ctrl/Cmd+K` and `/` open the search
  modal. `/` is ignored while focus is in an `input`, `textarea`, `select`, or
  contenteditable (incl. ProseMirror) so typing is never hijacked; `Ctrl+K`
  works everywhere. Implemented as a pure predicate
  (`shouldOpenSearch(e, activeElement)`) in a small module so it's unit-testable,
  wired via one `window` keydown listener.
- **Recents when empty:** with an empty query the modal lists "Recently
  viewed" — `getRecent()` ids resolved against `db.pages` (missing ids
  skipped), rendered as normal keyboard-navigable result rows.
- **Create-from-search:** when the trimmed query matches no existing page
  title case-insensitively, append a final selectable row
  `＋ Create page "<query>"` → `pageRepo.create({ title })` → navigate to the
  new page. Explicit user action, so the confirm-before-create convention
  holds.
- Sidebar search box gets a `Ctrl K` kbd hint (right-aligned inside the box).

### 2. Route identity: browse/tag heroes + codex touches

**Problem:** the page view has category-colored identity; browse/tag routes
are a plain title over a grid — every route feels the same.

- **`BrowseGrid` hero header** adopts the `.page-header` identity language:
  3px left accent + ~11% left-to-right `color-mix` wash from `titleColor`,
  the page-type glyph (template `icon`, when the category has one), title,
  and page count. `TagRoute` passes gold + a tag glyph. Presentational change
  inside `BrowseGrid`/its callers; grid and empty states unchanged.
- **Drop caps:** `::first-letter` of the first paragraph of the article body,
  **view mode only** (scoped by the read-only editor wrapper), Cinzel, accent
  color, ~3 lines tall (`initial-letter` with float fallback). Pure CSS.
- **Article `h2` underline:** reuse the Home-section gradient gold underline
  (`border-image` accent→border fade) on `.ProseMirror h2` so section rhythm
  matches across the app.

### 3. Timeline spine (vertical view)

**Problem:** the list view is cards with era dividers — nothing reads as a
*timeline*. (Category filtering already exists in the toolbar.)

- Restructure `TimelineVertical` rows into a `[date gutter | spine | card]`
  grid: a continuous vertical line through each era group, a node per event
  on the spine (event `icon` when set, else a dot), and the formatted date in
  the left gutter (removed from the card header). Era dividers stay.
- Data flow (`events`, `calendars`, `displayCalendar`, `onEdit`) unchanged;
  markup + CSS only. `TimelineHorizontal` untouched.

### 4. Graph minimap (closes #128)

**Problem:** zoomed/panned users lose orientation in large graphs.

- Small overlay canvas (bottom-right, ~180×130, panel-styled like
  `.map-legend`) inside the graph area: draws every node as a dot scaled to
  the graph's bounding box, plus a rectangle for the current viewport
  (derived from container size + camera transform).
- Click or drag on the minimap pans the main camera (`fg.centerAt()`,
  zoom preserved).
- Redraws on a `requestAnimationFrame` loop while mounted (node counts are
  wiki-scale; cost is trivial). Coordinate math (graph bounds → minimap px,
  minimap px → graph coords, viewport rect) lives in a pure module for tests.
- Ghost nodes drawn hollow/muted like the main view.

## Non-goals

- Full command palette (routes/actions) — future work (bundle C).
- Nested categories (#115), multi-tag AND/OR (#129), shortest path (#127),
  curved links (#122) — stay in the backlog.
- Any change to data model, backups, or the horizontal timeline.

## Testing

- `shouldOpenSearch` predicate: unit tests (inputs, contenteditable, Ctrl+K vs `/`).
- `SearchModal`: recents shown on empty query; create row appears only when no
  exact title match; Enter on create row creates + navigates
  (fake-indexeddb + happy-dom; `afterEach(cleanup)` per house rules).
- Minimap coordinate math: pure-module unit tests (bounds, viewport rect,
  click→graph coords).
- Presentational changes (heroes, drop caps, spine CSS): covered by lint +
  build + existing suites; verified by eye in the dev server.

## Delivery

One PR off a new branch from `main` (`feat/polish-sprint`), label
`version:minor`. Run lint + build + test before claiming done.
