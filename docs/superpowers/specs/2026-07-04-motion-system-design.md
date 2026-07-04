# Motion system — quiet-library motion language

**Date:** 2026-07-04
**Status:** Approved

## Goal

The app is visually mature (parchment-and-gold theme, grain, elevation) but
nearly static: one 120ms route fade and a handful of ad-hoc hover transitions
(five different durations, 0.08s–0.15s). Modals — including the search
modal — appear with no entrance; nothing staggers or settles; there is no
press feedback.

This sprint builds one small, consistent motion vocabulary and applies it
app-wide in a single pass. Personality: **quiet library** — motion is fast
(120–240ms), decelerating ("settle"), never bouncy, and never calls attention
to itself. This is session 1 of the broader visual-polish program; per-route
atmosphere passes (lore selector, manuscript, home, settings) follow as
separate specs and inherit this vocabulary.

## Design

### 1. Motion tokens (`:root` in `src/index.css`)

| Token | Value | Use |
|---|---|---|
| `--dur-1` | `120ms` | hover/press feedback |
| `--dur-2` | `180ms` | entrances: modals, popovers |
| `--dur-3` | `240ms` | larger settles: route change, grid stagger |
| `--ease-out` | `ease-out` | feedback transitions |
| `--ease-settle` | `cubic-bezier(0.22, 1, 0.36, 1)` | entrances — fast arrival, long deceleration, no overshoot |

All existing ad-hoc `transition:` durations in `index.css` are normalized onto
these tokens (nearest tier). No behavioral change intended — same properties,
unified timing.

### 2. Entrances

Two shared keyframes:

- `fade-in`: opacity 0 → 1
- `rise-in`: opacity 0 → 1 + `translateY(6px)` → 0

Applied to:

- **Modals** — `.modal-overlay` backdrop fades in (`--dur-2`); `.modal-dialog`
  rises in with `scale(0.98)` → 1 (`--dur-2`, `--ease-settle`). Because
  `ConfirmDialog`, `CalendarEditor`, and `EventEditor` share these classes,
  one CSS change covers all three. `.search-overlay`/`.search-modal` get the
  same treatment via their own selectors.
- **Wiki-link popover** (`WikiLinkPopover`) — fade + 2px rise at `--dur-1`;
  hover UI must feel instant.
- **Staggered grid entrances** — browse cards (`BrowseCard` grid), book cards
  (`ManuscriptRoute` grid), lore-selector cards. Each card runs `rise-in`
  (`--dur-3`, `--ease-settle`) with
  `animation-delay: calc(var(--stagger-i, 0) * 25ms)`. The rendering
  component sets `style={{ '--stagger-i': Math.min(index, 12) }}` per card —
  the cap keeps a 200-card grid from rippling for seconds (cards past 12
  enter together with the last wave). One-line TSX change in each of the
  three components; all other work is pure CSS. Cards must start at
  `opacity: 0` only via the animation's `from` frame (no static
  `opacity: 0` rule), so a failed/cancelled animation still leaves content
  visible.

**Deliberately no skeleton loaders.** Dexie reads are near-instant; skeletons
would add flicker — the opposite of quiet.

### 3. Interaction feedback

- Buttons: `:active { transform: translateY(1px); }` press-down on the shared
  button selectors (compose with any existing hover transform rather than
  overriding it where both apply).
- Card hovers: existing behavior, retimed onto tokens.
- Sidebar collapse: animated chevron rotation (`--dur-1`). Height animation
  only if the current markup makes it trivial; do not restructure for it.

### 4. Route transition

Keep the existing keyed `.route-fade` div in `App.tsx` (works in Firefox and
WebView2; no View Transitions API dependency). Retime: `--dur-3`, 4px rise,
`--ease-settle`. Currently a 120ms flat fade that reads as a flash.

### 5. Reduced motion & accessibility

The existing global `prefers-reduced-motion` clamp (animations/transitions
forced to 0.01ms) automatically neuters everything added here. All entrance
animations end at the element's natural resting state, so content is never
invisible without its animation.

## Out of scope (follow-on sessions)

- "Saved" whisper in the editor header (needs save-flow integration in
  `PageRoute`).
- Manuscript CSS unit normalization (rem → px drift).
- Per-route atmosphere passes: lore selector front door, book-cover cards,
  home, settings/templates, ornamental dividers.

## Testing & verification

- ~95% CSS; no new unit tests (the stagger cap is inline `Math.min`).
- Existing tests must stay green (`npm run test:run`, lint, build).
- Manual verification: exercise all modal types, route changes, and the three
  staggered grids; spot-check with devtools reduced-motion emulation.
- Single PR, label `version:minor`.
