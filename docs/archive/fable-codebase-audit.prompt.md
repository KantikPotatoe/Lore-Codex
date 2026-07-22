# Prompt for Fable 5 — Codebase Health, Weakness & Futureproofing Audit of Lore Codex

> Copy everything below the line into Fable 5. It is a self-contained audit brief.
> Fable must **not modify any code** — its only deliverable is one Markdown report.

---

## Role

You are a senior engineer doing a **read-only audit** of a real, shipping codebase. You
will study the code and produce a single Markdown report that ranks concrete weaknesses,
futureproofing gaps, and enhancement opportunities — each backed by the actual code it is
based on. You are *diagnosing*, not *fixing*.

## Hard constraints — read these first

1. **Do not edit, create, delete, or move any source file** except the one Markdown
   report named in "Deliverable" below. No refactors, no "quick fixes," no `package.json`
   changes, no scaffolding. If you feel the urge to "just fix it," stop and write the
   finding into the report instead.
2. **Do not run commands that mutate the tree** (`npm install`, `npm audit fix`,
   codemods, formatters). Read-only commands are encouraged: `npm ls`, `npm audit`
   (report-only), `npm run lint`, `npm run test:run`, `npx tsc --noEmit`, `git log`,
   `grep`, reading files. Running the existing test/lint/build to observe their output is
   fine and encouraged; changing their config is not.
3. **Investigate before you conclude.** Read the actual files; do not reason purely from
   this brief or from `CLAUDE.md`. Every finding must cite concrete code (`path:symbol`
   or `path:line`) and explain *why* it is a problem, not just that it looks unusual.
4. **No hand-waving.** "Add more tests" or "improve error handling" is not a finding. A
   finding names the specific file, the specific gap, the concrete failure it enables,
   and a specific remedy.
5. **One deliverable, one file.** Everything goes into the single report.

## What Lore Codex is (context, but verify against the code)

Lore Codex is a **local-first, in-browser worldbuilding wiki**: a React 19 + Vite 8 +
TypeScript (strict) SPA. **All data lives in the browser's IndexedDB via Dexie**; nothing
leaves the machine. Reactive reads use `useLiveQuery` (dexie-react-hooks) throughout. It
is now also wrapped in a **Tauri v2 desktop shell** (WebView2) — the web app is unchanged
inside the webview. It ships on a pinned local port (5174) opened in Firefox for the web
path.

Architectural facts to confirm and build your analysis on (spot-check every one against
the source — `CLAUDE.md` is dense and mostly accurate, but it can drift from the code):

- **Data layer** lives entirely in `src/db/` behind a barrel `index.ts` that re-exports
  everything; components import from `'../db'`. The Dexie schema + `db` singleton live in
  `src/db/schema.ts`. CRUD, backups, snapshots, manuscript authoring, maps, calendar,
  graph, templates all sit under `src/db/`.
- **Per-world databases:** each "lore" is its own IndexedDB (`src/loreId.ts`,
  `src/lores.ts`). `db` binds at module load to the active world; `switchLore()` and
  deleting the active world call `window.location.reload()` to rebind. A separate
  `lore-registry` IndexedDB tracks worlds.
- **Backup/restore** is JSON export/import (`src/db/backup.ts`, `src/backup.ts`), versioned
  via `CURRENT_SCHEMA_VERSION` + a `MIGRATIONS` ladder. **Import replaces all data**
  (no merge), guarded by `parseBackup()` before any `clear()`.
- **Security boundary:** untrusted data enters only on **backup import**, scrubbed by
  DOMPurify in `src/sanitize.ts`. Page bodies render through Tiptap (rebuilt from schema);
  there is one raw render sink in `TimelineVertical`.
- **Resilience:** IndexedDB quota errors surface via `src/storageError.ts` +
  `StorageErrorBanner`; there's an `ErrorBoundary`; auto-snapshots (`src/snapshots.ts`)
  keep 10 recent snapshots inside the DB.
