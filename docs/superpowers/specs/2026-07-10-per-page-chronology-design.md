# Per-page chronology — design

Issue: [#177](https://github.com/KantikPotatoe/Lore-Codex/issues/177) · effort:medium · `version:minor`

## Problem

The timeline is a global view. A worldbuilder mostly wants the entity-scoped one:
what happened to *this* character, what befell *this* city over the centuries. The
data to answer that already exists — `TimelineEvent` carries both a `pageId` ref and
a rich-text `description` full of wiki links — but nothing on the page surfaces it.
This is the wiki↔timeline integration World Anvil does well and local tools skip.

## What we build

A **History** panel on the page aside, beside TOC / Infobox / Backlinks / Appears-in:
every timeline event that references this page, in chronological order, each row
deep-linking to that event on the timeline.

## Definitions

These are the load-bearing decisions; everything else follows from them.

| Term | Definition |
|---|---|
| **Linked** | `event.pageId === page.id`. The curated reference `EventEditor` writes. Survives a page rename, because it stores an id. |
| **Mention** | The page's title appears among `wikiLinkTitles(event.description)`, compared trimmed and lowercased. The incidental reference, written while describing the event. |
| **Match** | Either role. An event with both yields **one** row carrying both badges, ordered `['linked', 'mention']`. |

### Why both roles, and why badges

The issue proposed mention-matching only, treating explicit refs as future work.
But `pageId` already exists on `TimelineEvent` (`db/types.ts:156`, "Linked lore page
stored id, like `MapPin.pageId`") and `EventEditor` already writes it. Matching on
mentions alone would silently omit every curated ref; matching on refs alone would
show an empty History for a character named in ten battle descriptions. Taking both
and labelling each row is what `sceneAppearances()` already does for scenes
(`db/manuscript.ts:257-265`), and users read the badge to know which kind of
connection they are looking at.

### Chronology spans calendars

A world may hold several calendars, and every event's `startAbsolute` maps onto the
one shared absolute-day axis (`src/calendar.ts`). So all matching events merge into a
single list sorted by `startAbsolute`, regardless of calendar. Each row renders its
date through **its own** calendar's `formatDate()`. Grouping by calendar was rejected:
it breaks the single chronological read that is the point of the panel. Restricting
to the default calendar was rejected: it drops events with no indication, the exact
class of silent omission `/health` (#179) exists to catch.

## Architecture

### The pure core — `src/pageChronology.ts`

```ts
export type ChronologyRole = 'linked' | 'mention'

export interface ChronologyEntry {
  event: TimelineEvent
  /** null when the event's calendar has been deleted. */
  calendar: Calendar | null
  /** 'linked' before 'mention' when both apply. Never empty. */
  roles: ChronologyRole[]
}

export function pageChronology(
  pageId: string,
  title: string,
  events: TimelineEvent[],
  calendars: Calendar[],
): ChronologyEntry[]
```

Pure — no React, no database reads — mirroring `computeWorldHealth(pages)` and
`buildGraphData(pages)`.

It lives at `src/`, not `src/db/`, and the distinction is deliberate. `worldHealth.ts`
sits in `db/` because it needs `linkedTitlesRawCached` and `pageStatus` as *runtime*
imports, which would drag the Dexie singleton into any module that touched it.
`pageChronology` imports `wikiLinkTitles` from `src/html.ts` (already pure) and takes
`TimelineEvent` / `Calendar` as `import type` (erased at compile time). Nothing pulls
in `db`, so `src/` is correct — the same reasoning that puts `rediscovery.ts` there.

Consequently it is **not** re-exported from the `db/` barrel and does not join
`barrel.test.ts`'s expected surface.

**Sort:** `startAbsolute` ascending, ties broken by `event.title` so the order is
stable across renders and test runs.

**Cost:** `wikiLinkTitles` runs a `DOMParser` parse per event on every `db.events`
change. It early-outs on `!html.includes('data-wikilink')`, so the realistic cost for
most descriptions is a substring scan. Left unmemoized, matching how `getBacklinks()`
already scans every page. If a profile ever disagrees, `linkedTitlesCache`
(`db/pages.ts:260-288`) memoizes exactly this parse keyed by `(id, updatedAt)`, and
`TimelineEvent` carries both fields.

### The component — `src/components/PageHistory.tsx`

Sibling to `Backlinks.tsx` and `SceneAppearances.tsx`, mounted after them in
`PageRoute`'s `.page-aside`. Quiet when empty (`return null`), rendered in both view
and edit mode — consistent with both neighbours.

```tsx
const events    = useLiveQuery(() => db.events.orderBy('startAbsolute').toArray(), [])
const calendars = useLiveQuery(() => db.calendars.toArray(), [])
const entries   = useMemo(
  () => pageChronology(pageId, title, events ?? [], calendars ?? []),
  [pageId, title, events, calendars],
)
```

Each row shows:

- the start date via `formatDate(cal, …, { showEra: false })` — the era is noise at
  aside width — plus `— <end date>` when `endYear != null`
- the event `title`, and its `icon` when set
- role badges, reusing the `.appears-in-role` treatment
- the calendar name **only** when the visible entries span more than one calendar,
  so single-calendar worlds stay clean

Header reads `History` with the total count in a `.backlinks-count` span.

**Volume.** Render the first 8 entries; when there are more, a `.ghost-btn` reading
`Show all 23` flips local state to reveal the rest. The cap is a UI affordance, not a
silent truncation — the header count is always the true total.

Rows are `<Link to={`/timeline?event=${event.id}`}>`, matching how `SceneAppearances`
links to `/book/:bookId?scene=:sceneId`.

### The deep link — `/timeline?event=<id>`

`TimelineRoute` gains what `MapRoute` already has for `?pin=` (`MapRoute.tsx:34-49`):

```tsx
const [searchParams] = useSearchParams()
const focusEventId = searchParams.get('event')
```

When `focusEventId` resolves against the live `events` array:

1. `setDisplayCalId(event.calendarId)` — show it in its own reckoning
2. `setView('vertical')` — the axis view has no stable scroll target
3. clear `categoryFilter` if it would hide the event — otherwise we scroll to a row
   that was never rendered
4. `scrollIntoView({ behavior: 'smooth', block: 'center' })` once that state settles
5. flash a highlight that fades after ~2s, leaving no permanent state

A stale or deleted id resolves to nothing and no-ops, exactly as `focusPinId` does.

`TimelineVertical` needs two additions: `id={`tl-event-${event.id}`}` on the existing
`.tl-row` div (currently keyed but not identified, `TimelineVertical.tsx:89`) as the
scroll target, and a `focusEventId?: string` prop that adds `.is-focused` for the
highlight animation.

## Edge cases

| Case | Behaviour |
|---|---|
| Event's calendar deleted | `calendar: null`. The row keeps its sort position (`startAbsolute` is cached on the event, independent of the calendar) and renders its date as `—`. No throw. |
| `yearLength === 0` | Already guarded inside `absoluteToDate`; `formatDate` still returns a string. |
| Event both links and mentions | One row, `roles: ['linked', 'mention']`. |
| Page has no matching events | Panel renders nothing at all. |
| Page renamed | `renamePage()` rewrites the `data-title` attribute on wiki-link anchors in page bodies, infobox refs, manuscript scenes **and** timeline-event descriptions (`db/pages.ts:205-208`), so both `linked` rows (id-based) and `mention` rows (title-based) survive a rename. |

## Out of scope

- **Lifespan.** The issue mentions showing a character's lifespan. There is no
  birth/death event kind in the data model, so any lifespan would be guesswork.
- **Event→page refs beyond `pageId`.** A multi-ref cast list on events (the way
  `Scene` carries `castPageIds`) is a data-model change, not this panel.

## Testing

`src/pageChronology.test.ts` — plain Vitest over object literals. No `fake-indexeddb`
(the function never touches Dexie) and no jsdom pragma (`wikiLinkTitles` needs only
`DOMParser`, which happy-dom supplies; the pragma is a DOMPurify concern).

Cases:

- ref-only match yields `roles: ['linked']`
- mention-only match yields `roles: ['mention']`
- an event that does both yields exactly one row with both roles, `linked` first
- title comparison ignores case and surrounding whitespace
- an event referencing neither yields no row
- events from two calendars with different `anchor`s interleave correctly by `startAbsolute`
- identical `startAbsolute` ties break by `title`, stably
- an event whose `calendarId` resolves to nothing yields `calendar: null` and does not throw

## Files

| File | Change |
|---|---|
| `src/pageChronology.ts` | new — pure matcher |
| `src/pageChronology.test.ts` | new — unit tests |
| `src/components/PageHistory.tsx` | new — aside panel |
| `src/routes/PageRoute.tsx` | mount `<PageHistory>` in `.page-aside` |
| `src/routes/TimelineRoute.tsx` | read `?event=`, focus calendar/view/scroll |
| `src/components/TimelineVertical.tsx` | row `id`, `focusEventId` prop, `.is-focused` |
| `src/index.css` | `.page-history` styles + `.is-focused` flash |
| `CLAUDE.md` | document the panel and the `?event=` deep link |
