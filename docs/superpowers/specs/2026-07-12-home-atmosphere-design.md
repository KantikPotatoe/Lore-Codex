# Home atmosphere pass — the world's title page

**Date:** 2026-07-12
**Issue:** #170
**Status:** Approved

## Goal

Session 4 of the visual-polish program. Session 1 built the quiet-library motion
system (`2026-07-04-motion-system-design.md`, #167, plus the directional
page-transition follow-up #172/#213); session 2 turned the book library into a
shelf of bound books (`2026-07-11-manuscript-atmosphere-design.md`, #168);
session 3 made the lore selector an arched gateway
(`2026-07-11-lore-selector-atmosphere-design.md`, #169).

Home is where the gateway leads. The organizing idea follows from that: **Home is
the world's title page.** The selector's arch is the cover; this is the leaf you
turn to next, and it should be engraved in the same hand.

It also collects the one behavioural item deferred from the motion-system
spec — the **"Saved" whisper** — because the whisper is the last piece of the
motion vocabulary that was specified but never built.

Personality constraint, unchanged since session 1: **quiet library** —
restrained, bookish, fast, decelerating, never bouncy, never gimmicky.

**No new material and no new motion token.** Everything below is built from the
gold rule, the parchment grain, the layered elevation, the stagger, and the
existing duration/easing tokens. That is the test a change must pass to belong
here — the same test #169 set.

## Design

### 1. Card unification — Home adopts `BrowseCard`

Home's two card grids (Recently edited, Dusty corners) render a bespoke
`.lore-card` inside a `.card-grid`. **Home is the only consumer of both**
(verified: no other `.tsx` references either class). Meanwhile `/browse` and
`/tag` render the shared, polished `BrowseCard`, which already carries the
thumbnail, the status badge, and `--stagger-i`.

Home's grids switch to `BrowseCard` inside a `.browse-grid` div. Note it renders
`BrowseCard` **directly**, not via `BrowseGrid` — that wrapper carries its own
identity hero (accent bar, title, page count), which Home does not want.

`BrowseCard` gains **one optional prop**:

```tsx
export default function BrowseCard({ page, index = 0, meta }: {
  page: LorePage; index?: number; meta?: ReactNode
})
```

`meta` renders beside the status badge. Dusty corners passes
`staleLabel(p.updatedAt)` ("3 months ago"); Recently edited passes nothing, and
the card is byte-for-byte what `/browse` renders. A single optional slot is the
whole cost of consolidation.

**The stagger comes free.** `.browse-card` is already in the stagger selector
list (`index.css:113`) and `BrowseCard` already sets
`style={{ '--stagger-i': Math.min(index, 12) }}`. Passing `index={i}` from
Home's `.map()` is the entire "recently-edited list entrance on the stagger
vocabulary" bullet — no new CSS.

**Deletions this enables:**

- `.lore-card` and its `h3` / `p` / `:hover` rules
- `.card-grid`
- `.card-badges`
- `.card-badge` **drops out of the shared badge rule** (`index.css:389`), which
  is `.card-badge, .category-badge` — `.category-badge` **stays**, `PageRoute`
  renders it.
- `.lore-card` is removed from the `.parchment` selector list (`index.css:125`)
  and the `.elevated` selector list (`index.css:148`). `.ov-card` stays in both.

**The one honest loss.** Today's Home card shows a *labelled* category badge
("Character"); `BrowseCard` conveys category as the tint of the thumbnail
placeholder instead. That is strictly less information. It is accepted because
it is already how `/browse` and `/tag` present a page — the change makes a page
look the same wherever you meet it, and stops Home being the one screen with its
own card.

### 2. The "Saved" whisper (`PageRoute`)

The one JS item. **Signal: `page.updatedAt` advancing while `editing`.**

`PageRoute` writes down many paths — the debounced content writer
(`CONTENT_WRITE_DELAY_MS = 500`), plus immediate writes for summary, status,
category, tags, title rename, and the infobox. Every one of them routes through
`pageRepo.update`, which stamps `updatedAt: now()` (`db/pages.ts:57`). Watching
`updatedAt` therefore covers all of them with **one observer** — the whisper
honestly means *"the page on disk changed"*, not *"your typing landed"*. Hooking
only the content writer would have left status, tags, and infobox edits saving
silently, an indicator inconsistent about what counts as a save.

It needs **no timer and no `useEffect`**, both of which this repo's lint rules
make hostile (`react-hooks` flat-recommended: `set-state-in-effect` is an error,
and the purity rule bans a literal `Date.now()` in render).

**Detection** uses the derive-during-render idiom `PageRoute` already runs for
`prevId` (`PageRoute.tsx:109-114`) — React's documented "adjust state while
rendering" pattern:

```tsx
// `updatedAt` advances on every write to this page, whatever the path (body,
// summary, status, tags, infobox). Any value past the one we arrived with means
// a write landed — so one observer covers every save.
const [seenAt, setSeenAt] = useState<number | undefined>(undefined)
const [savedAt, setSavedAt] = useState<number | null>(null)
if (page && page.updatedAt !== seenAt) {
  // The first observation is the page loading, not a save.
  if (seenAt !== undefined) setSavedAt(page.updatedAt)
  setSeenAt(page.updatedAt)
}
```

Both must reset inside the existing `if (id !== prevId)` block, or the whisper
would fire on arrival at the next page.

**Decay is pure CSS.** No `setTimeout`:

```tsx
{editing && savedAt !== null && (
  <span key={savedAt} className="save-whisper" role="status">Saved</span>
)}
```

```css
.save-whisper {
  font-size: 12px; color: var(--ink-faint); font-family: var(--serif);
  font-style: italic; letter-spacing: 0.02em;
  animation: whisper 1600ms var(--ease-out) forwards;
}
@keyframes whisper {
  0%   { opacity: 0; }
  12%  { opacity: 1; }
  70%  { opacity: 1; }
  100% { opacity: 0; }
}
```

Re-keying on `savedAt` remounts the span, restarting the animation on each
save. **The key is `page.updatedAt` — data read from the record, not a clock
read during render** — so the purity rule is satisfied. The animation ends at
`opacity: 0` and the node is inert, so nothing accumulates.

**Reduced motion.** The global clamp forces animation durations to `0.01ms`,
which would flash the whisper invisibly and lose the information entirely. So it
gets an explicit rule in that media query:

```css
@media (prefers-reduced-motion: reduce) {
  .save-whisper { animation: none; opacity: 1; }
}
```

The whisper then simply *persists* rather than moving — which is honest ("your
last change is saved") and is exactly the reduced-motion contract: no motion, no
loss of meaning. `role="status"` announces it politely on both paths.

**Placement:** inside `.page-header-actions`, before the Edit/Done button. It
renders only in edit mode, so a stray cross-tab write can't whisper at a reader.

### 3. The ornament — a hairline with a centre diamond

The program's one decorative flourish. It is a **separator between Home's
sections**, not a replacement for the section headers' existing left-anchored
gradient underline (`.home-section h2`, `index.css:338-342`). The two do
different jobs — the underline *labels* a section, the rule *closes* one — so
they don't compete, and no working header styling is disturbed.

**Implemented in pure CSS, with no markup at all:**

```css
.home-section + .home-section::before {
  /* Rule-scoped alias: the gold hairline this file already writes inline at
     .book-card's spine and the gateway's tooled rule. Local, not a :root token —
     it exists only to keep the gradient below readable, and names no new material. */
  --rule: color-mix(in srgb, var(--accent) 22%, transparent);

  content: '✦' / '';
  display: block;
  text-align: center;
  font-size: 11px;
  line-height: 1;
  color: color-mix(in srgb, var(--accent) 55%, transparent);
  margin: 44px 0 40px;
  background: linear-gradient(to right,
      transparent,
      var(--rule) 15%,
      var(--rule) calc(50% - 16px),
      transparent calc(50% - 16px),
      transparent calc(50% + 16px),
      var(--rule) calc(50% + 16px),
      var(--rule) 85%,
      transparent)
    center / 100% 1px no-repeat;
}
```

Two details carry it:

- **The hard-stop gap.** The gradient draws a hairline with a 32px hole punched
  in the middle; the glyph sits centred in that hole. That is what gives a real
  line-with-centred-diamond from a single pseudo-element, instead of a line
  running through the glyph.
- **The adjacent-sibling selector does the placement logic.** Home has six
  conditionally-rendered sections (`showAbout`, `showOverview`, `showRecent`,
  `showDusty`, `showOnThisDay`, `showHealth`). `+` guarantees the ornament
  appears **only between two sections that actually rendered** — never above the
  first, never below the last, whatever the user has toggled off. Zero markup,
  zero "is this the first section?" logic in the TSX.

`content: '✦' / ''` supplies empty alternative text so screen readers skip the
decoration. (Supported in the two targets that matter: Firefox and WebView2.
Where unsupported it degrades to announcing a glyph — harmless.)

### 4. Hero — the world's title page

**`h1` takes the engraved treatment, tuned down from the selector's.** The
selector's hero is the fixed short string "LORE CODEX", so it can afford
`clamp(44px, 6vw, 64px)` at `0.14em` tracking. Home's `h1` is *a user's world
name*, which may well be "The Chronicles of the Shattered Kingdoms". Uppercase at
64px with heavy tracking would wrap badly. So:

```css
.home-hero h1 {
  font-family: var(--display);
  font-size: clamp(32px, 4vw, 46px);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
```

Enough to rhyme with the gateway; not enough to break on a long name.
`text-transform` is presentational, so the world's true mixed-case name survives
in the DOM, in the accessible name, and in the customize input's value.

**The customize input matches it.** `.home-title-input` takes the same clamp,
case, and tracking. Without this, clicking "✎ Customize" would visibly jump the
hero's size and case — a wart this pass would otherwise introduce.

**Banner mode gets a real scrim.** Today `.home-hero[style*="background-image"]`
(`index.css:322`) leans on a raw `text-shadow` over the image. Two changes:

- The fragile attribute-substring selector is replaced by an honest
  `.home-hero.has-banner` class, set in `HomeRoute.tsx` from the same
  `activeLore?.banner` condition that sets the inline `backgroundImage`.
- A `::before` scrim — `linear-gradient(to top, rgba(0,0,0,0.72),
  rgba(0,0,0,0.25) 45%, transparent)` — replaces the text-shadow. The hero is
  already `position: relative`; the scrim is absolutely inset with `z-index: 0`
  and the hero's children take `position: relative; z-index: 1`. Add
  `border-radius: var(--radius)` + `overflow: hidden` so the scrim clips to the
  hero.

A scrim reads better than a text-shadow and stays legible over a bright banner,
which a text-shadow does not.

**Stat cards.** `.ov-card` is already on the `.parchment` and `.elevated`
selector lists, so the "shared elevation language" bullet is largely already
satisfied. The polish is one engraved touch: a **gold hairline between the
figure and its label**, the same tooled-rule material, written inline as the
rest of the file writes it:

```css
.ov-label {
  border-top: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
  margin-top: 8px;
  padding-top: 8px;
}
```

No new material, and no hover state — a stat card is not interactive.

### 5. Units and dead code

**Dead CSS, deleted.** `.home-stats`, `.stat`, and `.stat-num`
(`index.css:334-336`) are **verified dead** — they appear nowhere in `src/`
outside `index.css` (checked for bare classes and template-literal class names
alike). The stats Home actually renders are `.ov-card`, which is why the issue's
"stat-card polish" bullet resolves to `.ov-card` in §4.

**rem → px.** Following the #168/#169 precedent — *convert the block you
rewrite* — the Home block's remaining rem values become px
(`px = round(rem × 16)`; note #216's trap: rem resolves against the **16px
root**, not `body { font-size: 15px }`):

| Rule | rem | px |
|---|---|---|
| `.home-hero[style*=…]` padding | `3rem 2rem` | `48px 32px` |
| `.home-banner-controls` gap / margin | `0.5rem` | `8px` |
| `.home-section-sub` margin / size | `-0.25rem 0 0.75rem` / `0.9rem` | `-4px 0 12px` / `14px` |
| `.on-this-day` gap | `0.9rem` | `14px` |
| `.on-this-day` padding | `1rem 1.15rem` | `16px 18px` |

This shrinks #216's remaining sweep.

## Out of scope

- **Settings & Templates atmosphere** (#171) — session 5, its own spec.
- **The rest of the rem → px sweep** (#216) beyond the Home block.
- **Restyling `BrowseCard` itself.** Home adopts it as-is plus one optional
  slot; changing the shared card's look would silently restyle `/browse` and
  `/tag` under the banner of a Home pass.
- **A "saving…" (in-flight) state.** The whisper reports a completed write. A
  pending-state indicator would need the debounce's `pending()` polled, which
  means a timer — the thing §2 is built to avoid — to say something the user
  cannot act on.
- **Reviving `.home-stats`.** It is deleted, not reimplemented; `.ov-card` is
  the stats surface.

## Testing & verification

**Existing tests must stay green without edits.** `HomeRoute.test.tsx` asserts
on *text* (`within(section).getByText('Forgotten Ruin')`, "Dusty corners",
"On this day", "0 broken links"), not on `.lore-card`, so the card swap should
not touch it. No test references `.lore-card` or `.card-grid`. If one of these
goes red, that is a signal the change drifted — not a licence to edit the
assertion.

**New coverage** — the pass is mostly CSS, so the tests are few and pointed:

- **The whisper appears when a write lands while editing, and not before.** The
  one behavioural change, and the one with a real failure mode. Cover: it is
  absent on mount (the first `updatedAt` observation is the page *loading*, not
  a save); it appears after an edit-mode write advances `updatedAt`; it is
  absent in view mode.
- **`BrowseCard` renders its `meta` slot** when given one, and omits the element
  entirely when not — so Recently edited stays identical to `/browse`.
- **Dusty corners surfaces the stale label** through that slot (guards the one
  piece of information the card swap could silently drop).

**Manual.** Toggle each Home section off and on and confirm the ornament never
strands above the first or below the last; check a long world name in the hero
(plain and banner modes); confirm the banner scrim keeps the title legible over
a bright image; enter/leave Customize and confirm the hero does not jump;
spot-check devtools reduced-motion emulation (the whisper should persist,
statically, rather than vanish).

`npm run lint`, `npm run build`, `npm run test:run` all green before done.

Single PR, label `version:minor`, closing **#170**.
