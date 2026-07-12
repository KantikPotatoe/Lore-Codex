# Settings & Templates Atmosphere Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Settings and Templates — the app's two back-of-house routes — a real structure and the shared material language, without the ornament the front-of-house routes carry.

**Architecture:** Almost entirely CSS in `src/index.css`, plus a class rename and one markup restructure in `SettingsRoute.tsx`, plus row/target work in the Templates CSS. Settings' four sections become carded `.parchment` + `.elevated` panels; the Templates editor joins the same material and its rows become roomier objects. The one new *test* is a permanent regression guard for the grain-killing shorthand bug (#218).

**Tech Stack:** React 19 + TypeScript, Vite, plain CSS (`src/index.css`, no preprocessor, no CSS modules), Vitest + happy-dom (jsdom where a real cascade or DOMPurify is needed), Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-12-settings-templates-atmosphere-design.md`

## Global Constraints

- **No new material and no new motion token.** Everything is built from the existing parchment grain, layered elevation, gold rule, and duration/easing tokens. A change that needs a new material does not belong in this pass.
- **No stagger, and no new animation, on either route.** `.route-fade` is the entrance; that is motion enough for a room you visit to change a number. (Decided in the spec, §5.)
- **`background-color:`, never the `background:` shorthand, on any `.parchment` member.** The shorthand resets `background-image` to `none` and silently kills the grain. This bug shipped four times (#168, #169, #170, #218). Task 1 makes it impossible to ship a fifth.
- **Nothing fixed-position inside a route.** `.route-fade`'s transform makes it the containing block for fixed-position descendants during its 240ms entrance.
- **px, not rem.** rem resolves against the 16px root, *not* `body { font-size: 15px }`. Conversion is `px = round(rem × 16)`.
- **Existing tests must stay green without edits.** `SettingsRoute.test.tsx` (6 tests) and `TemplatesRoute.test.tsx` (1 test) assert on text and roles, not class names. If one goes red, the change drifted — that is not a licence to edit the assertion.
- **Do not touch:** the `.home > .home-section + .home-section::before` ornament (correctly scoped to Home), the `.template-pick` rail (already the best thing on either route), the delete-world flow, or `.danger-zone .danger-btn`'s existing styling.
- Every PR carries a version label. This one: **`version:minor`**, closing **#171**.

---

### Task 1: Make the grain bug unshippable

The rest of this plan adds **two new members** to the `.parchment` list (`.settings-section` in Task 2, `.template-editor` in Task 3). `.template-editor` *already writes the `background:` shorthand*, so adding it naively would kill the grain on arrival — #218's trap, sprung a fifth time, inside the pass that documented it.

So build the guard first. It evaluates the **real cascade** (a regex over the source cannot see specificity or source order), and it derives the member list **from the stylesheet**, so a member added later is guarded automatically instead of silently escaping.

**Files:**
- Create: `src/parchmentGrain.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing importable. It is a guard. Tasks 2 and 3 must keep it green.

- [ ] **Step 1: Write the guard**

Create `src/parchmentGrain.test.ts`:

**Two traps here, both hit while validating this plan — the code below is what actually works, do not "simplify" it back:**

