# Lore Selector Atmosphere Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the lore selector at `/` into a grid of arched gateways of tooled parchment, and fix the app-wide focus ring that flattens card border-radius (#215).

**Architecture:** Almost entirely CSS in `src/index.css` plus a markup restructure of one route component (`src/routes/LoreSelectorRoute.tsx`). No new dependencies, no new data, no schema change, no DB reads. The card becomes a frame with a shallow elliptical arch clipping a banner, standing on a parchment mat; three icon-only "handling controls" sit over the banner; the empty state moves onto the shared `EmptyState` component.

**Tech Stack:** React 19 + TypeScript (strict), Vite, plain CSS (custom properties, no preprocessor), Vitest + happy-dom + @testing-library/react.

## Global Constraints

- **Personality: quiet library.** Restrained, bookish, fast, decelerating, never bouncy, never gimmicky.
- **"Illuminated" means gold leaf, not glow.** No emitted light. No `--accent-glow` blooms, no lit seals. On hover the gold *catches* light (a rule brightens), it never *emits* it.
- **No new material and no new motion token.** Only existing ones: `--dur-1` (120ms), `--dur-2` (180ms), `--dur-3` (240ms), `--ease-out`, `--ease-settle`, `--accent`, `--parchment-noise`, `.parchment`, `.elevated`, `var(--radius)` (10px). This is the test a change must pass to belong in this pass.
- **Units are px.** `px = round(rem × 16)`. Trap: rem resolves against the **16px root**, *not* against `body { font-size: 15px }`.
- **No diamond ornament.** The "thin gold line with a small centre diamond" is #170's flourish, reserved for the Home pass. This pass's ornament is the arch. `.lore-hero-rule` stays a plain rule.
- **The card shows no cross-world stats.** `Lore` has only `id`/`name`/`banner`/`createdAt`/`updatedAt`, and each world is a separate IndexedDB. Never open another world's `LoreDB` from the selector — it would run Dexie's v12 version ladder for every world merely on visiting `/`.
- **Existing tests must stay green without edits.** `LoreSelectorRoute.test.tsx`'s four wizard tests locate controls by accessible name — "Import World", "World name", "Import world", "Could not import". None of those change. A red one means the change drifted; it is not a licence to edit the assertion.
- **Copy is preserved verbatim** in the empty state: "No worlds yet — your stories await.", "Create your first world", and the import hint.
- **Every commit runs against a strict TypeScript build.** No `any`, no unused vars.

**Reference spec:** `docs/superpowers/specs/2026-07-11-lore-selector-atmosphere-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/index.css` | All styling. Focus-ring foundations (`:58-64`), `.parchment` list (`:116`), `.elevated` list (`:139`), the `.lore-selector` block (`:1516-1797`) | Modify |
| `src/routes/LoreSelectorRoute.tsx` | Selector markup: hero, gateway cards, add-tile, empty state, wizard modals | Modify |
| `src/routes/LoreSelectorRoute.test.tsx` | Route tests (currently wizard-only) | Modify — add a `gateway cards` describe |

No files are created. No barrel (`src/db/index.ts`) change — this pass adds no public DB API.

---

### Task 1: Fix the focus ring (#215)

A one-line deletion with app-wide reach. It lands first because the arch introduced in Task 3 is exactly the shape this bug destroys.

**Files:**
- Modify: `src/index.css:55-64`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing (a CSS-only behavioural fix). Later tasks rely on it: `.world-card-add` is a `<button>` and `.world-card` an arched frame, both of which this rule would otherwise flatten to a 3px rectangle on keyboard focus.

- [ ] **Step 1: Read the current rule**

Open `src/index.css` and confirm lines 55-64 read exactly:

```css
/* Keyboard focus ring. Only shows for keyboard nav (:focus-visible), never on
   mouse click. Uses outline (not box-shadow) so it survives the overflow:hidden
   panels (infobox, cards) that would clip a shadow ring. */
a:focus-visible, button:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible, summary:focus-visible,
[tabindex]:focus-visible, .ProseMirror:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}
```

- [ ] **Step 2: Delete the `border-radius` and document why it must not come back**

Replace that whole block with:

```css
/* Keyboard focus ring. Only shows for keyboard nav (:focus-visible), never on
   mouse click. Uses outline (not box-shadow) so it survives the overflow:hidden
   panels (infobox, cards) that would clip a shadow ring.

   Deliberately sets NO border-radius (#215). An outline already follows its
   element's own radius, and outline-offset lifts the ring clear regardless — so
   a border-radius here shapes nothing. What it DOES do is win: this selector is
   specificity 0-1-1, which outranks any single-class card rule (0-1-0), so it
   overrode the card itself and flattened .browse-card / .book-card / .world-card
   to 3px corners while focused. Leave it off: the ring now follows each
   element's real shape. */
a:focus-visible, button:focus-visible, input:focus-visible,
select:focus-visible, textarea:focus-visible, summary:focus-visible,
[tabindex]:focus-visible, .ProseMirror:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Verify the build and the suite are unaffected**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass. No test asserts on this rule (it is presentational), so this is a regression check, not a proof.

- [ ] **Step 4: Verify by eye — this is the actual proof**

Run: `npm run dev`, open `http://localhost:5174/#/browse/Character` (any category with pages), and press **Tab** until a `.browse-card` takes focus.
Expected: the gold ring is a **rounded rectangle following the card's 10px radius**, and the card's own corners **do not change shape**. Before this fix, the card visibly collapsed to 3px corners on focus and sprang back on blur.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "fix: stop the focus ring flattening card border-radius (#215)"
```

---

### Task 2: Mechanical rem → px conversion of the `.lore-selector` block

A pure no-op refactor, done **before** any design change so the visual diff in Tasks 3-5 is not buried under unit churn. Nothing here should change a single rendered pixel (barring sub-pixel rounding).

**Files:**
- Modify: `src/index.css:1516-1797` (the `/* ── Lore Selector ── */` block)

**Interfaces:**
- Consumes: nothing.
- Produces: a px-only `.lore-selector` block. Tasks 3-5 rewrite parts of it and must stay in px.

- [ ] **Step 1: Convert every rem value in the block**

`px = round(rem × 16)`. Apply exactly these declaration-level replacements, and change **nothing else**:

| Selector | Old | New |
|---|---|---|
| `.lore-selector` | `padding: 3rem 2rem 5rem;` | `padding: 48px 32px 80px;` |
| `.lore-hero` | `padding: 2rem 0 2.5rem;` | `padding: 32px 0 40px;` |
| `.lore-hero-title` | `font-size: 2.8rem;` | `font-size: 45px;` |
| `.lore-hero-title` | `margin: 0 0 0.5rem;` | `margin: 0 0 8px;` |
| `.lore-hero-tagline` | `font-size: 1.05rem;` | `font-size: 17px;` |
| `.lore-hero-tagline` | `margin: 0 0 1.25rem;` | `margin: 0 0 20px;` |
| `.lore-hero-rule` | `margin: 0 auto 1.5rem;` | `margin: 0 auto 24px;` |
| `.lore-hero-actions .primary-btn` | `font-size: 0.95rem;` | `font-size: 15px;` |
| `.lore-grid` | `gap: 1.25rem;` | `gap: 20px;` |
| `.world-card-initial` | `font-size: 4rem;` | `font-size: 64px;` |
| `.world-card-enter` | `font-size: 0.78rem;` | `font-size: 12px;` |
| `.world-card-body` | `padding: 0.8rem 1rem 1rem;` | `padding: 13px 16px 16px;` |
| `.world-card-body` | `gap: 0.35rem;` | `gap: 6px;` |
| `.world-card-title-row` | `gap: 0.45rem;` | `gap: 7px;` |
| `.world-card-name` | `font-size: 1.02rem;` | `font-size: 16px;` |
| `.world-card-badge` | `font-size: 0.63rem;` | `font-size: 10px;` |
| `.lore-rename-input` | `font-size: 1rem;` | `font-size: 16px;` |
| `.world-card-date` | `font-size: 0.72rem;` | `font-size: 12px;` |
| `.world-card-actions` | `gap: 0.4rem;` | `gap: 6px;` |
| `.world-card-actions` | `margin-top: 0.4rem;` | `margin-top: 6px;` |
| `.world-card-actions .ghost-btn` | `font-size: 0.75rem;` | `font-size: 12px;` |
| `.world-card-add` | `gap: 0.5rem;` | `gap: 8px;` |
| `.world-card-add` | `font-size: 0.9rem;` | `font-size: 14px;` |
| `.world-card-add-icon` | `font-size: 2.2rem;` | `font-size: 35px;` |
| `.lore-empty` | `padding: 4rem 2rem;` | `padding: 64px 32px;` |
| `.lore-empty` | `gap: 1rem;` | `gap: 16px;` |
| `.lore-empty-glyph` | `font-size: 5rem;` | `font-size: 80px;` |
| `.lore-empty p` | `font-size: 1.1rem;` | `font-size: 18px;` |
| `.lore-empty .primary-btn` | `margin-top: 0.5rem;` | `margin-top: 8px;` |

- [ ] **Step 2: Prove no rem survives in the block**

Run: `awk 'NR>=1515 && NR<=1800' src/index.css | grep -n "rem"`
Expected: **no output.** (If the block's line numbers have shifted from Task 1's edit, find it with `grep -n "── Lore Selector" src/index.css` and adjust the range.)

- [ ] **Step 3: Prove it changed nothing visually**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass.

Then `npm run dev`, open `http://localhost:5174/#/`, and confirm the selector looks **exactly as it did before**. This step is the whole point of separating this task: any visible change here is a conversion error, not a design decision.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "refactor: normalize the lore-selector CSS block from rem to px (#216)"
```

---

### Task 3: The gateway card

The centrepiece: markup restructure + the arch. Ends with a working, reviewable card.

**Files:**
- Modify: `src/routes/LoreSelectorRoute.tsx` (the `lores.map(...)` card body, lines ~121-184)
- Modify: `src/index.css` — the `.parchment` list (`:116`), the `.elevated` list (`:139`), and the world-card rules in the selector block
- Test: `src/routes/LoreSelectorRoute.test.tsx`

**Interfaces:**
- Consumes: Task 1's radius-free focus ring (without it the arch flattens on Tab); Task 2's px block.
- Produces: the class names Tasks 4-5 and the CSS rely on — `.world-card` (arched frame), `.world-card-banner`, `.world-card-banner-img` (the zoom layer), `.world-card-initial`, `.world-card-enter`, `.world-card-actions` (now the **corner strip**, repositioned — same class name so its existing `:hover` / `:focus-within` / `@media (hover: none)` reveal rules carry over), `.world-card-action` (a single icon button, replacing `.ghost-btn` here), `.world-card-mat` (renamed from `.world-card-body`), `.world-card-title-row`, `.world-card-name`, `.world-card-badge`, `.world-card-date`.
- The arch geometry `120px 120px var(--radius) var(--radius) / 40px 40px var(--radius) var(--radius)` is reused verbatim by `.world-card-add` in Task 4.

- [ ] **Step 1: Write the failing tests**

Add to `src/routes/LoreSelectorRoute.test.tsx`. First extend the imports at the top of the file — `listLores` joins the existing `../lores` import, and `Lore` is a type-only import (safe: `vi.mock` replaces runtime exports, it does not affect TypeScript types):

```tsx
import { importLoreFromBackup, switchLore, listLores, type Lore } from '../lores'
```

Then, so a `mockResolvedValue` in one test cannot leak into the next, extend the existing `afterEach`:

```tsx
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  // clearAllMocks() clears calls but NOT implementations, so a mockResolvedValue
  // set by one test would leak into the next. Put the world list back to empty.
  vi.mocked(listLores).mockResolvedValue([])
})
```

Then append this describe block to the end of the file:

```tsx
function world(over: Partial<Lore> = {}): Lore {
  const created = Date.UTC(2026, 2, 3)
  return { id: 'w1', name: 'The Westerlands', banner: null, createdAt: created, updatedAt: created, ...over }
}

