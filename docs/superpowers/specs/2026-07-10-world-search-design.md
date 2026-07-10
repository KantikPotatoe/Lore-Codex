# Search the whole world — index events, map pins, regions, and scenes

**Issue:** [#176](https://github.com/KantikPotatoe/lore-app/issues/176)
**Date:** 2026-07-10
**Status:** approved, ready to plan

## Problem

FlexSearch indexes wiki pages only. Timeline event descriptions, map pin and region
labels, and manuscript scene prose are invisible to `SearchModal`. In an encyclopedic
world, "I know I wrote about this somewhere" failing on an event description erodes
trust in the front door.

## Goal

Extend the incremental index to cover timeline events, map pins, map regions, and
manuscript scenes. Results present as one flat relevance-ranked list with a type badge
per row, each navigating to the correct target.

## Corrections to the issue text

Recorded because the issue's premises shaped its effort estimate:

- `MapPin` and `MapRegion` have **no `note` field** — only `label`. There is no pin
  note to index.
- `LorePage`, `TimelineEvent`, and `Scene` carry `updatedAt`; **`MapPin` and
  `MapRegion` do not**. So pins and regions need a change signal that isn't `updatedAt`.
  And even events, which have `updatedAt`, need more than it — see below.
- Navigation targets mostly exist already: `/map?pin=<id>`, `/timeline?event=<id>`,
  and `/book/:bookId?scene=<id>` are live. Only `?region=` is new.
- `MapView` already supports `FocusTarget { kind: 'region' }` (pans via `fitBounds`)
  and `MapRoute` already has `focusRegion()` and `selectedRegionId`. The `?region=`
  deep link is a near-mirror of the existing `?pin=` effect.
- `mapRepo` has `getPin` but no `getRegion`.

## Decisions

| Decision | Choice |
|---|---|
| Scope | All four: events, pins, regions, scenes |
| Result layout | Flat, relevance-ranked, with type badges |
| Index topology | **One** shared index, namespaced ids |
| Change signal | Cheap `signature` + lazy `build()`; no schema change |
| Crowding | Per-type reservations, two-pass merge preserving rank |
| Indexed fields | Scene notes + synopsis; event category + date text; pin/region linked page title |

### Why one index

`Index.search()` returns `Id[]` — ids in relevance order, **with no scores attached**.
That single fact decides the topology:

- **One index per type** gives five independent orderings with nothing comparable
  between them. Producing one flat ranked list would require inventing a cross-index
  score. Structurally incompatible with the chosen layout.
- **A `Document` index with `tag` filtering** returns results grouped per field, which
  pulls toward the grouped UI we rejected, and solves a filtering problem we do not have.
- **One shared index** yields a single globally-comparable ordering. Per-type caps then
  reduce to an ordered walk that only ever *skips*, never re-sorts.

Cost: `id` is no longer a bare page uuid, so `SearchResult` becomes a discriminated
union on `kind`. `searchPages` has exactly one consumer (`SearchModal`) plus
`src/search.test.ts`, so the blast radius is contained — and the change is wanted
anyway, since the navigation target genuinely differs per type.

### Why signature + lazy build, not `updatedAt` alone

`updatedAt` is insufficient here for two distinct reasons:

1. **Pins and regions don't have it.** Adding it would cost a Dexie schema bump to v13,
   a `CURRENT_SCHEMA_VERSION` bump, a `MIGRATIONS` ladder step to backfill old backups,
   and a change to every pin/region write path.
2. **Even where it exists, a join can invalidate the index without touching it.** An
   event's indexed date text is derived from its *calendar*; rename a month and the
   event's text changes while `event.updatedAt` stands still. A page rename changes a
   pin's indexed text while the pin record stands still. `updatedAt` tracks a record's
   *own* writes, not its joins.

A signature is a string compare over the exact source fields `build()` reads — `O(n)`
memcmp, no DOM parse. It *subsumes* `updatedAt` (a record whose own fields are all it
reads uses `String(updatedAt)` as its signature) and it extends cleanly to the joined
fields that `updatedAt` can't see. One mechanism, uniform across all five kinds.

## Architecture

Three modules, split so the expensive and subtle logic is pure and testable without
Dexie or FlexSearch.

### `src/search.ts` — pure (type-only db imports, as today)

Owns index lifecycle and querying. Never learns what a `TimelineEvent` is.

```ts
export type SearchKind = 'page' | 'event' | 'pin' | 'region' | 'scene'

export interface IndexEntry {
  id: string        // bare uuid
  signature: string // cheap change signal — never parses HTML
  /** Called ONLY on a signature miss. */
  build(): {
    text: string          // what FlexSearch indexes
    snippetSource: string // what the query-time snippet is cut from
    meta: ResultMeta      // everything the row renders except the snippet
  }
}

export function syncSlice(kind: SearchKind, entries: IndexEntry[]): void
export function searchAll(query: string): SearchResult[]
export function applyCaps(ranked: string[], quotas: Record<SearchKind, number>, limit: number): string[]
export function highlightSnippet(snippet: string, query: string): string // unchanged
```

`buildIndex` and `syncIndex` are **removed**, superseded by `syncSlice`. `searchPages`
is **renamed** to `searchAll`.

Internally one `Index` keyed `` `${kind}:${id}` ``, and one
`store: Map<key, { signature, snippetSource, meta }>`. A private `keyKind(key)` reads
the prefix. `syncSlice` diffs **only within its own kind prefix**.

**Why `build()` returns `snippetSource` and `meta` rather than a finished
`SearchResult`:** the snippet is *query-dependent* — today's `searchPages` computes it
per query via `extractSnippet(entry.body || entry.summary, query)`. Indexing time does
not know the query. So `build()` stores the text to cut from, and `searchAll` composes
the final result:

```ts
type ResultMeta =
  | { kind: 'page';   id: string; title: string; category: string }
  | { kind: 'event';  id: string; title: string; subtitle: string }
  | { kind: 'pin';    id: string; title: string; subtitle: string }
  | { kind: 'region'; id: string; title: string; subtitle: string }
  | { kind: 'scene';  id: string; title: string; subtitle: string; bookId: string }

type SearchResult = ResultMeta & { snippet: string }
```

### `src/searchEntries.ts` — new, pure (type-only db imports)

Adapters from records to `IndexEntry[]`, one per slice. Home of `stripHtml`,
`formatDate`, the joins, `calendarSignature()`, and `resultHref()`. Never learns that
FlexSearch exists.

### `src/searchSync.ts` — new, runtime db import

Exports `installSearchIndex(): () => void`, owning the four `liveQuery` subscriptions
and returning an unsubscribe-all. The only module here that touches Dexie. Sits at
`src/` alongside the existing runtime-db modules `backup.ts`, `snapshots.ts`,
`settings.ts`. `App.tsx`'s current index `useEffect` body collapses to one call.

### Repo seam

Add `mapRepo.getRegion(id): Promise<MapRegion | undefined>`, mirroring `getPin`.
Needed by the `?region=` deep link; nudges [#186](https://github.com/KantikPotatoe/lore-app/issues/186) forward.

## Data flow

Four subscriptions (pins and regions share one, since they share joins):

| Subscription | Reads | Feeds |
|---|---|---|
| pages | `pages` | `syncSlice('page', …)` |
| events | `events`, `calendars` | `syncSlice('event', …)` |
| map | `pins`, `regions`, `pages`, `maps` | `syncSlice('pin', …)` + `syncSlice('region', …)` |
| scenes | `scenes`, `chapters` | `syncSlice('scene', …)` |

### The signature invariant

> **A slice's `signature` must cover every field its `build()` reads** — not only the
> fields feeding indexed `text`, but also those feeding `snippetSource` and the
> displayed `meta`.

Violating it makes the index silently serve stale rows. The joins are what force it:

- **Event date text.** `formatDate(cal, y, m, d)` reads the calendar's month names and
  eras. Rename a month and the event's indexed date text changes *while the event
  record is untouched*. The event signature therefore folds in a
  `calendarSignature(cal)` (month names + era names/startYears), not just `calendarId`.
- **Pin/region page title.** Rename a page and the pin's indexed text changes though
  the pin record is untouched. The signature carries the *resolved* page title, not
  `pageId`.
- **Pin/region map name.** Map name feeds `meta.subtitle`, not `text` — by the
  invariant it still belongs in the signature.

### Signatures

```
page   →  String(updatedAt)                                       // no join; own fields only
event  →  [updatedAt, calendarId, calendarSignature(cal)].join('\0')  // updatedAt covers own fields; calendar is the join
pin    →  [label, mapId, mapName, pageTitle ?? ''].join('\0')     // no updatedAt on the record
region →  [label, mapId, mapName, pageTitle ?? ''].join('\0')
scene  →  [updatedAt, chapterTitle, chapterOrder].join('\0')      // updatedAt covers own fields; chapter is the join
```

`updatedAt` is not privileged. It is the cheapest valid signature *for the record's own
fields*, so where it exists (page, event, scene) it stands in for the whole record —
and the joined fields (event → calendar, scene → chapter) are appended because
`updatedAt` cannot see them. Pins and regions have no `updatedAt`, so they list their
own fields explicitly. Same rule throughout: the signature covers exactly what
`build()` reads.

### Indexed text

| Kind | `text` |
|---|---|
| page | title + summary + tags + `stripHtml(content)` *(unchanged)* |
| event | title + `stripHtml(description)` + category + formatted date |
| pin | label + linked page title |
| region | label + linked page title |
| scene | title + synopsis + notes + `stripHtml(content)` |

Map name is **display-only** (`subtitle`), not indexed.

### Accepted costs

- The map slice subscribes to `pages`, so every page edit re-runs it. Acceptable: the
  signature compare is over short label strings and never parses HTML, so the expensive
  `stripHtml` in `build()` stays gated.
- The events slice subscribes to `calendars`, so a calendar edit re-runs it. Acceptable
  for the same reason: `calendarSignature(cal)` is a concat of month and era names, no
  HTML parse, and `build()`'s `stripHtml(description)` only fires when `updatedAt` or
  the calendar signature actually moved.

## Result shape and navigation

`SearchResult = ResultMeta & { snippet: string }`, as defined above. `resultHref(r)` is
pure, one arm per kind:

| kind | target | subtitle |
|---|---|---|
| page | `/page/:id` | — (category drives the colored dot) |
| event | `/timeline?event=:id` | formatted in-world date |
| pin | `/map?pin=:id` | map name |
| region | `/map?region=:id` | map name |
| scene | `/book/:bookId?scene=:id` | chapter title |

Snippet source per kind: page → stripped body (falling back to summary); event →
stripped description; pin/region → label; scene → stripped content.

## The caps algorithm

Naive hard caps would regress the app's most-used path: with `page: 8`, a query
matching only pages would return 8 results where today it returns 20. Crowding only
exists when types *compete*, so quotas are **reservations, not a budget**.

`applyCaps` is two-pass over the single ranked id list:

1. **Reservation pass** — walk in rank order; take a hit if its kind is under quota
   *and* fewer than `limit` are collected. Guarantees every type its seats when types
   compete. (The `limit` check matters: quotas sum to 26, above the limit of 20.)
2. **Backfill pass** — if fewer than `limit` collected, walk again in rank order taking
   anything still unclaimed, ignoring quotas, until `limit`.

Rank is never re-sorted; both passes only skip. Therefore:

- Only pages match → pass 1 yields 8, pass 2 backfills to 20 pages. **Identical to today.**
- Everything matches → each type gets its guaranteed seats, nothing drowns.

Quotas: `page 8, event 5, scene 5, pin 4, region 4` (sums to 26 > 20 deliberately).
Pool: `search(query, 60)`, so pass 2 has material.

`applyCaps` is pure over `(string[], Record<SearchKind, number>, number)` — the single
highest-value unit test in this change, needing neither FlexSearch nor Dexie.

## SearchModal

- `Row` becomes `SearchResult | { kind: 'create' }`. The flat `rows` array and existing
  keyboard nav survive untouched — the payoff of the flat-list choice.
- Pages keep their category dot; other kinds render a type badge.
- `showPageHover` fires only for `kind === 'page'` (the popover fetches a page).
- The "create page" row still keys off an exact-title match against **pages only**.
- Empty-query recents stay pages-only.

## Error handling and edge cases

**Broken joins degrade, never drop.** A missing join must never make a record invisible
to search — that is the exact trust failure this issue exists to fix.

- Event whose `calendarId` resolves to nothing → indexed without date text, empty
  subtitle. (Calendar deletion cascade-deletes its events; this is defensive.)
- Pin/region whose `pageId` points at a deleted page → `pageTitle` is `''`; the record
  stays findable by label.
- Scene whose chapter is missing → empty subtitle, scene still indexed.

**Slice isolation.** `syncSlice(kind, [])` removes every key with that prefix and
nothing else. This is what lets four independent subscriptions write one shared index
without racing, and what makes "delete the last event" correct rather than catastrophic.

**Stale deep links.** `/map?region=<deleted>` no-ops exactly as `?pin=` does today.

**Cold query.** `searchAll` before any slice has synced returns `[]`; the index is
created lazily on first `syncSlice`.

**Lore switch.** Module-level index state is discarded by the `window.location.reload()`
that `switchLore()` already performs. No new teardown.

**Subscription failures.** `liveQuery` rejections land on `window.unhandledrejection`,
already hooked by `installStorageErrorListener`. No new error surface.

### Security

Today the only untrusted text reaching `dangerouslySetInnerHTML` is a page snippet, and
`highlightSnippet` escapes it. This change routes four new sources into that same sink —
event descriptions, pin/region labels, scene content, scene notes — any of which can
carry `<img onerror=…>` typed literally or delivered by an imported backup.

1. **Snippets** keep flowing through `highlightSnippet`, which escapes every run via
   `escapeHtml` (`src/html.ts`). Covered today by the `<img src=x onerror=…>` case in
   `search.test.ts`; extend with the new sources.
2. **`subtitle` is a brand-new rendered field. It renders as a plain React child —
   never `dangerouslySetInnerHTML`.** Stated explicitly because the field sits inches
   from a `dangerouslySetInnerHTML` in the same JSX block.

## Testing

Weight goes to the pure logic, not the DOM.

**`src/search.test.ts`** (extend; existing `buildIndex`/`syncIndex` tests migrate to `syncSlice`)
- `applyCaps`:
  - page-only ranked list of 30 → 20 pages in rank order *(guards the today-behavior regression)*
  - all five kinds competing → each gets ≥ its quota, total 20, output is a subsequence of input rank
  - fewer than `limit` total hits → returns all, no padding
- `syncSlice` prefix isolation: sync events, then `syncSlice('event', [])` → pages still searchable.
- **Signature gating:** entry whose `build()` is a spy; re-sync with an unchanged
  signature asserts `build` was **not** called; change the signature and assert it was.
  This pins the performance claim instead of asserting it in a comment.
- `highlightSnippet`: new cases for an event description and a pin label carrying
  `<img src=x onerror=…>`.

**`src/searchEntries.test.ts`** (new; pure, no db, no index)
- Event date text comes from the right calendar; `calendarSignature` changes when a
  month is renamed but the event record is not *(this test fails under a naive
  `calendarId`-only signature — the subtle bug the invariant exists to prevent)*.
- Pin entry resolves the linked page's title into `text`; map name lands in `subtitle`,
  not `text`.
- Scene entry includes title + synopsis + notes + stripped content.
- Every broken-join fallback above: orphan event, dangling `pageId`, missing chapter —
  each still produces an entry.
- `resultHref` — one assertion per kind.

**`src/components/SearchModal.test.tsx`** (extend)
- A row of each kind renders its badge and navigates to the right target on click/Enter.
- `showPageHover` fires for a page row and not for an event row.
- The "create page" row still appears when no page title matches exactly, even when
  non-page hits are present.

**`src/routes/MapRoute.test.tsx`** (new — there is no MapRoute test today, though six
other routes have one)
- `?region=<id>` selects the region and sets a `FocusTarget`; a stale id is a silent no-op.

Environment notes, per the repo's rules: these tests are pure or happy-dom, so no
`// @vitest-environment jsdom` pragma is needed (that is only for DOMPurify, untouched
here). Any test rendering a `useLiveQuery` component needs `afterEach(cleanup)`.

**Not tested, deliberately:** FlexSearch's own ranking quality. We assert that we
preserve its order, not what its order is — otherwise the suite becomes a
change-detector for a third-party scoring function.

## Out of scope

- Type filter chips / scoping search to one kind. No demand; the caps solve crowding.
- Indexing map names, book titles, chapter titles, or plotline/beat text.
- Changing the empty-query recents list beyond pages.
- Extending the repo seam beyond `mapRepo.getRegion` (that is [#186](https://github.com/KantikPotatoe/lore-app/issues/186)).

## PR label

`version:minor` — new user-facing feature.