1. **`import css from './index.css?raw'` yields an empty string.** Vitest stubs CSS imports (`css: false` by default) and `?raw` does not escape that. The test then finds zero members and vacuously passes. Read from disk instead.
2. **`new URL('./index.css', import.meta.url)` throws** `TypeError: The URL must be of scheme file` under Vitest's transform. Use `process.cwd()`, which is the project root.

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #218: `.parchment` sets background-image on a LIST of selectors, but a member
 * that later writes the `background:` SHORTHAND in its own rule resets
 * background-image to `none` — silently killing the grain. Nothing errors; the
 * texture just never renders. That bug shipped four times (#168, #169, #170,
 * #218) before it was understood.
 *
 * This guard evaluates the REAL cascade: it loads the real stylesheet, mounts a
 * bare element per member, and asks the engine what it actually computed. A
 * regex over the source could not see specificity or source order. This can.
 */

// Read from disk, NOT `import css from './index.css?raw'` — Vitest stubs CSS
// imports (`css: false` by default) and `?raw` does not escape that: it yields ''.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** Derive the member list from the stylesheet, so new members are guarded automatically. */
function parchmentMembers(sheet: string): string[] {
  const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = /([^}{]+)\{\s*background-image:\s*var\(--parchment-noise\)\s*;?\s*\}/.exec(stripped)
  if (!rule) throw new Error('Could not find the .parchment rule in index.css')
  return rule[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^\.[\w-]+$/.test(s))
    .map((s) => s.slice(1))
}

describe('parchment grain', () => {
  const members = parchmentMembers(css)

  it('derives the .parchment member list from the stylesheet', () => {
    expect(members).toContain('infobox')
    expect(members).toContain('sidebar')
    expect(members.length).toBeGreaterThan(4)
  })

  it.each(members)('survives the cascade on .%s', (cls) => {
    document.head.innerHTML = `<style>${css}</style>`
    document.body.innerHTML = `<div class="${cls}"></div>`
    const el = document.body.firstElementChild as HTMLElement

    // jsdom does not substitute var(), so this is the literal `var(--parchment-noise)`.
    // The discriminator is `none` (a shorthand wiped it) vs anything else.
    const bg = getComputedStyle(el).backgroundImage

    expect(
      bg,
      `.${cls} lost its parchment grain. Its own rule almost certainly sets the ` +
        '`background:` shorthand — which resets background-image to none. Use the ' +
        '`background-color:` longhand instead. See #218.',
    ).not.toBe('none')
    expect(bg).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it — it must PASS**

This is a regression guard, not a red-first TDD test. #218 already fixed every current member, so it starts green. **Green here proves the guard and the #218 fix agree.**

Run: `npx vitest run src/parchmentGrain.test.ts`
Expected: PASS, **9 tests** — one list-derivation check plus one per member. The derived list must be exactly:

```
["parchment","infobox","ov-card","browse-card","book-card","world-card","modal-dialog","sidebar"]
```

If it is `[]` or shorter, the file read failed and the `it.each` is vacuously passing over an empty list. That is the failure mode to watch for: **an empty guard looks identical to a passing one.** Confirm the member count before trusting it.

- [ ] **Step 3: Prove the guard actually bites**

A guard that cannot fail is worse than no guard. Temporarily break one member — in `src/index.css`, change `.infobox`'s rule (~`:835`) from `background-color: var(--panel);` back to `background: var(--panel);`.

Run: `npx vitest run src/parchmentGrain.test.ts`
Expected: **FAIL** on `survives the cascade on .infobox`:

```
× parchment grain > survives the cascade on .infobox
  → .infobox lost its parchment grain. Its own rule almost certainly sets the
    `background:` shorthand … See #218. expected 'none' not to be 'none'
```

(This exact failure was reproduced while writing the plan, so it is what you should see.)

**Now revert that edit** — `git checkout -- src/index.css` — and re-run to confirm green. Do not commit the broken state.

- [ ] **Step 4: Commit**

```bash
git add src/parchmentGrain.test.ts
git commit -m "test: guard the parchment grain against the background-shorthand trap (#218)

Evaluates the real cascade rather than grepping the source, and derives the
member list from the stylesheet so new .parchment members are guarded
automatically. Verified to fail when a member is reverted to the shorthand."
```

---

### Task 2: Settings chassis — the route gets a shape

`.settings-page` sets `max-width: 860px` and **nothing else**. `.content` has no padding and every route pads itself — so Settings alone has *no padding at all* and sits flush against the sidebar. This is the "Fix let[f] margin" line that opens #173, closed here.

The four sections stop borrowing Home's `.home-section` and become carded `.settings-section` panels.

**Files:**
- Modify: `src/index.css` (the `.parchment` list, the `.elevated` list, `.home-section h2`, and the settings block ~`:2311`)
- Modify: `src/routes/SettingsRoute.tsx:151,204,221,288`

**Interfaces:**
- Consumes: the `.parchment` / `.elevated` selector lists; the guard from Task 1.
- Produces: the `.settings-section` class, which Task 4's markup sits inside.

- [ ] **Step 1: Rename the sections in the markup**

In `src/routes/SettingsRoute.tsx`, four edits. Settings stops borrowing Home's class, so a future Home restyle cannot silently reach into Settings.

- Line 151: `<section className="home-section">` → `<section className="settings-section">`
- Line 204: `<section className="home-section">` → `<section className="settings-section">`
- Line 221: `<section className="home-section backup">` → `<section className="settings-section backup">`
- Line 288: `<section className="home-section danger-zone">` → `<section className="settings-section danger-zone">`

(The `backup` class has no rule of its own — it is inert. Left alone to keep the diff honest; removing it is not this pass's job.)

- [ ] **Step 2: Share the header underline instead of duplicating it**

In `src/index.css` (~`:375`), the gold gradient underline currently keys off Home. Widen the selector — **the declarations do not change**:

```css
.home-section h2, .settings-section h2 {
  font-family: var(--display); font-size: 20px; color: var(--ink);
  border-bottom: 1px solid transparent; padding-bottom: 8px;
  border-image: linear-gradient(to right, var(--accent) 0%, var(--border) 28%, var(--border) 100%) 1;
}
```

- [ ] **Step 3: Add `.settings-section` to the two material lists**

In `src/index.css`, add `.settings-section,` to the `.parchment` selector list (~`:129`) and to the `.elevated` selector list (~`:153`). After the edits they read:

```css
.parchment,
.infobox,
.ov-card,
.browse-card,
.book-card,
.world-card,
.modal-dialog,
.settings-section,
.sidebar {
  background-image: var(--parchment-noise);
}
```

```css
.elevated,
.infobox,
.book-card,
.world-card,
.ov-card,
.settings-section {
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.25),
    0 6px 18px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
```

- [ ] **Step 4: Give the route its measure, and the sections their card**

In `src/index.css`, replace the `.settings-page` line (~`:2311`) and add the section rules below it. Settings adopts `.home`'s exact measure so the two read as the same hand.

```css
.settings-page { max-width: 880px; margin: 0 auto; padding: 48px 40px 80px; }
.settings-title { margin: 0 0 18px; }

/* Back-of-house: the sections are OBJECTS, grouped by material rather than by a
   decorative rule. Home's diamond ornament is deliberately not used here — see
   the workshop spec. `background-color` (never `background:`) because this is a
   .parchment member; the shorthand would wipe the grain (#218). */
.settings-section {
  background-color: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px 22px;
  margin-top: 20px;
}
.settings-section.danger-zone {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
}
```

Leave `.settings-controls`, `.settings-field`, `.settings-field input`, and both `.danger-zone .danger-btn` rules exactly as they are.

- [ ] **Step 5: The guard must still pass — now covering the new member**

`.settings-section` is a new `.parchment` member, so Task 1's guard picks it up automatically.

Run: `npx vitest run src/parchmentGrain.test.ts`
Expected: PASS, and the run now shows **10** tests, up from 9 — a `survives the cascade on .settings-section` case has appeared **without anyone editing the test**. That is the guard being self-maintaining.

If `.settings-section` fails here, Step 4 used `background:` instead of `background-color:`.

- [ ] **Step 6: The existing Settings tests must be untouched and green**

Run: `npx vitest run src/routes/SettingsRoute.test.tsx`
Expected: PASS, 6 tests. They assert on text and roles, so the class rename is invisible to them. **If one is red, the change drifted — fix the change, not the test.**

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/routes/SettingsRoute.tsx
git commit -m "feat: Settings chassis — padding, measure, and carded sections (#171)

.settings-page set max-width and nothing else, and .content does not pad, so
Settings alone had no padding at all and sat flush against the sidebar. It now
adopts .home's measure. The four sections stop borrowing .home-section and
become carded .parchment + .elevated panels, grouped by material rather than by
a decorative rule."
```

---

### Task 3: Templates — the editor gets material, the rows get room

The cramped row editor is the top pain point on this route. `.template-editor` is on **neither** material list — a flat box while every comparable panel is a lit surface — and it **already writes the `background:` shorthand**, so joining `.parchment` without converting it would kill the grain instantly.

**Files:**
- Modify: `src/index.css` (the `.parchment` list, the `.elevated` list, `.template-editor` ~`:911`, `.template-item` ~`:930`, `.template-item-move .tag-x` ~`:932`)

**Interfaces:**
- Consumes: the material lists; the guard from Task 1.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Add `.template-editor` to the lists — and DO NOT fix the shorthand yet**

This step deliberately reproduces the bug, to watch the guard catch it. Add `.template-editor,` to the `.parchment` list and the `.elevated` list in `src/index.css`, exactly as Task 2 Step 3 did for `.settings-section`. Change nothing else.

- [ ] **Step 2: Run the guard — it must FAIL**

Run: `npx vitest run src/parchmentGrain.test.ts`
Expected: **FAIL** on `survives the cascade on .template-editor`, reporting `.template-editor lost its parchment grain… use the background-color longhand instead. See #218.`

This is the fifth appearance of the bug that shipped four times, caught in seconds by a guard that did not exist this morning. That is the whole point of Task 1.

- [ ] **Step 3: Fix the shorthand**

In `src/index.css` (~`:911`), the one-word change the guard is demanding:

```css
.template-editor {
  background-color: var(--panel); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;
}
```

(Its existing `padding: 16px` is right and stays.)

- [ ] **Step 4: Run the guard — it must PASS**

Run: `npx vitest run src/parchmentGrain.test.ts`
Expected: PASS, now **11** tests.

- [ ] **Step 5: Make the rows objects, and the targets clickable**

In `src/index.css`, replace `.template-item` (~`:930`) and `.template-item-move .tag-x` (~`:932`).

The remove (×) button is a **direct child** of `.template-item`; the move (▲▼) buttons are nested inside `.template-item-move`. Using the child combinator `>` for the former keeps the two rules from colliding — both would otherwise be specificity (0,2,0), and source order alone would decide, which is the fragile pattern this repo has already been bitten by.

```css
.template-item {
  display: flex; align-items: center; gap: 8px;
  background-color: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px 8px;
}
.template-item-move { display: flex; flex-direction: column; line-height: 0.7; }

/* Hit targets. These were a 9px glyph in a 4px-padded box — the "cramped rows"
   complaint. `>` scopes the remove button without colliding with the nested
   move buttons (both would be (0,2,0) and decided by source order alone). */
.template-item-move .tag-x { padding: 2px 6px; font-size: 9px; border-radius: 4px; }
.template-item-move .tag-x:hover { background: var(--panel-2); }
.template-item > .tag-x { padding: 4px 7px; border-radius: 5px; }
.template-item > .tag-x:hover { background: var(--panel-2); }
```

Leave `.template-items`, `.template-item-label`, `.template-item.separator …`, and `.template-item-kind` as they are.

- [ ] **Step 6: The existing Templates test must be untouched and green**

Run: `npx vitest run src/routes/TemplatesRoute.test.tsx`
Expected: PASS, 1 test.

- [ ] **Step 7: Commit**

```bash
git add src/index.css
git commit -m "feat: Templates — editor on material, rows with room to click (#171)

.template-editor was on neither material list — a flat box among lit panels —
and already wrote the `background:` shorthand, so joining .parchment without
the longhand would have killed the grain on arrival. The guard from the
previous commit caught exactly that, on cue.

The rows become objects with real hit targets: the move/remove controls were a
9px glyph in a 4px-padded box, which was the route's top complaint."
```

---

### Task 4: The backup tip — steps, not a wall of prose

The Firefox branch buries a three-step `<ol>` inside a prose block: important information, badly presented. The Tauri branch is already brief and **stays prose**.

Note `SettingsRoute.test.tsx` mocks the platform seam with `isTauri: () => false`, so tests render the browser branch.

**Files:**
- Modify: `src/routes/SettingsRoute.tsx:272-284` (the `isTauri()` false branch)
- Modify: `src/index.css` (`.backup-tip ol` ~`:1069`)
- Modify: `src/routes/SettingsRoute.test.tsx`

**Interfaces:**
- Consumes: `.settings-section` (Task 2) — the tip lives inside the Backup card.
- Produces: an `<ol className="backup-steps" aria-label="Backup steps">` with exactly three `<li>`.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/SettingsRoute.test.tsx`, inside the existing `describe('SettingsRoute', …)`. Add `within` to the existing import from `@testing-library/react`.

```tsx
it('presents the browser backup advice as three scannable steps, not a prose block', async () => {
  render(<MemoryRouter><SettingsRoute /></MemoryRouter>)

  const steps = await screen.findByRole('list', { name: 'Backup steps' })
  expect(within(steps).getAllByRole('listitem')).toHaveLength(3)

  // Each step leads with what you DO, so the list is scannable without reading it.
  expect(within(steps).getByText('Make a synced folder.')).toBeTruthy()
  expect(within(steps).getByText('Point Firefox at it.')).toBeTruthy()
  expect(within(steps).getByText('Back up when warned.')).toBeTruthy()
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/routes/SettingsRoute.test.tsx -t 'scannable steps'`
Expected: FAIL — `Unable to find an accessible element with the role "list" and name "Backup steps"`. (The current `<ol>` has no accessible name.)

- [ ] **Step 3: Restructure the markup**

In `src/routes/SettingsRoute.tsx`, replace the `<ol>…</ol>` in the browser branch (the `: (` side of the `isTauri()` ternary, ~`:278-282`) with:

```tsx
<ol className="backup-steps" aria-label="Backup steps">
  <li>
    <strong>Make a synced folder.</strong> Anywhere inside <em>Dropbox</em>,{' '}
    <em>OneDrive</em>, or <em>Google Drive</em> — e.g. <code>Lore Backups</code>.
  </li>
  <li>
    <strong>Point Firefox at it.</strong> <em>Settings → General → Files and
    Applications → Downloads</em>, then set "Save files to" to that folder.
  </li>
  <li>
    <strong>Back up when warned.</strong> The file lands in your synced folder and
    is copied to the cloud automatically.
  </li>
</ol>
```

Leave the `<strong>` intro and `<p>` above it, and the whole Tauri branch, unchanged.

- [ ] **Step 4: Style the steps**

In `src/index.css`, **replace** the `.backup-tip ol` rule (~`:1069`) with:

```css
.backup-steps {
  margin: 12px 0 0; padding: 0; list-style: none;
  counter-reset: step;
  display: flex; flex-direction: column; gap: 10px;
}
.backup-steps li {
  counter-increment: step;
  display: grid; grid-template-columns: 22px 1fr; gap: 10px;
  align-items: start; line-height: 1.5;
}
.backup-steps li::before {
  content: counter(step);
  display: flex; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  font-family: var(--display); font-size: 12px;
  color: var(--accent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  border-radius: 50%;
}
.backup-steps strong { color: var(--ink); }
```

Keep `.backup-tip`, `.backup-tip p`, `.backup-tip code`, and `.backup-tip em` as they are.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/routes/SettingsRoute.test.tsx`
Expected: PASS, 7 tests (the original 6 plus the new one).

- [ ] **Step 6: Commit**

```bash
git add src/routes/SettingsRoute.tsx src/routes/SettingsRoute.test.tsx src/index.css
git commit -m "feat: backup advice reads as three steps, not a wall of prose (#171)

The Firefox guidance buried a three-step <ol> inside a paragraph. Same
information, now scannable: each step leads with the action. The Tauri branch
is already brief and stays prose."
```

---

### Task 5: rem → px, then verify and ship

Following the #168/#169/#170 precedent — *convert the block you rewrite* — shrinking #216's remaining sweep. These two are the only rem values in the blocks this pass touched.

**Files:**
- Modify: `src/index.css:1550-1551`

**Interfaces:**
- Consumes: nothing. Produces: nothing.

- [ ] **Step 1: Convert the two values**

In `src/index.css`, `px = round(rem × 16)`:

```css
.snapshot-time { font-size: 14px; color: var(--ink); }
.snapshot-count { font-size: 12.5px; color: var(--ink-faint); }
```

(`0.9rem × 16 = 14.4 → 14px`; `0.78rem × 16 = 12.48 → 12.5px`.)

- [ ] **Step 2: Full verification**

All three must be green before claiming done.

```bash
npm run lint
npm run build
npm run test:run
```

Expected: lint clean; build succeeds; **all tests pass** — the suite grows from **819 to 831** (the guard's 11 cases plus the backup-steps test). Confirm `parchmentGrain.test.ts` reports a `.settings-section` case **and** a `.template-editor` case, proving both new members are guarded.

- [ ] **Step 3: Manual check — this pass is visual, so look at it**

Run `npm run dev` (port is pinned to 5174; if it is already taken, a dev server is already running — use it).

- `/settings`: content is no longer flush against the sidebar; the four sections read as grouped, lit cards; the danger card is distinguishable but not loud; the backup advice scans as three numbered steps.
- `/templates`: the editor panel sits on material; **add and remove several rows and confirm the ▲▼/× targets are comfortably clickable** — that is the pain point, so it is the acceptance test.
- Both routes: confirm the paper grain is actually visible on the new panels (that is what the guard asserts; confirm it with your eyes too).

- [ ] **Step 4: Commit and open the PR**

```bash
git add src/index.css
git commit -m "chore: convert the snapshot block from rem to px (#171, shrinks #216)"
git push -u origin feat/171-settings-templates-atmosphere
```

Open the PR with the **`version:minor`** label, closing **#171**. The body should note: this is a visible restyle of two routes; it closes #173's "fix left margin" line; and #173 now shrinks to adding its six new options into the chassis this pass builds.

---

## Self-Review

**Spec coverage.** Spec §1 (chassis, measure, `.settings-section`, material lists, shared `h2`) → Task 2. §2 (light danger zone) → Task 2 Step 4. §3 (editor material, the mandatory shorthand conversion, row objects, hit targets) → Task 3. §4 (backup steps) → Task 4. §5 (no motion added) → a Global Constraint, and no task adds any. §6 (rem → px) → Task 5. The spec's "verify the grain does not fail silently" requirement is upgraded from a manual check into the permanent guard in Task 1. The spec's correction (no ornament leak) needs no task — it is a decision to change nothing, encoded in the "Do not touch" constraint.

**Placeholders.** None. Every step carries the literal code or the exact command and its expected output.

**Type/name consistency.** `.settings-section` is used identically in Tasks 2 and 4. `.backup-steps` + `aria-label="Backup steps"` match between the Task 4 test, markup, and CSS. The guard's filename (`src/parchmentGrain.test.ts`) is identical in Tasks 1, 2, 3, and 5. Test counts are stated and consistent as the member list grows: 9 (Task 1) → 10 (Task 2) → 11 (Task 3), and 831 for the full suite (Task 5).

**Validated, not assumed.** Task 1's guard was written and run for real while drafting this plan: the derived member list, the green baseline, and the induced `.infobox` failure are all transcribed from actual runs, not predicted. Two approaches that *looked* correct were discarded in the process (`?raw` silently yields `''`; `import.meta.url` throws under Vitest) — both are called out inline so no one re-discovers them.
