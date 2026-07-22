# Lore Codex — Audit Report

Date: 2026-07-02 · Auditor: Claude Code (autonomous, per `AUDIT_INSTRUCTIONS.md`)
Baseline: `main` @ `daa2551` (v0.10.0), working tree otherwise untouched.

---

## 1. Summary

**Scope covered:** Pass 0 (orientation), Pass 2 (async/state — Dexie writes, effects/cleanup, `renamePage` + calendar transactions), Pass 3 (XSS — every raw-HTML sink, import boundary, dependency-resolution check), Pass 4 (logic — `calendar.ts`, `autolink.ts`, `citations.ts`, `html.ts`, `graph.ts`, `backup.ts` migrations), Pass 1/5 (light structure/quality notes), Pass 6 (git history of sanitization/backup/search).

**Verification gate:** green **before** the audit (lint ✓, build ✓, 401/401 tests ✓) and green **after** the single applied fix (lint ✓, build ✓, **406/406** tests ✓). The build emits two pre-existing warnings (an `INEFFECTIVE_DYNAMIC_IMPORT` note for `src/db/index.ts` via `src/lores.ts`, and a >500 kB chunk-size notice) — present at baseline, not introduced by this run.

**Top findings by severity:**

| # | Severity | Finding |
|---|---|---|
| 1 | **high** | Stored XSS via search snippets: `highlightSnippet` output injected unescaped into `dangerouslySetInnerHTML` (`src/search.ts` → `SearchModal.tsx`). **Fixed** (allowlist-qualifying, see §3). |
| 2 | **med** | HTML export interpolates unescaped plain-text fields (title, category, infobox labels/values, captions, citation text) into the generated static site — markup/script injection in the exported files (`src/htmlExport.ts`). |
| 3 | **med** | Graph island mode breaks after the force sim runs: `connectedComponents` receives links whose `source`/`target` have been mutated from id strings into node objects, so every node becomes its own island (`src/routes/GraphRoute.tsx:131` + `src/db/graph.ts:186`). |
| 4 | **med** | HTML export resolves wiki-link/backlink/citation targets **case-sensitively**, unlike every in-app resolver — links that work in-app export as broken (`src/htmlExport.ts:151`). |
| 5 | **low/med** | `renamePage` reads the full page list and performs the clash check **outside** its transaction; `deletePage`'s three-step cascade is not transactional (`src/db/pages.ts`). |

---

## 2. Findings (by pass)

### Pass 3 — XSS / sanitization boundary (HIGH priority)

**3.1 · `src/search.ts:40` (sink at `src/components/SearchModal.tsx:73`) · high · Stored XSS through search snippets — FIXED.**
Snippets are built from `stripHtml(page.content)`. `stripHtml` (`src/html.ts:13`) uses `textContent`, which **decodes entities**: a page whose *visible text* contains `<img src=x onerror=alert(1)>` (stored safely as `&lt;img …&gt;`) comes back as raw markup. `highlightSnippet` then returned that string with only `<mark>` added, and `SearchModal` injected it via `dangerouslySetInnerHTML`. Import sanitization does **not** close this: `sanitizeHtml` correctly leaves escaped text nodes alone, so a malicious *imported backup* carrying `&lt;img onerror=…&gt;` as page text passes the import scrub and detonates the moment the page appears in search results with the payload inside the 160-char snippet window. This was the exact check the rubric called out ("confirm the snippet … cannot carry live markup") — it could. Fix applied: escape every text run, highlight by offsets (§3).

**3.2 · `src/components/TimelineVertical.tsx:116` · info · Confirmed safe.** The one raw event-description sink wraps `sanitizeHtml(event.description)` — defence-in-depth intact. These two are the **only** `dangerouslySetInnerHTML`/`innerHTML` sinks in `src/` (verified by sweep).

**3.3 · `src/db/backup.ts:183-191` · info · Import boundary confirmed.** `importAll` sanitizes `pages.content` + `events.description` and filters gallery images to `data:image/` before any write; `parseBackup` validates before any `clear()`; a `bulkAdd` failure aborts the whole transaction, so the pre-import data survives. Solid.