- **Desktop seam:** `src/platform.ts` is the *only* place allowed to call `@tauri-apps/*`
  or trigger `<a download>` (lint-enforced). Shell config is in `src-tauri/`.
- **Heavy browser-API dependencies:** Tiptap editor, Leaflet (`leaflet` + `leaflet-draw`),
  FlexSearch, JSZip (HTML export / EPUB), data-URL images, `react-force-graph-2d/3d`
  (WebGL), hash routing (`react-router-dom`).

## How to explore (breadth first, then depth)

Start broad, then drill into the hotspots you find:

- Read `CLAUDE.md`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `eslint` config,
  `.github/workflows/`.
- Read the seams: `src/main.tsx`, `src/App.tsx`, `src/db/` (all modules), `src/platform.ts`,
  `src/sanitize.ts`, `src/storageError.ts`, `src/search.ts`, `src/calendar.ts`,
  `src/autolink.ts`, `src/manuscriptExport.ts`, `src/htmlExport.ts`.
- Map the test surface: list every `*.test.{ts,tsx}` and note what is **not** covered —
  especially the data layer, migrations, sanitization, and export/import round-trips.
- Grep for risk seams and report what you find:
  - Async DB writes with no `await`/`.catch` (fire-and-forget Dexie) — data-loss risk.
  - `dangerouslySetInnerHTML`, `innerHTML`, `document.write` — XSS surface.
  - `any`, `as any`, `@ts-ignore`, `@ts-expect-error`, non-null `!` assertions — type holes.
  - `window.location`, `localStorage`, `indexedDB`, `URL.createObjectURL`,
    `navigator.storage`, `blob:` / `data:` — platform coupling.
  - `useEffect` that writes state, missing/oversized dependency arrays, `useLiveQuery`
    mirrored into `useState` — reactivity bugs.
  - `catch {}` / swallowed errors, `console.log` left in, `TODO`/`FIXME`/`HACK`.
  - Unbounded loops over all pages/scenes on the hot path (search, autolink, graph,
    backlinks) — performance cliffs at large worlds.

## Audit dimensions — what to look for

Rank findings within each; not every dimension will yield findings — say so if a dimension
is genuinely clean, and say *why* you believe it.

### 1. Correctness & data-integrity risks (highest priority)
This app's whole value is the user's data. Hunt for anything that can **silently lose,
corrupt, or strand** it: fire-and-forget writes that can fail after a quota error,
import/export paths that drop fields, migration ladder gaps (`MIGRATIONS` vs
`CURRENT_SCHEMA_VERSION` vs the Dexie store version — are they consistent?), cascade
deletes that orphan or over-delete records, the reload-to-rebind race on `switchLore`,
concurrent writes under React StrictMode double-invocation, and `renamePage` link-rewriting
edge cases (title clashes, partial rewrites). For each, give a concrete trigger sequence.

### 2. Security surface
Re-examine the "untrusted data enters only on import" claim. Is `sanitizeHtml`'s whitelist
actually applied at **every** raw sink (not just `TimelineVertical`)? Can a crafted backup
smuggle script through infobox fields, event descriptions, scene content, citations, or
image data-URLs? Check the Tauri CSP (`tauri.conf.json`) and capabilities
(`src-tauri/capabilities/`) for over-broad grants. Note anything that would matter more
once real filesystem access is in play.

### 3. Futureproofing & scalability
Where does the app fall over as a world grows to thousands of pages, large images, or many
worlds? Look at: full-DB scans on the hot path (search sync, autolink matcher build, graph
build, backlink scans), the single-origin IndexedDB quota ceiling and data-URL image bloat,
the in-memory FlexSearch index size, and any O(n²) title-matching. Distinguish "already
incremental / fine" from "will bite at scale," and estimate the rough threshold.

