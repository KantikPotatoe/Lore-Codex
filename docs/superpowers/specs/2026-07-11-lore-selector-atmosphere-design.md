# Lore selector atmosphere pass — the illuminated gateway

**Date:** 2026-07-11
**Issues:** #169 (atmosphere pass), #215 (focus ring flattens card radius)
**Status:** Approved

## Goal

Session 3 of the visual-polish program. Session 1 built the quiet-library motion
system (`2026-07-04-motion-system-design.md`, #167, plus the directional
page-transition follow-up #172/#213); session 2 turned the book library into a
shelf of bound books (`2026-07-11-manuscript-atmosphere-design.md`, #168).

The lore selector at `/` is the first screen anyone sees, and it has no
organizing idea — it is a competent generic card grid with a banner on top.
This pass gives it one: **a world card is an arched gateway of tooled
parchment.** Entering a world should feel like an event.

It also fixes **#215**, which is not incidental: the bug flattens the
border-radius of every anchor/button card on keyboard focus, and the arch this
pass introduces is exactly the shape it would destroy.

Personality constraint, unchanged since session 1: **quiet library** —
restrained, bookish, fast, decelerating, never bouncy, never gimmicky.

### "Illuminated" means gold leaf, not glow

The gateway is *illuminated* in the sense a scribe means it — gold leaf, a
tooled border, a decorated initial — **not** in the sense of emitted light. No
`--accent-glow` blooms, no lit seals. On hover the gold does not shine; it
**catches** the light: the rule brightens, the banner drifts, the card lifts.

Every material used here already exists in the app (gold rule, parchment grain,
layered elevation, the motion tokens). This pass introduces **no new material**
and **no new motion token**. That is the test a change must pass to belong here.

## Design

### 1. The gateway card (`.world-card`)

The card is a frame with an arched crown, clipping a banner, standing on a
parchment mat.

**The arch is shallow and elliptical — a load-bearing constraint, not a taste.**
The frame must be `overflow: hidden` to clip the banner to the arch. The card
also carries three corner controls at its top-right (§2). A true semicircular
crown on a ~240px card would consume the whole top-right corner and **clip those
controls in half**. So the crown is an ellipse:

```css
border-radius: 120px 120px var(--radius) var(--radius)
             / 40px  40px  var(--radius) var(--radius);
```

Horizontal radius 120px, vertical 40px — a gentle chapel-window arch. Geometry:
with semi-axes a=120, b=40, a point 12px in from the right edge sits 108px from
the ellipse's centre, so the card's top boundary there has descended only
`40 − 40·√(1 − (108/120)²) ≈ 23px`. An action strip at `top: 32px` clears the
curve with room to spare.

**If the arch is ever deepened, the corner controls must move.** They are
coupled.

Card composition:

- **Tooled gold rule.** An inset `::after` follows the arch — same radii, inset
  by ~8px, `1px solid color-mix(in srgb, var(--accent) 30%, transparent)`. The
  same material as `.book-card`'s spine rule (`index.css:2216`).
- **Grain and elevation.** `.world-card` joins the `.parchment` selector list and
  the `.elevated` selector list, giving it a resting shadow like `.book-card` —
  a gateway is a physical object, not a flat fill. Its existing `:hover` shadow
  overrides the resting one on lift, exactly as `.book-card`'s does.
- **The mat** carries the world name in `var(--display)`, uppercased with
  letter-spacing, and a founded line beneath. The label changes from "Created" to
  "Founded" (the register the gateway is written in), but the date keeps today's
  `new Date(lore.createdAt).toLocaleDateString()` — locale-respecting, and not a
  hand-rolled format string.
- **Active world** keeps `box-shadow: 0 0 0 2px var(--accent)`. `box-shadow`
  follows `border-radius`, so the active ring arcs around the crown for free.
  The "Current" badge stays, restyled onto the mat.

### 2. Banner layer, hover, and the corner controls

**The banner needs its own layer.** Today `.world-card-banner` carries the
`background-image` *and* contains the decorated initial and the "Enter →"
whisper. Scaling that div on hover would scale its text children too. So the
image moves to a dedicated absolutely-positioned child:

```tsx
<div className="world-card-banner">
  <div className="world-card-banner-img" style={lore.banner ? { backgroundImage: `url(${lore.banner})` } : undefined} />
  {!lore.banner && <span className="world-card-initial">…</span>}
  <span className="world-card-enter">Enter →</span>
</div>
```

Only `.world-card-banner-img` takes `transform: scale(1.04)` on hover
(`--dur-3`, `--ease-settle`). One extra DOM node buys a properly composited zoom
with static text over it.

The **decorated initial does not scale** — gold leaf sits still. The "Enter →"
whisper keeps its position at the banner's bottom-right (the corner controls are
top-right, so they never collide).

**Hover is three things at once**, all existing materials: the card lifts 3px,
the arch's gold rule brightens, the banner drifts in. Nothing emits light.

**Corner controls.** Rename / Banner / Delete become icon-only ghost buttons
(`✎ 🖼 ✕`) in a strip at the frame's top-right, over the banner — handling
controls on a photograph, never on the engraved mat. They reuse today's reveal
logic **verbatim**: `:hover`/`:focus-within` on `.world-card`, with the existing
`@media (hover: none) { opacity: 1 }` fallback so they are always visible on
touch. Only position, size, and labels change.

Because they are icon-only they **must** carry `aria-label`s. The labels **name
their world** — `Rename ${lore.name}`, `Change banner for ${lore.name}`,
`Delete ${lore.name}` — because the selector renders N cards: a bare "Rename
world" would repeat identically on every gateway, leaving a screen-reader user
no way to tell which world a control belongs to (and making `getByRole` ambiguous
in tests). This is the pass's one real accessibility obligation and its one real
regression risk (§6).

The `.world-card-name` button stays as the keyboard-reachable "enter this world"
control. `text-transform: uppercase` is presentational, so the button's
accessible name remains the world's true mixed-case name.

### 3. Hero

`Lore Codex` grows from `2.8rem` (44.8px) to `clamp(44px, 6vw, 64px)` in Cinzel,
keeping the existing `0.14em` uppercase tracking. Tagline and the plain 72px gold
hairline (`.lore-hero-rule`) are unchanged.

**No diamond ornament here.** #170's scope explicitly claims "ornamental gold
hairline dividers (thin line with small center diamond)" as *the program's one
decorative flourish*, to be introduced on Home. This pass already introduces an
ornament — the tooled arch — and adding a second would spend #170's flourish
early and leave two decorations competing on the same screen. `.lore-hero-rule`
stays a plain rule; #170 may upgrade it when it lands.

### 4. The add-tile — an unbuilt gateway

`.world-card-add` takes the **same arch geometry and dimensions** as a world
card, but with a dashed border instead of a tooled rule and no mat content: a
doorway not yet raised. It keeps its `＋` glyph, its `:disabled` state while
creating, and its place at the end of the stagger
(`--stagger-i: Math.min(lores.length, 12)`). It is still rendered only when at
least one world exists; with none, the empty state carries the CTA (§5), so the
affordance is never absent.

`.world-card-add` is a `<button>`, which is precisely why #215 must be fixed in
this pass: without it, a keyboard user tabbing to the add-tile would watch the
arch collapse into a 3px-cornered rectangle (§7).

### 5. Empty / first-run state

`.lore-empty` predates the shared `EmptyState` component and is bespoke. It moves
onto `EmptyState`, the same standardization #168 applied to the manuscript
empties. **Copy is preserved verbatim:**

- ornament `❧`
- title "No worlds yet — your stories await."
- the create CTA ("Create your first world")
- the migration hint ("Coming from the browser version? Use **Import World**
  above with a backup file…")

**One wrinkle.** `.empty-state-actions` (`index.css:931`) is `display: flex` in a
**row**, so passing the CTA and the migration hint as `children` would sit them
side by side. The alternative — passing the hint as `message`, which renders
above the actions — would put a paragraph about backup files *above* the primary
"create your first world" button, which is wrong for the overwhelmingly common
case: a brand-new user with no backup at all.

So both go in `children`, with a one-line scoped override:

```css
.lore-empty .empty-state-actions { flex-direction: column; align-items: center; }
```

The component stays shared; the order stays right.

### 6. Units

The `.lore-selector` block (`index.css:1516–1797`) is written entirely in rem —
one of the blocks catalogued by **#216**. Following the #168 precedent (convert
the block you rewrite), this pass converts it: `px = round(rem × 16)`. Note the
trap #216 records: rem resolves against the **16px root**, not against
`body { font-size: 15px }`.

This shrinks #216's remaining sweep. `.empty-state` is already px.

### 7. #215 — the focus ring

A **one-line deletion**. Remove `border-radius: 3px` from the `:focus-visible`
rule at `index.css:58-64`:

```css
a:focus-visible, button:focus-visible, … {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;   /* ← delete */
}
```

That declaration exists to shape the outline. But browsers already draw
`outline` following the element's own `border-radius`, and `outline-offset: 2px`
lifts the ring clear of the element regardless — so it does nothing it was meant
to do. Meanwhile its selector is specificity **0-1-1**, which outranks any
single-class card rule (**0-1-0**), so on keyboard focus it flattens the actual
card.

Deleting it lets the ring follow each element's real shape: `var(--radius)` on
browse cards, the fore-edge asymmetry on book covers, the arch on gateways, the
pill on badges.

**The one thing that changes the other way:** elements with no radius at all
(plain prose links, `.ProseMirror`) get a sharp-cornered ring instead of a
3px-rounded one. That is more correct, and invisible in practice.

This is an app-wide fix, not a selector-local one — it repairs `.browse-card` and
`.book-card` focus rendering too.

## Out of scope

- **Cross-world stats on the card** (page/map/book counts). `Lore`
  (`src/lores.ts:5`) stores only `id`/`name`/`banner`/`createdAt`/`updatedAt`, and
  each world is a **separate IndexedDB** — real counts would mean opening every
  world's `LoreDB` from the front door, which runs Dexie's v12 version ladder for
  every world merely on *visiting* the selector, migrating them all at once
  instead of one at a time on entry. Rejected: too much blast radius for a visual
  pass. The card shows what the registry honestly knows.
- **An honest `updatedAt`.** Today only `renameLore` and `setLoreBanner` touch it,
  so a world written in all week still reads as untouched. Making it mean "last
  edited" means touching every write path in the app. Hence "Founded <createdAt>"
  on the mat, which is true. (These two together are worth a follow-up issue if
  the stats line is ever wanted.)
- The diamond-ornament divider (#170's flourish — see §3).
- The rest of the rem → px sweep (#216) beyond the `.lore-selector` block.
- The remaining atmosphere pass: settings and templates (#171).

## Testing & verification

**Existing tests must stay green without edits.** `LoreSelectorRoute.test.tsx`
covers only the import wizard, locating controls by accessible name — "Import
World", "World name", "Import world", "Could not import". None of those change.
If one goes red, that is a signal the change drifted, not a licence to edit the
assertion.

**New coverage.** The pass is ~95% CSS, so the tests are few but pointed:

- **Corner controls expose accessible names that identify their world.** The
  three actions become icon-only, so
  `getByRole('button', { name: /rename the westerlands/i })` (and Banner, Delete)
  must resolve. An icon button silently losing its label is exactly the bug this
  refactor could ship, and it is invisible to the eye.
- **Add-tile renders only when `lores.length > 0`**, and the empty state only
  when it is `0`.

**Manual.** Hover and keyboard-focus a gateway (confirm the ring follows the arch
rather than flattening it — the #215 fix), the add-tile, the corner controls, the
empty state; verify the banner zoom leaves the initial and "Enter →" static;
spot-check with devtools reduced-motion emulation (the global clamp should zero
the drift and the stagger).

`npm run lint`, `npm run build`, `npm run test:run` all green before done.

Single PR, label `version:minor`, closing **#169** and **#215**.