**3.4 · `src/db/backup.ts:189` · info · `data:image/svg+xml` passes the image filter.** SVG data-URLs can embed `<script>`. All current render paths use `<img>`/CSS (where SVG scripts do not execute), so this is inert today — but it's a latent hazard if an image is ever rendered via `<object>`/`iframe`/new-tab navigation. Suggested hardening (not applied — touches the import path): exclude `image/svg+xml` from the whitelist or document the constraint at the render sites.

**3.5 · Dependency resolution check (read-only) · pass.** Every `package.json` dependency and devDependency resolves in local `node_modules` with a version satisfying its spec (38/38). No missing/hallucinated packages. No registry queried.

**3.6 · `src/components/LoreEditor.tsx:253-264` · info · External-link entry is safe.** User-typed URLs get `https://` prefixed unless already `https?:`/`mailto:` — no `javascript:` can be applied; sanitize whitelist + DOMPurify's URI policy back-stop imported content.

### Pass 2 — Async & state (HIGH priority)

**2.1 · `src/db/pages.ts:115-128` · med · `renamePage` clash-check and snapshot race the transaction.**
`db.pages.toArray()` and the title-clash check run *before* the `rw` transaction opens. A write that lands in between (autosave from the editor, a second tab) is invisible: the rewrite loop then calls `db.pages.update(p.id, {content: …})` from the stale snapshot, silently reverting the concurrent edit's links, and the clash check can pass stale. Single-user local app ⇒ narrow window, but Dexie makes the fix cheap. Suggested fix (not applied — multi-step semantic change): move the `toArray()` + clash check *inside* the transaction.

**2.2 · `src/db/pages.ts:33-40` · low/med · `deletePage` cascade is not atomic.** Page delete, gallery-image delete, and pin-unlink run as three separate awaits with no transaction. A quota error or tab close mid-sequence leaves orphaned gallery images or pins pointing at a deleted page. Suggested fix: wrap in `db.transaction('rw', db.pages, db.images, db.pins, …)` (mirrors `deleteCalendar`).

