# Manuscript & Book atmosphere pass

**Date:** 2026-07-11
**Issue:** #168
**Status:** Approved

## Goal

Session 2 of the visual-polish program (session 1 = the quiet-library motion
system, `2026-07-04-motion-system-design.md`, merged as #167; the directional
page-transition follow-up landed as #172/#213). The manuscript area is the
weakest CSS in the app: plain panel cards, none of the shared `.parchment` /
`.elevated` language, and the only block in `index.css` still written in rem
while the rest of the file is px.

This pass turns the book library into a **shelf of bound books** — the showcase
item — and sweeps the surrounding manuscript chrome onto the app's shared type,
spacing, and motion vocabulary. It inherits the motion tokens from session 1 and
introduces no new ones.

Personality constraint, unchanged from session 1: **quiet library** — restrained,
bookish, fast, decelerating, never bouncy, never gimmicky.

## Design

### 1. The shelf (`ManuscriptRoute`, `/manuscript`)

Book cards become **portrait covers**: 2:3 aspect ratio, a coloured spine down
the left edge, a Cinzel title centred on a parchment board, a short gold rule,
and the scene/word count at the foot.

The root class stays **`.book-card`** — deliberately not renamed. It is already
listed in the shared stagger selector
(`.browse-card, .book-card, .world-card, .world-card-add`), and
`ManuscriptRoute.test.tsx` locates cards by that class. Renaming would mean
touching both for no gain.

The grid track changes from `minmax(15rem, 1fr)` to
`repeat(auto-fill, minmax(170px, 1fr))`, with the card itself carrying
`aspect-ratio: 2 / 3`, so covers keep book proportions instead of stretching to
fill the row.

**Add-tile.** The header's "＋ New book" button moves onto the shelf as a
`.book-card-add` tile at the end of the row, mirroring `.world-card-add` in the
lore selector exactly: rendered only when at least one book exists, with
`--stagger-i` set to `books.length` so it joins the stagger as the final card.
`.book-card-add` joins the shared stagger selector list. When there are no books,
the empty state carries the create CTA instead (§5), so the affordance is never
absent.

### 2. Cover hue — `src/bookCover.ts` (new pure module)

```ts
export function coverHue(title: string, palette: readonly string[]): string
```

A djb2 hash of the title, indexed into the palette. Deterministic, stable, and
total (the empty string hashes like any other).

**The palette is a parameter, not an import.** `TYPE_COLORS` lives in
`src/db/schema.ts`, which constructs the Dexie `db` singleton at module load — so
importing it would drag Dexie into a presentation helper and force its unit test
onto fake-indexeddb. `ManuscriptRoute` (which already imports from `../db`) passes
`TYPE_COLORS` in and sets `--cover-hue` inline on each card, alongside the
existing `--stagger-i`.

**Leather, not raw palette.** `TYPE_COLORS` entries are bright accents tuned for
small marks (swatches, dots, text) on a dark ground; at spine size they fight the
parchment-and-gold restraint. CSS mixes the hue down into a bookbinding register:

- spine: `linear-gradient(90deg, color-mix(in srgb, var(--cover-hue) 55%, #1a1512), color-mix(in srgb, var(--cover-hue) 30%, #120f0c))`
- board: `background-color: color-mix(in srgb, var(--cover-hue) 7%, var(--panel))`

`color-mix` is already used by `.empty-state`, so this adds no new browser-support
surface (Chrome/Edge 111+, Firefox 113+ — covers both the web target and WebView2).

**Known consequence:** renaming a book re-colours its cover. This is inherent to
deriving identity from the title, and is the accepted cost of adding no field to
`Book`. If authors later want to choose a cover colour, the fix is an optional
`coverColor?: string` on `Book` falling back to `coverHue()` — a clean superset of
this design, not a rewrite.

### 3. The blurb — `Book.synopsis` gets its first editor

`Book.synopsis` exists in the type and in backups, but **nothing in the app can
write it**: `createBook` sets `''`, and its only reader is the book card's
synopsis line, which therefore has never rendered. This pass makes the field real.

- **Book workspace** (`BookRoute`): `.book-head` becomes two rows — title + view
  toggle + compile buttons on the first, a blurb textarea on the second, writing
  through the existing `updateBook(bookId, { synopsis })`.
- **Shelf**: the blurb fades up over the lower part of the cover — the back-of-the-
  book gesture — at `--dur-2` / `--ease-settle`, revealed on **`:hover` and
  `:focus-visible`** (the card is a `<Link>`, so keyboard focus triggers it).

The blurb on the cover is **supplementary, never the only copy**: hover-revealed
content is invisible on touch, so the workspace textarea remains its guaranteed-
readable home. The global `prefers-reduced-motion` clamp already zeroes the fade.

### 4. Workspace & grid sweep — bare rules, no new furniture

The binder, scene editor, scene-meta panel, and plotline grid get **no panels and
no elevation**. They keep today's hairline-rule structure; the pass is limited to
unit normalization, type and spacing rhythm, and hover/press transitions on the
motion tokens.

**This deliberately narrows the issue's own scope line** ("Adopt `.parchment`
grain + `.elevated` shadows across manuscript/book chrome"). Two reasons:

1. Three competing drop shadows in a screen whose job is writing is furniture, not
   atmosphere.
2. Grain only reads on a solid fill. The binder and scene-meta have transparent
   backgrounds sitting on the body gradient; `background-image: var(--parchment-noise)`
   there paints a visible rectangle of noise over the gradient — a dirty patch, not
   material.

So **grain and elevation go where there is material to carry them: the covers.**
`.book-card` joins the `.parchment` selector list and carries the standard
`.elevated` shadow triple plus a hover lift (`translateY(-3px)`, deeper shadow,
`--dur-1`), matching `.browse-card`.

### 5. Units, empty states, motion

- **Units.** The manuscript block in `src/index.css` (currently ~lines 2143–2665)
  converts rem → px throughout — the last rem holdout in the file.
- **Empty states.** All three manuscript empties adopt the shared `EmptyState`
  component: the shelf (with the create-book CTA), the plotline grid, and the
  write view's no-scene-selected pane. Each **keeps its current copy** — "no books
  yet", "no plotlines yet", "select a scene" — so the existing assertions in
  `ManuscriptRoute.test.tsx`, `BookGridView.test.tsx`, `BookRoute.test.tsx`, and
  `BookWriteView.test.tsx` keep matching unchanged. `.empty-hint` survives only for
  genuinely inline hints (sidebar, template rows).
- **Motion.** Nothing new. The shelf stagger already exists; covers reuse it. Hover
  lift and blurb reveal use `--dur-1` / `--dur-2` and `--ease-settle`.

## Out of scope

- Author-chosen cover colours or cover-image upload (see §2 for the upgrade path).
- Any `Book`/`Scene` schema change — this pass adds no field and needs no
  `CURRENT_SCHEMA_VERSION` bump or backup migration.
- The remaining atmosphere passes: lore selector (#169), home (#170), settings and
  templates (#171).

## Testing & verification

- **New:** `src/bookCover.test.ts` — `coverHue()` is deterministic across calls,
  always returns a member of the supplied palette, is stable for the same title,
  and handles the empty string.
- **Extended:** `ManuscriptRoute.test.tsx` (cover sets `--cover-hue`; blurb renders
  when `synopsis` is set), `BookRoute.test.tsx` (the blurb textarea writes
  `synopsis`).
- **Unchanged:** every existing manuscript test should stay green without edits —
  the `.book-card` class and all empty-state copy are preserved for exactly this
  reason. If one goes red, that is a signal the change drifted, not a licence to
  edit the assertion.
- `npm run lint`, `npm run build`, `npm run test:run` all green before done.
- Manual: exercise the shelf (hover and keyboard-focus a cover, add-tile, empty
  state), the workspace blurb, and both book views; spot-check with devtools
  reduced-motion emulation.
- Single PR, label `version:minor`.
