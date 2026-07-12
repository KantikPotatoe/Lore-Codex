# Settings & Templates atmosphere pass — the workshop

**Date:** 2026-07-12
**Issue:** #171
**Status:** Approved

## Goal

Session 5, the final session of the visual-polish program. Session 1 built the
quiet-library motion system (`2026-07-04-motion-system-design.md`, #167, plus the
directional page-transition follow-up #172/#213); session 2 turned the book
library into a shelf of bound books (`2026-07-11-manuscript-atmosphere-design.md`,
#168); session 3 made the lore selector an arched gateway
(`2026-07-11-lore-selector-atmosphere-design.md`, #169); session 4 made Home the
world's title page (`2026-07-12-home-atmosphere-design.md`, #170).

Those four dressed **front-of-house** surfaces — the cover, the title page, the
shelf. You go there to be impressed.

Settings and Templates are **back-of-house**. You go there to change a number and
leave. So the organizing idea is: **these are the workshop.** Same materials as
the rest of the app, applied with restraint. Structure and grouping do the work;
ornament is rationed. A workroom as decorated as the entrance hall reads as
fussy, and heavy styling on a form actively slows down the person using it.

This is a deliberate front-of-house / back-of-house distinction in the program,
not an exhaustion of ideas. The routes are currently the app's plainest screens —
the fix for "plain" here is **better structure, not more gold**.

Personality constraint, unchanged since session 1: **quiet library** — restrained,
bookish, fast, decelerating, never bouncy, never gimmicky.

**No new material and no new motion token.** Everything below is built from the
parchment grain, the layered elevation, the gold rule, and the existing
duration/easing tokens. That is the test a change must pass to belong here — the
same test #169 and #170 set.

## Scope, and the seam with #173

#173 ("Settings Page rework") overlaps this route. The split, agreed at design
time:

- **#171 (this spec) owns how Settings *looks* and is *laid out*.** That includes
  the left-margin fix #173 opens with, because a visual pass cannot honestly
  restyle a route and leave it glued to the sidebar.
- **#173 shrinks to "add these six options"** (load-last-viewed-lore, spellcheck,
  spellcheck language, default folder, theme, backup-on-exit) — functional work,
  dropping into a chassis this pass has already made right.

Doing it in this order means #173 adds controls to a finished structure instead of
this pass restyling markup that #173 is about to rewrite.

### A correction, recorded so it isn't rediscovered

During design it looked as though #170's diamond ornament had leaked into
Settings, since `SettingsRoute` renders `<section className="home-section">` and
the ornament targets `.home-section + .home-section`. **It has not.** The shipped
selector is `.home > .home-section + .home-section::before` (`index.css:396`) —
child-combinator-scoped to `.home`, and Settings' sections live under
`.settings-page`. #170 scoped it correctly.

Settings borrowing `.home-section` is still a coupling worth undoing (§1), but it
is hygiene, not a live bug. Nothing about the ornament changes in this pass.

## Design

### 1. Settings chassis — the route gets a shape

**The bug.** `.settings-page` (`index.css:2311`) sets `max-width: 860px` and
nothing else. `.content` has no padding — every route pads itself (`.home` is
`padding: 48px 40px 80px`, `.templates-view` uses `.content-pad`'s 40px). So
Settings alone has **no padding at all**, and its content sits flush against the
sidebar and the top of the viewport. This is the "Fix let[f] margin" line that
opens #173, and it is closed here.

Settings adopts `.home`'s exact measure, so the two read as the same hand:

```css
.settings-page { max-width: 880px; margin: 0 auto; padding: 48px 40px 80px; }
```

**The sections become cards.** The four `<section className="home-section">` in
`SettingsRoute.tsx` (lines 151, 204, 221, 288) become **`.settings-section`**.
Settings stops borrowing Home's class, so a future Home restyle cannot silently
reach into Settings.

```css
.settings-section {
  background-color: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
  margin-top: 20px;
}
```

and it **joins the `.parchment` and `.elevated` selector lists**, picking up the
paper grain and the layered shadow for free. No new material.

Sections stop being undifferentiated slabs of text because they are now *objects*,
separated by material rather than by whitespace or a decorative rule. That is the
whole of the "sectioned cards with clear grouping" bullet in the issue.

> **`background-color`, never `background:`.** `.settings-section` is a new
> `.parchment` member, which is exactly the trap #218 documented: the shorthand
> resets `background-image` to `none` and silently kills the grain. The hazard
> comment landed on the `.parchment` rule in #218/PR #221 exists to catch this,
> and this is its first customer.

**The header underline is shared, not duplicated.** `.home-section h2`
(`index.css:375`) carries the gold gradient underline. It becomes:

```css
.home-section h2, .settings-section h2 { /* …unchanged… */ }
```

### 2. Danger zone — a light touch, deliberately

The issue asks for "proper danger-zone styling". Asked directly, the user did
**not** flag the danger zone as a pain point — so it gets one line, not a
production. The card's border goes red-tinted so it reads as set-apart without
shouting:

```css
.settings-section.danger-zone {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}
```

The existing `.danger-zone .danger-btn` styling (`index.css:2316-2317`) is already
adequate and **stays as-is**. Deliberately under-built: the delete flow's real
safety is the `ConfirmDialog`, not the button's colour.

### 3. Templates — the editor gets material, the rows get room

**The editor panel is on no material at all.** `.template-editor`
(`index.css:911`) is in neither the `.parchment` nor the `.elevated` list, so it
is a flat box while every comparable panel in the app is a lit surface. It joins
both lists. Its existing `padding: 16px` is fine and stays.

> **It already writes `background: var(--panel)` — the shorthand.** Adding
> `.template-editor` to the `.parchment` list *without* converting that to
> `background-color:` would kill the grain on arrival — #218's trap, sprung for a
> fourth time, in the very pass that documented it. **The conversion is part of
> this change, not an optional tidy.** Same for `.template-item` in the next
> block, which the row-object rule below writes as `background-color` from the
> start.

**The rows are the real fix.** `.template-item` (`index.css:930`) is a bare
`display: flex` line of inputs — the "cramped row editor" the user named as a top
pain point. It becomes a row *object*:

```css
.template-item {
  background-color: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 8px;
}
```

**Hit targets.** The ▲▼ move buttons and the × remove button render as `.tag-x`,
which inside a template row is `padding: 0 4px; font-size: 9px`
(`index.css:932`) — a 9px glyph in a 4px-padded box. Within `.template-item` they
get real padded targets. This is the single biggest usability win in the pass, and
it is the reason the row work outranks anything decorative.

`.template-item.separator` keeps its distinct label styling (`index.css:937`).

### 4. The backup tip — steps, not a wall of prose

The Firefox branch of the backup tip (`SettingsRoute.tsx:272-284`) is a paragraph
with a three-step `<ol>` buried in it — important information, badly presented,
and the third pain point the user named.

The `<ol>` becomes three short labelled steps (a small TSX change plus a
`.backup-steps` rule). Same information, scannable at a glance.

The Tauri branch (`SettingsRoute.tsx:262-270`) is already brief and **stays
prose** — restructuring it would add markup for no gain.

### 5. Motion — none added, on purpose

The issue asks to sweep both routes onto the shared motion language. The obvious
move is to stagger the four Settings cards in on the existing `rise-in` +
`--stagger-i` vocabulary. **This pass declines it.**

A settings form that re-animates its cards on every visit delights once and
irritates on the fiftieth. The route already has an entrance — `.route-fade`, from
the motion system — and that is motion enough for a room you visit to change a
number. "Quieter on purpose" has to mean something, and this is where it bites.

No new motion token, and no new use of an existing one.

**Constraint respected:** the motion-system final review noted that
`.route-fade`'s transform makes it the containing block for fixed-position
descendants during the 240ms entrance. Nothing in this pass is fixed-position.

### 6. rem → px

Following the #168/#169/#170 precedent — *convert the block you rewrite* — the two
rem values in the touched blocks become px (`px = round(rem × 16)`; note #216's
trap: rem resolves against the **16px root**, not `body { font-size: 15px }`):

| Rule | rem | px |
|---|---|---|
| `.snapshot-time` font-size (`:1550`) | `0.9rem` | `14px` |
| `.snapshot-count` font-size (`:1551`) | `0.78rem` | `12.5px` |

This shrinks #216's remaining sweep.

## Out of scope

- **#173's six new options.** Functional work; this pass builds the chassis they
  land in. See "Scope, and the seam with #173".
- **A two-rail Settings layout** (a section-name rail like Templates'). Considered
  and rejected: a rail is *navigation*, and four sections — even eight after
  #173 — do not need navigating at 880px wide. It would add a selected-section
  state and a URL question (`/settings/backup`?) for no gain today. Revisit only
  if Settings grows well past #173.
- **The rest of the rem → px sweep** (#216) beyond these two blocks.
- **Restyling the Templates rail** (`.template-pick`). It is already the best-
  looking thing on either route; leave it alone.
- **Changing the ornament.** See the correction above — it is correctly scoped and
  is not touched.
- **Any change to the delete-world flow.** Visual only.

## Testing & verification

**Existing tests must stay green without edits.** `SettingsRoute.test.tsx` (6
tests) and `TemplatesRoute.test.tsx` (1 test) assert on **text and roles**, not on
class names — verified: neither file references `home-section`, `settings-page`,
`template-item`, or `querySelector`. The `.home-section` → `.settings-section`
rename should therefore be invisible to them. **If one of these goes red, that is
a signal the change drifted — not a licence to edit the assertion.**

**New coverage.** The pass is almost entirely CSS, so the tests are few and
pointed. The one behavioural change is §4:

- **The backup tip renders its three steps** in the browser branch, and the Tauri
  branch still renders its prose. Guards the one piece of markup this pass
  restructures.

**Verification of the CSS itself.** The grain is the one thing here that fails
*silently* (#218's whole lesson). `.settings-section` and `.template-editor` are
new `.parchment` members, so confirm the computed `background-image` actually
resolves to the noise on both — the same check #218 used, rather than trusting the
cascade by eye.

**Manual.** Load `/settings` and confirm the content is no longer flush against
the sidebar; confirm the four cards read as grouped objects; confirm the danger
card is distinguishable but not loud. Load `/templates`, add and remove several
rows, and confirm the ▲▼/× targets are comfortably clickable — that is the pain
point, so it is the acceptance test.

`npm run lint`, `npm run build`, `npm run test:run` all green before done.

Single PR, label `version:minor`, closing **#171**.