**2.3 · `src/snapshots.ts:13-32` · low · `maybeTakeSnapshot` is not concurrency-guarded.** It is called from the App start effect, which StrictMode double-invokes in dev (the repo already fixed this class of bug for `seedTemplates`/`seedDefaultCalendar` via transactions — #95). Two concurrent calls both read the stale `SNAPSHOT_TIME_KEY` and can both snapshot. Retention trimming bounds the damage; still worth the same in-flight-promise guard the seeds got.

**2.4 · `src/routes/SettingsRoute.tsx:98-108` · low · `confirmImport` has no `catch`.** `try { … } finally` resets `busy`, but an `importAll` failure (e.g. duplicate ids in a crafted backup → `bulkAdd` throws) surfaces only as an unhandled rejection. The transaction rollback protects the data, but the user sees no error — just no "Backup restored" alert. Suggested fix: catch and `alert`/banner the failure.

**2.5 · `src/routes/SettingsRoute.tsx:125-139` · low · Numeric settings persist `NaN`.** Clearing a number input makes `valueAsNumber` `NaN`, which `setField` writes to settings. In `maybeTakeSnapshot`, a `NaN` threshold makes `changed < NaN` false, so a snapshot fires on *every* qualifying call; `NaN` retention hits `saveSnapshot`'s trim logic. Suggested fix: guard `Number.isFinite` before `setField`.

**2.6 · Effect/teardown sweep · pass.** All observers and subscriptions checked have cleanup: `IntersectionObserver` (`TableOfContents.tsx:57`), `ResizeObserver` (`GraphView.tsx:89`), liveQuery subscription (`App.tsx:53`), hover-bus listeners (`wikiLinkHover.ts:52`), capture-phase keydown (`LoreEditor.tsx:231`), click-timer on unmount (`GraphView.tsx:104`). The module-level liveQuery in `schema.ts:208` is an intentional app-lifetime singleton. Quota errors from fire-and-forget writes reach `installStorageErrorListener` via `unhandledrejection` as designed; non-quota errors are deliberately ignored there (acceptable, but see 2.4 for the one interactive path that deserves better).

**2.7 · `src/db/calendar.ts:64-85` · pass.** `updateCalendar` recomputes all dependent events inside one `rw` transaction — atomic as documented. `addEvent`/`updateEvent` recompute correctly, including calendar switches.

### Pass 4 — Logic integrity (HIGH priority)

**4.1 · `src/db/graph.ts:178-190` + `src/routes/GraphRoute.tsx:129-136` · med · Island colouring computed over sim-mutated links.**
`GraphRoute` passes the cloned `filtered` object to `ForceGraph2D`, which (as the repo itself documents) mutates `link.source`/`link.target` from id strings into node objects. The `islandColors` memo depends on `[colorBy, filtered]` — so when the user switches Color-by to **Island** *without changing a filter*, it recomputes over the already-mutated links. `connectedComponents`' `present.has(l.source)` then fails for every link (objects, not ids), all edges are ignored, and every visible node is reported as its own single-node island (toolbar shows "0 islands"). The declared type `Pick<GraphLink,'source'|'target'>` hides this at compile time. Repro: open `/graph` in any colour mode, wait a tick, switch to Island. Any subsequent filter change rebuilds `filtered` fresh and "fixes" it, which is why it can look intermittent. **Proposed failing test** (in `src/db/` graph tests): call `connectedComponents(['a','b'], [{source: {id:'a'}, target: {id:'b'}} as never])` and assert one 2-node component — currently returns two singletons. Suggested fix: coerce endpoints (`typeof end === 'object' ? end.id : end`, exactly like `GraphView.endId`) inside `connectedComponents`, or have the memo map links back to id form before calling it. Not applied: the cleanest fix widens a barrel-exported signature (excluded by §4 of the instructions).

**4.2 · `src/htmlExport.ts:151,160,179` · med · Export resolves titles case-sensitively.** `titleToId` is keyed by exact `p.title`, and lookups use the raw `data-title` attribute / citation target. Every in-app resolver (`findPageIdByTitle`, `linkedTitles`, `buildGraphData`) lowercases both sides. A link written as `[[mordor]]` to page "Mordor" works in-app but exports as a `broken-link` span; same for the backlink index and reference links. Suggested fix: key and look up by `title.trim().toLowerCase()` throughout `buildHtmlSite`.

**4.3 · `src/htmlExport.ts:23-57,71-79,97` · med · Unescaped interpolation into exported HTML.** `page.title`, `page.category`, infobox `label`/`value`, gallery `caption`, and citation `text`/`locator`/`quote` are template-interpolated raw. In-app these fields are React-escaped, and the import sanitizer explicitly skips them on that basis (`db/backup.ts:180`) — but the HTML export is a second sink where that rationale doesn't hold. A title `<script>…</script>` (self-authored or from an imported backup) ships live in the exported site; even benignly, a title containing `&`/`<` produces malformed markup. Suggested fix: a small `escapeHtml` applied to every plain-text interpolation in `buildHtmlSite` (body HTML stays raw — it's Tiptap-emitted and sanitized on import). `buildHtmlSite` is pure and already unit-tested, so this is very testable; left as a recommendation because it touches many call sites in one pass.

**4.4 · `src/calendar.ts` · pass.** `dateToAbsolute`/`absoluteToDate` round-trip correctly, including negative years (floor-division + remainder normalization) and the `yearLength === 0` guard; weekday math normalizes negative moduli; `ordinal()` is correct for 1–3, 4–20, 21st/22nd…, 111th (the `(v-20)%10` negative-index trick resolves through the fallbacks correctly).

**4.5 · `src/autolink.ts` · pass.** Longest-first alternation gives longest-match-wins; regex metacharacters escaped; word boundaries via Unicode lookaround; first-unseen-per-title planning matches spec. `src/citations.ts` / `src/html.ts` parsers: no issues.