describe('LoreSelectorRoute — gateway cards', () => {
  it('names each corner control after its world', async () => {
    // The controls are icon-only (✎ 🖼 ✕), so aria-label is their ONLY accessible
    // name — and it must identify the world, because N cards render at once.
    vi.mocked(listLores).mockResolvedValue([world()])
    render(<LoreSelectorRoute />)

    expect(await screen.findByRole('button', { name: /^rename the westerlands$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^change banner for the westerlands$/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^delete the westerlands$/i })).toBeTruthy()
  })

  it('engraves the founding date on the mat', async () => {
    vi.mocked(listLores).mockResolvedValue([world()])
    render(<LoreSelectorRoute />)
    expect(await screen.findByText(/^Founded /)).toBeTruthy()
  })

  // DELIBERATE GREEN-FOREVER GUARD — read this before "fixing" it.
  // This test passes against the OLD code too, and that is the point: it pins a
  // property that must NOT change. The mat uppercases via CSS text-transform,
  // which is presentational, so the accessible name stays what the user typed.
  // It goes red only if someone later "helpfully" uppercases in the TSX with
  // .toUpperCase(), which would corrupt the name for screen readers.
  // It is a regression guard, not a discriminating test for this task — the two
  // tests above are the ones that must go RED before Step 3.
  it('keeps the world name button exposing the true mixed-case name', async () => {
    vi.mocked(listLores).mockResolvedValue([world({ name: 'The Westerlands' })])
    render(<LoreSelectorRoute />)
    expect(await screen.findByRole('button', { name: 'The Westerlands' })).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test:run -- src/routes/LoreSelectorRoute.test.tsx`

Expected: the **first two** new tests FAIL — "Unable to find an accessible element with the role \"button\" and name `/^rename the westerlands$/i`" (today's button is labelled "✎ Rename"), and no `Founded ` text (today it reads "Created …"). The third (mixed-case name) **passes already, by design** — see its comment; it is a regression guard, not a discriminating test. The four existing wizard tests must still PASS.

Do not proceed until those two are genuinely RED. A test that cannot fail against the old code cannot pin the new code.

- [ ] **Step 3: Restructure the card markup**

In `src/routes/LoreSelectorRoute.tsx`, replace the entire `<div key={lore.id} className={...}>…</div>` card (the body of `lores.map`) with:

```tsx
<div
  key={lore.id}
  className={`world-card${isActive ? ' world-card--active' : ''}`}
  style={{ '--stagger-i': Math.min(i, 12) } as CSSProperties}
>
  {/* The gateway. The image sits on its own layer so the hover zoom scales it
      without dragging the decorated initial and the "Enter →" whisper with it. */}
  <div className="world-card-banner" onClick={() => switchLore(lore.id)}>
    <div
      className="world-card-banner-img"
      style={lore.banner ? { backgroundImage: `url(${lore.banner})` } : undefined}
    />
    {!lore.banner && (
      <span className="world-card-initial">{lore.name.charAt(0).toUpperCase()}</span>
    )}
    <span className="world-card-enter">Enter →</span>
  </div>

  {/* Handling controls, over the banner — never on the engraved mat. Icon-only,
      so aria-label is their only accessible name, and it names the world: N
      cards render at once and "Rename world" alone would be ambiguous. */}
  <div className="world-card-actions">
    <button
      className="world-card-action"
      aria-label={`Rename ${lore.name}`}
      title="Rename world"
      onClick={() => startRename(lore)}
    >✎</button>
    <button
      className="world-card-action"
      aria-label={`Change banner for ${lore.name}`}
      title="Change banner"
      onClick={() => openBannerPicker(lore.id)}
    >🖼</button>
    <button
      className="world-card-action danger"
      aria-label={`Delete ${lore.name}`}
      title="Delete world"
      onClick={() => setPendingDelete(lore)}
    >✕</button>
  </div>

  {/* The mat. */}
  <div className="world-card-mat">
    <div className="world-card-title-row">
      {renamingId === lore.id ? (
        <input
          className="lore-rename-input"
          value={renameValue}
          autoFocus
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => commitRename(lore.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename(lore.id)
            if (e.key === 'Escape') setRenamingId(null)
          }}
        />
      ) : (
        <>
          <button
            className="world-card-name"
            onClick={() => switchLore(lore.id)}
            title="Open this world"
          >
            {lore.name}
          </button>
          {isActive && <span className="world-card-badge">Current</span>}
        </>
      )}
    </div>

    <span className="world-card-date">
      Founded {new Date(lore.createdAt).toLocaleDateString()}
    </span>
  </div>
</div>
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run test:run -- src/routes/LoreSelectorRoute.test.tsx`
Expected: all seven PASS (3 new + 4 existing wizard tests untouched).

- [ ] **Step 5: Enlist the card in the shared grain and elevation**

In `src/index.css`, add `.world-card` to the two shared selector lists.

The `.parchment` list (around line 116) becomes:

```css
.parchment,
.infobox,
.lore-card,
.ov-card,
.browse-card,
.book-card,
.world-card,
.modal-dialog,
.sidebar {
  background-image: var(--parchment-noise);
}
```

The `.elevated` list (around line 139) becomes — a gateway is a physical object standing on a shelf, so it needs a resting elevation, exactly as `.book-card` does; its own `:hover` shadow (higher specificity) overrides this on lift:

```css
.elevated,
.lore-card,
.infobox,
.book-card,
.world-card,
.ov-card {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 6px 18px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 6: Write the gateway CSS**

In the selector block, replace every rule from `/* World card */` through `.world-card-actions .ghost-btn { … }` (i.e. the old `.world-card`, `:hover`, `--active`, `-banner`, `-banner::after`, `-initial`, `-enter`, `:hover .world-card-enter`, `-body`, `-title-row`, `-name`, `:hover`, `-badge`, `.lore-rename-input`, `-date`, `-actions`, its reveal rules, the `@media (hover: none)` rule, and `.world-card-actions .ghost-btn`) with:

```css
/* World card — an arched gateway of tooled parchment.

   The crown is a SHALLOW ELLIPSE (120px across, 40px tall), not a semicircle.
   This is load-bearing, not taste: the frame is overflow:hidden so it can clip
   the banner to the arch, and the handling controls sit at the frame's top-right
   — a deeper crown would clip them in half. Geometry: with semi-axes a=120,
   b=40, a point 12px in from the right edge is 108px from the ellipse's centre,
   so the top edge there has descended only 40 − 40·√(1 − (108/120)²) ≈ 23px.
   .world-card-actions sits at top:32px and clears it.
   DEEPEN THE ARCH AND YOU MUST MOVE THE CONTROLS. They are coupled. */
.world-card {
  position: relative;
  border-radius: 120px 120px var(--radius) var(--radius)
               / 40px  40px  var(--radius) var(--radius);
  overflow: hidden;
  /* background-COLOR, never the `background:` shorthand. .parchment (index.css
     ~:116) supplies background-image: var(--parchment-noise), and this rule sits
     ~1450 lines later — the shorthand would reset background-image to none and
     silently wipe the grain. .book-card uses the longhand for exactly this
     reason. */
  background-color: var(--panel);
  border: 1px solid var(--border);
  transition: border-color var(--dur-1) var(--ease-out),
              box-shadow   var(--dur-1) var(--ease-out),
              transform    var(--dur-1) var(--ease-settle);
}

/* The tooled gold rule, following the arch just inboard of the frame. Same
   material as .book-card's spine rule. */
.world-card::after {
  content: '';
  position: absolute;
  inset: 8px;
  z-index: 2;
  pointer-events: none;
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 112px 112px 6px 6px / 32px 32px 6px 6px;
  transition: border-color var(--dur-1) var(--ease-out);
}

.world-card:hover {
  border-color: var(--accent);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  transform: translateY(-3px);
}

/* Hover: the gold CATCHES light. It never emits it. */
.world-card:hover::after {
  border-color: color-mix(in srgb, var(--accent) 70%, transparent);
}

/* box-shadow follows border-radius, so the active ring arcs around the crown for
   free. The elevation triple is repeated here because box-shadow does not stack
   across rules — without it, being active would flatten the card off the shelf. */
.world-card--active {
  border-color: var(--accent);
  box-shadow:
    0 0 0 2px var(--accent),
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 6px 18px rgba(0, 0, 0, 0.28);
}

/* Banner */
.world-card-banner {
  position: relative;
  height: 170px;
  cursor: pointer;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* The image, on its own layer purely so the hover zoom is composited and does
   not scale the text sitting over it. The inline background-image (when the
   world has a banner) overrides this gradient; background-size/-position below
   the shorthand survive either way. */
.world-card-banner-img {
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, var(--panel-2) 0%, var(--bg-2) 100%);
  background-size: cover;
  background-position: center;
  transform-origin: center;
  transition: transform var(--dur-3) var(--ease-settle);
}

.world-card:hover .world-card-banner-img {
  transform: scale(1.04);
}

/* Vignette, so the whisper stays legible over any banner. */
.world-card-banner::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0, 0, 0, 0.4) 0%, transparent 55%);
  pointer-events: none;
}

/* The decorated initial does NOT scale on hover — gold leaf sits still. */
.world-card-initial {
  position: relative;
  z-index: 1;
  font-family: var(--display);
  font-size: 64px;
  font-weight: 600;
  color: var(--accent);
  opacity: 0.4;
  user-select: none;
  line-height: 1;
}

.world-card-enter {
  position: absolute;
  bottom: 10px;
  right: 12px;
  z-index: 1;
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  letter-spacing: 0.06em;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

.world-card:hover .world-card-enter { opacity: 1; }

/* Handling controls, over the banner. top:32px clears the arch — see the
   geometry note on .world-card. z-index 3 puts them above the gold rule (2). */
.world-card-actions {
  position: absolute;
  top: 32px;
  right: 12px;
  z-index: 3;
  display: flex;
  gap: 6px;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out);
}

.world-card:hover .world-card-actions,
.world-card:focus-within .world-card-actions { opacity: 1; }

/* Hover-revealed UI does not exist on touch. */
@media (hover: none) {
  .world-card-actions { opacity: 1; }
}

.world-card-action {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  line-height: 1;
  color: var(--ink);
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 6px;
  transition: background var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out),
              border-color var(--dur-1) var(--ease-out);
}

.world-card-action:hover {
  background: rgba(0, 0, 0, 0.75);
  color: var(--accent);
  border-color: var(--accent);
}

.world-card-action.danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}

/* The mat — engraved parchment. Name and founding date only. */
.world-card-mat {
  position: relative;
  z-index: 1;
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  text-align: center;
}

.world-card-title-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: 100%;
  min-width: 0;
}

/* text-transform is PRESENTATIONAL: the button's accessible name stays the
   world's true mixed-case name. Do not uppercase in the TSX. */
.world-card-name {
  flex: 0 1 auto;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  font-family: var(--display);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink);
  cursor: pointer;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: color var(--dur-1) var(--ease-out);
}

.world-card-name:hover { color: var(--accent); }

.world-card-badge {
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 999px;
  padding: 1px 7px;
  letter-spacing: 0.05em;
  opacity: 0.85;
  text-transform: uppercase;
}

.lore-rename-input {
  flex: 1;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  background: var(--bg-2);
  border: 1px solid var(--accent);
  border-radius: 4px;
  padding: 2px 6px;
  color: var(--ink);
  font-family: inherit;
  text-align: center;
}

.world-card-date {
  font-size: 11px;
  color: var(--ink-faint);
  letter-spacing: 0.04em;
}
```

- [ ] **Step 7: Verify the whole suite**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass.

- [ ] **Step 8: Verify by eye**

Run `npm run dev`, open `http://localhost:5174/#/`. Confirm:
0. **The parchment grain actually survived.** In devtools, inspect a `.world-card` and check its computed `background-image` contains the `--parchment-noise` SVG data URI, **not** `none`. If it is `none`, something re-introduced the `background:` shorthand and silently wiped the grain (see the comment on `.world-card`).
1. Cards have a shallow arched crown with a gold hairline following it.
2. Hover: card lifts, gold rule brightens, banner drifts in — and the initial / "Enter →" **do not scale**.
3. Hover reveals three icon buttons at the top-right, **fully visible, not clipped by the arch**.
4. Tab to a card's name: the focus ring follows the arch (Task 1's fix).
5. The active world's gold ring arcs around the crown, and the card still has its drop shadow.
6. Devtools → Rendering → emulate `prefers-reduced-motion: reduce`: the zoom, lift, and stagger all go flat.

- [ ] **Step 9: Commit**

```bash
git add src/index.css src/routes/LoreSelectorRoute.tsx src/routes/LoreSelectorRoute.test.tsx
git commit -m "feat: world cards become arched gateways of tooled parchment (#169)"
```

---

### Task 4: The add-tile as an unbuilt gateway, and the hero

CSS only. Small, but a distinct reviewable deliverable: the tile must sit in the grid as a *doorway not yet raised*, matching the card it will become.

**Files:**
- Modify: `src/index.css` — `.lore-hero-title`, `.world-card-add`, `.world-card-add-icon` in the selector block

**Interfaces:**
- Consumes: Task 3's arch geometry (reused verbatim) and Task 1's focus fix (`.world-card-add` is a `<button>` — without the fix its arch flattens on Tab, which is the whole reason #215 is bundled into this pass).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Give the hero its display type**

Replace `.lore-hero-title` with:

```css
.lore-hero-title {
  font-family: var(--display);
  font-size: clamp(44px, 6vw, 64px);
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.1;
  margin: 0 0 8px;
}
```

Leave `.lore-hero-tagline` and `.lore-hero-rule` alone. **Do not add a diamond ornament to the rule** — that is #170's flourish (see Global Constraints).

- [ ] **Step 2: Make the add-tile an unbuilt gateway**

Replace `.world-card-add` and `.world-card-add-icon` with — note the `border-radius` is Task 3's arch, character for character, so the tile reads as the same doorway, merely unbuilt:

```css
/* The add-tile: the same gateway, not yet raised. Dashed where the world card is
   tooled; same arch, same footprint (banner 170px + mat ≈ 70px). */
.world-card-add {
  position: relative;
  min-height: 240px;
  border-radius: 120px 120px var(--radius) var(--radius)
               / 40px  40px  var(--radius) var(--radius);
  border: 2px dashed var(--border);
  background: transparent;
  color: var(--ink-faint);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-family: var(--sans);
  font-size: 14px;
  transition: border-color var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out);
}

.world-card-add:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.world-card-add:disabled {
  opacity: 0.5;
  cursor: default;
}

.world-card-add-icon {
  font-size: 35px;
  line-height: 1;
}
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass.

- [ ] **Step 4: Verify by eye**

`npm run dev` → `http://localhost:5174/#/`. Confirm:
1. The add-tile carries the same arch as the world cards and is the same height as them (no ragged row).
2. The wordmark is noticeably larger; shrink the window and confirm the `clamp` scales it down without wrapping or clipping.
3. **Tab to the add-tile** — the focus ring follows its arch and the dashed arch **does not collapse into a rectangle**. This is the #215 payoff.

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "feat: add-tile becomes an unbuilt gateway; hero takes display type (#169)"
```

---

### Task 5: The empty / first-run state

Moves `.lore-empty` onto the shared `EmptyState` component — the same standardization #168 applied to the manuscript empties.

**Files:**
- Modify: `src/routes/LoreSelectorRoute.tsx` (imports + the `lores.length === 0` block)
- Modify: `src/index.css` — delete `.lore-empty-glyph`, `.lore-empty p`, `.lore-empty .primary-btn`; replace `.lore-empty`
- Test: `src/routes/LoreSelectorRoute.test.tsx`

**Interfaces:**
- Consumes: `EmptyState` from `src/components/EmptyState.tsx`, whose props are `{ icon: string; title: string; message?: ReactNode; children?: ReactNode }`. It renders `.empty-state` > `.empty-state-ornament` + `.empty-state-title` + optional `.empty-state-msg` + optional `.empty-state-actions` (children).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Append to the `gateway cards` describe in `src/routes/LoreSelectorRoute.test.tsx`:

```tsx
it('shows the add-tile beside existing worlds, and the empty state when there are none', async () => {
  vi.mocked(listLores).mockResolvedValue([world()])
  const { unmount } = render(<LoreSelectorRoute />)

  // Two "New World" buttons with a world present: the hero's, and the add-tile.
  await waitFor(() => expect(screen.getAllByRole('button', { name: /new world/i })).toHaveLength(2))
  expect(screen.queryByText(/no worlds yet/i)).toBeNull()
  unmount()

  // With none, the add-tile is gone (only the hero's button) and the empty state
  // carries the CTA, so the affordance is never absent.
  vi.mocked(listLores).mockResolvedValue([])
  render(<LoreSelectorRoute />)

  expect(await screen.findByText(/no worlds yet — your stories await/i)).toBeTruthy()
  expect(screen.getByRole('button', { name: /create your first world/i })).toBeTruthy()
  expect(screen.getAllByRole('button', { name: /new world/i })).toHaveLength(1)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- src/routes/LoreSelectorRoute.test.tsx`
Expected: this test FAILS at the ornament/`EmptyState` assertions only if the copy changed — but as written it should actually **PASS against the current markup**, because today's `.lore-empty` already renders that copy and CTA.

That is fine and intended: this test is a **characterization test**. It pins the copy and the add-tile/empty-state switching *before* the refactor, so Step 3 cannot silently change behaviour. Confirm it passes now; it must still pass after.

- [ ] **Step 3: Swap in the shared component**

In `src/routes/LoreSelectorRoute.tsx`, add the import beside the existing `ConfirmDialog` one:

```tsx
import EmptyState from '../components/EmptyState'
```

Replace the whole `{lores.length === 0 && (…)}` block with — the CTA and the hint both go in `children`, deliberately *not* the hint in `message`, because `message` renders **above** the actions and that would put a paragraph about backup files above the primary button, which is wrong for the overwhelmingly common case (a brand-new user with no backup at all):

```tsx
{lores.length === 0 && (
  <div className="lore-empty">
    <EmptyState icon="❧" title="No worlds yet — your stories await.">
      <button className="primary-btn" onClick={handleCreate} disabled={creating}>
        {creating ? 'Creating…' : 'Create your first world'}
      </button>
      <p className="empty-hint">
        Coming from the browser version? Use <strong>Import World</strong> above with a
        backup file (Settings → Back up now, once per world) to bring each world across.
      </p>
    </EmptyState>
  </div>
)}
```

- [ ] **Step 4: Replace the empty-state CSS**

In `src/index.css`, **delete** the `.lore-empty`, `.lore-empty-glyph`, `.lore-empty p`, and `.lore-empty .primary-btn` rules entirely, and put this in their place:

```css
/* Empty / first-run state. The shared EmptyState carries the layout; .lore-empty
   survives only as a scoping hook. Its .empty-state-actions is a flex ROW by
   default (index.css), which would sit the CTA and the migration hint side by
   side — so stack them, keeping the primary button above the footnote. */
.lore-empty .empty-state-actions {
  flex-direction: column;
  align-items: center;
  gap: 14px;
}
```

- [ ] **Step 5: Run the tests to verify they still pass**

Run: `npm run test:run -- src/routes/LoreSelectorRoute.test.tsx`
Expected: all eight PASS. The characterization test from Step 1 passing *after* the swap is the proof the refactor preserved behaviour.

- [ ] **Step 6: Verify by eye**

To see the empty state without deleting your worlds, open devtools → Application → IndexedDB, or simply temporarily force it. Confirm: the ❧ sits in the shared circular ornament, the title reads "No worlds yet — your stories await.", the **CTA is above** the import hint (not beside it), and the layout is centred.

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/routes/LoreSelectorRoute.tsx src/routes/LoreSelectorRoute.test.tsx
git commit -m "refactor: lore-selector empty state adopts the shared EmptyState (#169)"
```

---

### Task 6: Full verification and PR

**Files:** none modified (verification only).

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: the PR.

- [ ] **Step 1: Confirm no rem survives in the selector block**

Run: `grep -n "── Lore Selector" src/index.css` to find the block start, then check the block for `rem`.
Expected: no `rem` occurrences between that header and the `/* --- Timeline --- */` header.

- [ ] **Step 2: Confirm the focus rule has no border-radius**

Run: `grep -n -A4 "a:focus-visible, button:focus-visible" src/index.css`
Expected: `outline` and `outline-offset` only — **no `border-radius`**.

- [ ] **Step 3: Run the full gate**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three green. This is the same gate CI runs on the PR.

- [ ] **Step 4: Manual pass over the whole surface**

`npm run dev` → `http://localhost:5174/#/`:
- Hover a gateway: lift + gold rule brightens + banner drifts; initial and "Enter →" static.
- Keyboard: Tab through the cards, the corner controls, and the add-tile — every focus ring follows the element's real shape; **nothing flattens to a 3px rectangle**.
- The corner controls actually work: rename inline, change a banner, delete (confirm dialog appears).
- Click a banner and a world name — both enter the world.
- The active world shows its ring and "Current" badge.
- Devtools reduced-motion emulation: everything goes flat, nothing is invisible.
- Spot-check a *different* route (`/browse/…`, `/manuscript`) to confirm Task 1's app-wide focus fix improved those cards and broke nothing.

- [ ] **Step 5: Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat: lore selector atmosphere pass — the illuminated gateway (#169, #215)" --body "$(cat <<'EOF'
Session 3 of the visual-polish program. Turns the lore selector into a grid of
**arched gateways of tooled parchment**, and fixes the app-wide focus ring that
flattened card border-radius.

"Illuminated" in the scribal sense — gold leaf, not emitted light. On hover the
gold *catches* light (the rule brightens, the banner drifts, the card lifts); it
never emits it. No new material, no new motion token.

- **Gateway cards.** A shallow elliptical arch (120×40) clipping the banner, a
  tooled gold rule following the crown, parchment grain and resting elevation, an
  engraved mat carrying the name and founding date.
- **Corner controls.** Rename / Banner / Delete become icon-only buttons over the
  banner, never on the mat — with aria-labels that *name their world*, since N
  cards render at once.
- **Add-tile** becomes the same gateway, unbuilt.
- **Empty state** adopts the shared `EmptyState` component (copy unchanged).
- **#215:** deleted `border-radius: 3px` from the `:focus-visible` rule. An
  outline already follows its element's own radius, so it shaped nothing — but at
  specificity 0-1-1 it outranked every card rule and flattened the card itself on
  keyboard focus. App-wide fix: browse cards and book covers get their real shape
  back too.
- **#216:** the `.lore-selector` block converted rem → px, shrinking that sweep.

Spec: `docs/superpowers/specs/2026-07-11-lore-selector-atmosphere-design.md`

Closes #169
Closes #215

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --label "version:minor"
```

- [ ] **Step 6: Confirm the label landed**

Run: `gh pr view --json labels`
Expected: `version:minor` present. Without a label the bump defaults to patch, and this is a feature.

---

## Notes for the implementer

- **The arch and the corner controls are coupled.** If you find yourself wanting a grander arch, you must move `.world-card-actions` down. The geometry note in the CSS explains why; don't delete it.
- **`color-mix` is already used** by `.empty-state` and `.book-card`, so it adds no browser-support surface (Chrome/Edge 111+, Firefox 113+ — covers the web target and WebView2).
- **Don't uppercase world names in the TSX.** `text-transform` in CSS keeps the accessible name true; `.toUpperCase()` in JS would corrupt it for screen readers and tests.
- **Resist the glow.** If a change would add emitted light — `--accent-glow` blooms, lit seals, filter: drop-shadow in gold — it does not belong in this pass. That was an explicit design decision, not an oversight.
