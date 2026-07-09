# World health dashboard — design

Issue: [#179](https://github.com/KantikPotatoe/Lore-Codex/issues/179) · effort:medium · `version:minor`

## Problem

The ingredients of a worldbuilder's to-do list already exist, but they are scattered
as diagnostics inside the graph route: ghost nodes stand in for broken links, the
`HubsOrphansPanel` lists isolated pages, and page status lives on the page card.
Nowhere does the app answer "what needs work in my world?"

## What we build

A `/health` route that reads like a to-do list, and a one-line Home panel that keeps
its counts in daily view:

> 23 broken links · 8 orphans · 14 stubs

## Definitions

These are the load-bearing decisions; everything else follows from them.

| Term | Definition |
|---|---|
| **Broken link** | A distinct page title that is linked to but does not exist. Counted **by missing title**, not by occurrence: a missing `Mordor` referenced from five pages is one broken link. This is the actionable unit — creating one page clears every reference at once — and it matches the graph's one-ghost-per-title model. |
| **Orphan** | A page with **no incoming links**. Nothing else in the world points at it, even if it links outward. This is the wiki-standard meaning and it catches the actionable case: a page you cannot reach by browsing. |
| **Stub** | `pageStatus(page) === 'Stub'`. Note `pageStatus()` defaults to `Draft`, so a page with no status set is **not** a stub. |

### Orphan vs. the graph's "orphans"

`GraphRoute` currently labels `degree === 0` nodes as orphans (`GraphRoute.tsx:124`).
That is a different concept — *isolated*, no links in **or** out — and it is the right
concept for a graph, since those are literally the lone dots on screen. Left as-is.
The panel's heading is renamed **Isolated** (and the toggle button's `☰ Hubs & orphans`
label to match) so the two surfaces stop claiming to measure the same thing with
different numbers. No logic change to the graph.

## Architecture

### The pure core — `src/worldHealth.ts`

A new module at `src/`, alongside `src/rediscovery.ts`, with no React and no Dexie:

```ts
export interface BrokenLink {
  title: string        // as the author typed it — "the Shire", not "The Shire"
  sources: LorePage[]  // pages referencing it
}

export interface WorldHealth {
  brokenLinks: BrokenLink[]  // most-referenced first, then title
  orphans: LorePage[]        // by title
  stubs: LorePage[]          // by title
}

export function computeWorldHealth(pages: LorePage[]): WorldHealth
```

One pass builds a lowercased title→id map. A second walks each page's links: a link
resolving to an existing page marks that page as linked-to; a link resolving to
nothing accumulates a `BrokenLink`. Self-links are dropped on both counts, matching
`buildGraphData` (`graph.ts:85`) — so a page whose only inbound reference is itself
is correctly an orphan.

**Why not derive this from `buildGraphData`?** Its output is lossy for our purposes.
Ghost titles are lowercased on the way in and title-cased on the way out through
`prettyTitle` (`graph.ts:55`), so a link written `[[the Shire]]` returns as
`The Shire` — and the Create action would make a page with the wrong name. Recovering
"no incoming links" would also mean picking apart `source`/`target`/`mutual` on
edges that have already been collapsed to undirected. Reuse lands one level down
instead, at `linkedTitles()`, the primitive that actually encodes what a link is.
The second `O(n)` pass is not worth optimizing away.

### Supporting change — `src/db/pages.ts`

`linkedTitles()` lowercases as it extracts (`pages.ts:224,229`), which is exactly
wrong for the Create action. Split out:

```ts
export function linkedTitlesRaw(page: LorePage): string[]  // author's casing
```

and reimplement `linkedTitles()` as the lowercased `Set` over it. Every existing
caller's behavior is unchanged, and the definition of "what counts as a link" stays
in one place.

Where the same missing title appears with different casing across pages, the first
occurrence in input order wins the display casing. This is deterministic:
`pageRepo.list()` returns a stable order.