**4.6 · `src/db/backup.ts:73-108` · pass, one nit.** The migration ladder composes correctly from any version (including unversioned legacy = v1) and each step is idempotent-shaped. Nit (info): `migrateBackup` silently accepts a backup stamped with a *future* `schemaVersion` (> 9) — the loop no-ops and import proceeds against a shape this app may not understand. Suggested: reject or warn on `schemaVersion > CURRENT_SCHEMA_VERSION`.

**4.7 · `src/backup.ts:51-60` · info · Pre-import backup skip-check omits `regions` and `images`.** `downloadPreImportBackup` counts 6 of 8 tables to decide "DB is empty, skip". A DB whose only data is regions/images would skip the recovery download. Practically unreachable (regions need maps, images need pages), hence info.

**4.8 · `src/db/pages.ts` + `createPage` · info · Duplicate titles are only prevented on rename.** `renamePage` throws on a clash but `createPage` never checks, and title lookups (`findPageIdByTitle`, `idByTitle` in the graph) silently pick one winner. Worth a human decision on whether creation should warn.

### Pass 1 / Pass 5 — Structure & quality (report-only, LOW priority)

- `src/components/TimelineVertical.tsx:28` · info: `yearLength(displayCal)` is recomputed inside the per-event loop (and `eraForYear` re-sorts eras per event). Hoist both out of `groupByEra`'s loop; harmless at current scales.
- `src/routes/GraphRoute.tsx` vs `GraphView.tsx` · observation: the "link ends may be id or object" coercion (`endId`) lives only in `GraphView`; `db/graph.ts` consumers assume strings. This split is the root of finding 4.1 — a shared helper (or normalizing at the boundary) would remove the class of bug.
- `CLAUDE.md` ↔ code drift: none found that matters; the module map matches the tree. `barrel.test.ts` passes, so `src/db/index.ts` re-exports are complete.
- No `TODO`/`FIXME`/`HACK` markers anywhere in `src/`.
- Build warning (pre-existing): `src/lores.ts` dynamically imports `src/db/index.ts`, which is also statically imported app-wide, so the dynamic import can't split — a candidate for human review only (do not "fix" by reorganizing the barrel).

### Pass 6 — Iteration regression (read-only git)