### 4. Architecture & maintainability
Assess the `src/db/` barrel seam: is Dexie genuinely insulated, or does it leak into
components in ways that would make the eventual storage swap painful (see the desktop
investigation)? Look for god-modules, duplicated logic (e.g. HTML parsing done more than
one way vs the shared `src/html.ts`), inconsistent error handling, and places where the
platform seam (`src/platform.ts`) is bypassed. Flag coupling that makes change risky.

### 5. Type safety & correctness guards
Find weak typing that undermines `strict` mode: `any`/`as any`/`@ts-ignore`, unchecked
casts on import boundaries, optional fields treated as present, and validation gaps where
external JSON (backups) is trusted. Note where a runtime schema check (or a discriminated
union) would catch a class of bugs the compiler currently can't.

### 6. Testing & verifiability
Map coverage to risk. The highest-value untested paths are usually: backup
export→import→export round-trip fidelity, each `MIGRATIONS` step, sanitization against
known-malicious payloads, calendar absolute-day math, autolink planning, and manuscript
EPUB/HTML export validity. Name the specific missing tests and the bug class each would
catch. Do not propose coverage for coverage's sake.

### 7. Performance & responsiveness
Beyond scale (dimension 3), look for avoidable main-thread cost: image compression on the
UI thread, re-parsing HTML per render, force-graph recompute triggers, un-memoized derived
data, and large synchronous work in effects. Cite the code and the user-visible symptom.

### 8. Dependency & supply-chain health
Run `npm audit` (report only) and `npm ls`. Flag vulnerable, abandoned, or duplicated deps,
major-version drift, and anything heavy that a lighter option or a few lines could replace.
Note peer-dependency or React 19 compatibility risks. Do not propose upgrades blindly —
weigh churn vs payoff.

### 9. Developer experience & tooling
CI (`.github/workflows/ci.yml`), the label-driven `version-bump.yml`, lint/test/build
ergonomics, the port-5174 pinning footgun (origin-keyed IndexedDB → "empty DB looks like
lost data"), and any missing guardrail that would have caught a past class of bug. Keep
this short — it's the lowest tier.

## Prioritization & scoring

For **every** finding, assign:

- **Severity:** Critical / High / Medium / Low — Critical is reserved for silent data loss
  or corruption and exploitable security holes.
- **Effort:** t-shirt size (XS / S / M / L / XL) to remediate.
- **Confidence:** High / Medium / Low — and if Low, mark it as needing a spike rather than
  asserting it.

Then give an overall **"fix first" shortlist**: the handful of findings where
severity-over-effort is highest. Be honest — if the codebase is largely healthy in a
dimension, say so plainly rather than inventing findings to fill space. A short report of
real problems beats a long one padded with nitpicks.

## Deliverable

Write **one** Markdown file:

`docs/codebase-audit.md`

Structure it as:

1. **Executive summary** — the overall health verdict in 5–10 lines, plus the "fix first"
   shortlist (top 5–8 findings as a table: title · dimension · severity · effort).
2. **Methodology** — what you read, what you ran, and what you did *not* examine (scope
   honesty).
3. **Findings by dimension** — sections 1–9 above. Each finding as a numbered entry:
   **title · severity · effort · confidence**, then *Evidence* (`path:symbol` + why),
   *Impact* (the concrete failure it enables), *Remedy* (specific change), and any
   *Trade-off* the remedy accepts.
4. **Positives worth preserving** — patterns that are done well and must not be
   regressed in future refactors (cite them, so a later session doesn't "clean them up").
5. **Open questions & spikes** — anything that couldn't be settled by reading and needs a
   time-boxed experiment.
6. **Appendix: finding index** — a flat, sortable table of every finding
   (id · title · dimension · severity · effort · confidence · file) for triage.

Every claim about current behavior must cite a real `path:symbol` or `path:line`. Prefer
concrete, executable guidance over generic best-practice prose. Where you're unsure, say so
and mark it a spike rather than guessing. Do not propose a remedy without naming the
trade-off it accepts.

**Reminder: produce only that one Markdown file (`docs/codebase-audit.md`). Change nothing
else.**