**Cost.** `linkedTitlesRaw` is a `DOMParser` body parse per page — the same expense
`getBacklinks` already pays on every page view, which it mitigates with
`linkedTitlesCached`, memoized by `id` + `updatedAt` (`pages.ts:249`). Because the
Home panel means this now runs on Home too, `computeWorldHealth` takes the cached
path. The existing memo is changed to store the raw array, with both the raw list
and the lowercased set derived from it — one cache, not two.

## UI

### `/health` route — `src/routes/HealthRoute.tsx`

Sidebar entry labelled **Health**, placed after Graph: it is an analysis view, Graph's
sibling, and it must stay reachable when the Home panel is toggled off. Not
lazy-loaded — it pulls in no heavy dependencies, unlike the map/graph/book routes.

Reads `useLiveQuery(() => pageRepo.list())` and feeds `computeWorldHealth` through a
`useMemo`, the same shape `GraphRoute` uses for `buildGraphData`. Three sections:

- **Broken links** — one row per missing title, listing the pages that reference it
  as links, plus a **Create** button. It calls `createPage({ title })` (`pages.ts:16`),
  which already resolves the default infobox and does the title-clash check, then
  navigates to the new page.
- **Orphans** — plain list of page links.
- **Stubs** — plain list of page links.

Each empty section gets a quiet `<p className="muted">`, following
`HubsOrphansPanel`'s "Every page is linked. 🎉" rather than the heavyweight
`EmptyState` component.

### Home panel

A new `showHealth` flag on `HomeConfig` (default `true`), alongside `showDusty` and
`showOnThisDay`, with a matching checkbox in the Customize block. It renders a single
line — `23 broken links · 8 orphans · 14 stubs` — linking to `/health`.

- When all three counts are zero it shows an **all-clear line** rather than vanishing.
  A panel that silently disappears is indistinguishable from one you turned off by
  accident.
- The panel is suppressed entirely when the world has **no pages**, so a fresh world
  is not greeted with a health report on nothing.

## Error handling

The one fallible action is Create. `createPage` throws on a title clash, which is
reachable in practice: another tab may have created that page since the live query
last fired. Catch it and surface a `ConfirmDialog` with `hideCancel` — never
`alert()`, per the shell's unreliable host dialogs. The `useLiveQuery` then re-renders
the row away on its own.

## Testing

`src/worldHealth.test.ts`, pure unit tests over hand-built `LorePage[]`:

- Self-links count as neither an incoming link nor a broken link; a page linking only
  to itself is an orphan.
- Infobox `ref` fields are links on both sides — they can create a broken link and
  they can save a page from being an orphan.
- Title matching is case- and whitespace-insensitive (`[[ mordor ]]` resolves to
  `Mordor`); display and creation use the author's original casing.
- Broken-link grouping: five references to one missing title collapse to one row
  carrying five sources.
- Ordering: most-referenced broken link first; orphans and stubs by title.
- First-occurrence casing wins when a missing title is written two ways.
- A page with no status set is not a stub.
- Empty world → three empty lists, no crash.

Plus a `linkedTitlesRaw` test pinning the casing-preservation contract that
`computeWorldHealth` depends on.

No jsdom pragma needed — there is no DOMPurify here, and happy-dom parses the
wiki-link anchors fine. `worldHealth.ts` lives at `src/` like `rediscovery.ts`, so it
is outside the `db/` barrel and `barrel.test.ts` does not apply.

No `HealthRoute` render test: it is presentation over a tested core, and
`useLiveQuery` component tests need the `afterEach(cleanup)` dance to avoid teardown
errors. The route is verified by running the app.

## Shipping

Branch `feat/179-world-health`, PR labelled `version:minor`, body closing #179.

## Out of scope

- A status-filtered browse route. The stub list lives on `/health`; `CategoryRoute`
  stays category-only.
- Bulk-create-all for broken links. Creating pages you have not thought about is how
  a world fills with empty stubs.
- Inline status editing on stub rows.