- Sanitization history is short and clean: introduced at `0d32dae` ("sanitize stored HTML on import", #8/#59), later touched only by a test pinning citation-marker survival (`ac48714`). No whitelist widening ever occurred. ✓
- Backup versioning (`5bae125`) predates the barrel split (`211d4b7`); each subsequent schema change (`1ebdee2`, `523a56e`, `93a9292`, `b32cbf1`) added its matching `MIGRATIONS` entry — the discipline mandated by `CLAUDE.md` has actually been followed. ✓
- `src/search.ts` history (`11e3c0c` → `5647241`): the snippet path (and the XSS in finding 3.1) dates from the original FlexSearch module and survived the incremental-sync rewrite unchanged — it predates the import-sanitization work, which is why it was never in scope for that pass. Worth a human eye on whether other pre-#8 render paths were similarly grandfathered (I found none, but the sweep covered `src/` only).

---

## 3. Applied changes (one fix, allowlist-qualifying)

**Fix: escape search snippets before markup injection** — `src/search.ts` (finding 3.1).
Qualifies under §4 of the instructions: local to one file; `highlightSnippet(snippet, query): string` signature unchanged; no landmine touched (`src/sanitize.ts` untouched); no new dependency; proving tests added.

```diff
--- a/src/search.ts
+++ b/src/search.ts
@@ -37,11 +37,30 @@ function extractSnippet(text: string, query: string, maxLen = 160): string {
   return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '')
 }
 
+/** Escape HTML special characters. The snippet is plain text (stripHtml decodes
+ *  entities), but SearchModal injects the result via dangerouslySetInnerHTML, so
+ *  every text run must be escaped or stored text like "<img onerror=…>" (typed as
+ *  visible text, or carried by an imported backup) would render as live markup. */
+function escapeHtml(s: string): string {
+  return s
+    .replace(/&/g, '&amp;')
+    .replace(/</g, '&lt;')
+    .replace(/>/g, '&gt;')
+    .replace(/"/g, '&quot;')
+}
+
 export function highlightSnippet(snippet: string, query: string): string {
   const q = query.trim().split(/\s+/)[0] ?? ''
-  if (!q) return snippet
-  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
-  return snippet.replace(re, '<mark>$1</mark>')
+  if (!q) return escapeHtml(snippet)
+  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
+  let out = ''
+  let last = 0
+  let m: RegExpExecArray | null
+  while ((m = re.exec(snippet)) !== null) {
+    out += escapeHtml(snippet.slice(last, m.index)) + '<mark>' + escapeHtml(m[0]) + '</mark>'
+    last = m.index + m[0].length
+  }
+  return out + escapeHtml(snippet.slice(last))
 }
```

Matching happens on the **raw** snippet (offsets), escaping on each text run — so highlight behaviour is byte-identical for benign text (case-insensitive, all occurrences, original casing preserved, regex metacharacters in the query still literal), while no snippet character can reach the DOM unescaped.

**Proving tests** — added `describe('highlightSnippet')` to `src/search.test.ts` (5 tests): benign highlight (single + multiple occurrences, case preserved); `<img onerror>` payload neutralized around a match; `<script>` payload neutralized with no match; escaping on empty query; regex-metacharacter query stays literal. The payload tests fail against the old implementation.

**Gate after fix: green.** `npm run lint` ✓ · `npm run build` ✓ (same two pre-existing warnings as baseline) · `npm run test:run` ✓ 406/406 (was 401).

Files modified: `src/search.ts`, `src/search.test.ts`, plus this report. Nothing else.

---

## 4. Deferred recommendations (for a human)

1. **Escape plain-text fields in the HTML export** (4.3) and **make its title resolution case-insensitive** (4.2) — both in `src/htmlExport.ts`; `buildHtmlSite` is pure and tested, so this is a well-contained PR (`version:patch`).
2. **Fix island-mode link coercion** (4.1): teach `connectedComponents` to accept object-or-string endpoints (mirroring `GraphView.endId`) or normalize in `GraphRoute`'s memo; add the failing test described in 4.1.
3. **Move `renamePage`'s read + clash check inside its transaction** (2.1) and **wrap `deletePage`'s cascade in one** (2.2).
4. **Guard `maybeTakeSnapshot` against concurrent invocation** (2.3), the same treatment the startup seeds received in #95.
5. **Surface `importAll` failures to the user** in `SettingsRoute.confirmImport` (2.4), and **reject `NaN` in numeric settings inputs** (2.5).
6. Decide policy on **future-versioned backups** (4.6 nit) and **SVG data-URLs in the gallery import filter** (3.4).
7. Decide whether **`createPage` should warn on duplicate titles** (4.8).

## 5. Skipped as N/A (backend-only rubric steps)

SQL injection · server auth/authz/IDOR · JWT · CORS · HTTP security headers · cleartext transmission · hardcoded-secret & `.env` scans · startup env validation · cryptographic-hash review · registry/supply-chain network checks (dependency check done read-only against local `node_modules` instead) · CI-pipeline integration & "block merge" remediation · running the app against real data.

## 6. Untouched by policy (landmines deliberately not modified)

- Port `5174` (`vite.config.ts`, `start-lore-codex.cmd`).
- Dexie version ladder (`src/db/schema.ts` v1–v9), `CURRENT_SCHEMA_VERSION`, and the `MIGRATIONS` ladder (`src/db/backup.ts`).
- Barrel `src/db/index.ts` export organization.
- `src/sanitize.ts` DOMPurify whitelist and its callers (the applied fix is in `src/search.ts` and does not touch the whitelist or any `sanitizeHtml` call site).
- `.github/workflows/` and test env pragmas.
- `uid()` / ID generation (`crypto.randomUUID()` — and note the rubric's `Math.random` "weak crypto" flag is a confirmed false positive here: no `Math.random`-based IDs exist).
- No git write operations, no dependency changes, no network calls, no dev server, and no import/clear/delete path was ever executed.
