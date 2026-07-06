# Lore Codex — Codebase Audit

*Read-only audit, 2026-07-06, at v0.23.0 (commit `d3ef41e`). Diagnosis only — no code was changed.*

---

## 1. Executive summary

This is a healthy codebase — unusually so for a solo local-first app. Type safety is genuinely strict (zero `any`/`@ts-ignore` in `src/`), all 606 tests pass, lint and `tsc -b` are clean, `npm audit` reports zero vulnerabilities, transactions are used consistently for multi-table mutations, imports are sanitized and version-migrated, and the platform seam is lint-enforced. The comment discipline (every non-obvious decision explains itself) makes the code easy to audit.

The real weaknesses cluster in three places: **feature-set drift** (the manuscript tables were added in v11, but rename-rewriting, delete-cascades, and the backup-overdue banner were never taught about them), **a second HTML sink that escaped the sanitization story** (the static HTML export interpolates image attributes raw), and **write/read amplification on the editor hot path** (a keystroke triggers a full-content DB write plus at least four full-table reads, which the inline data-URL images will eventually turn into seconds of jank). None of these are silently corrupting data today; two of them (C1, C3) can silently *lose* work in realistic sequences.

### Fix-first shortlist (severity ÷ effort)

| # | Finding | Dimension | Severity | Effort |
|---|---------|-----------|----------|--------|
| C3 | Backup-overdue banner is blind to manuscript edits | Correctness | High | XS |
| C1 | `renamePage` doesn't rewrite links in scenes or event descriptions | Correctness | High | S |
| S1 | Attribute injection in static HTML export (`infobox.image`, gallery `dataUrl`) | Security | High | S |
| P1 | Per-keystroke full-content write + ≥4 full-table reactive reads | Scalability | High | M |
| P3 | Auto-snapshots multiply origin quota usage ~11× | Scalability | Medium | S |
| C2 | `deletePage` cascade misses regions, events, and scene refs | Correctness | Medium | S |
| T1 | `parseBackup` trusts row shapes; malformed backup bricks the app | Type safety | Medium | M |

---

## 2. Methodology

**Read in full:** `CLAUDE.md`, `package.json`, `vite.config.ts`, `eslint.config.js`, both workflows, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/lib.rs`; all of `src/db/` (schema, types, pages, backup, snapshots, calendar, manuscript, maps, graph, templates seeding, repositories, barrel); the seams `main.tsx`, `App.tsx`, `platform.ts`, `sanitize.ts`, `storageError.ts`, `search.ts`, `calendar.ts`, `autolink.ts`, `manuscriptExport.ts`, `htmlExport.ts` (first 120 lines), `html.ts`, `imageUtils.ts`, `settings.ts`, `lores.ts`, `loreId.ts`, `snapshots.ts`, `backup.ts`; the hot components `LoreEditor.tsx`, `PageRoute.tsx`, `usePage.ts`, `BackupBanner.tsx`, `extensions/Autolink.ts`; and the key test files `db/backup.test.ts`.

**Ran (read-only):** `npm run test:run` (77 files, 606 tests, all pass, 8.3s), `npm run lint` (clean), `npx tsc -b --force` (clean), `npm audit` (0 vulnerabilities), `npm ls --depth=0`. Grepped for: raw HTML sinks, `any`/ts-suppressions, swallowed catches/`console.log`/TODOs, fire-and-forget CRUD call sites, `localStorage`/`window.location`/`createObjectURL` outside the seam, `lazy(`/dynamic imports.

**Not examined:** most route/component bodies (`MapRoute`, `TimelineRoute`/`TimelineHorizontal`, `GraphRoute`/`GraphView`, `BookRoute` internals, `SettingsRoute` beyond the restore path), the CSS, `wikiAutocomplete`/`wikiLinkHover` internals, `htmlExport.ts` past line 120, most test file contents (I mapped names/counts, and read `db/backup.test.ts` fully). No runtime profiling was done — all performance thresholds below are reasoned estimates from the code, not measurements, and are marked accordingly.

---

## 3. Findings by dimension

### 3.1 Correctness & data-integrity risks

**C1 — `renamePage` doesn't rewrite wiki-links in manuscript scenes or timeline-event descriptions · High · S · High confidence**

- *Evidence:* `src/db/pages.ts:139` — the rename transaction spans only `db.pages` and rewrites only page bodies/infoboxes. But scene prose is Tiptap HTML containing the same `<a data-wikilink data-title>` anchors (`src/db/types.ts:235`, and `sceneAppearances` at `src/db/manuscript.ts:262` explicitly matches `wikiLinkTitles(s.content)` against the page title), and event descriptions are authored in `LoreEditor` too (`src/components/EventEditor.tsx:283-286`).
- *Impact:* Concrete trigger: write `[[Alice]]` into a scene → rename the Alice page to "Alicia" → the scene's link now points at a non-existent title, the "Appears in" panel on Alicia's page silently drops the mention, and clicking the link in a rendered event description offers to *create a new page* under the dead name. The whole point of `renamePage` ("so no [[links]] break", its own docstring) is violated for two of the three link-bearing stores — silently.
- *Remedy:* Extend the `renamePage` transaction to `db.scenes` and `db.events`, reusing the body half of `rewriteLinksInPage` (it already handles `data-wikilink` and `data-citation` anchors). Add tests mirroring the existing page-rewrite tests.
- *Trade-off:* The rename transaction grows to scan scenes/events too — slower renames on large manuscripts, and a wider lock. Acceptable: renames are rare and already O(all pages).

**C2 — `deletePage`'s cascade misses map regions, timeline events, and scene refs · Medium · S · High confidence**

- *Evidence:* `src/db/pages.ts:48-63` unlinks `pins.pageId`, deletes gallery images and docLinks — but not `regions.pageId` (indexed at `schema.ts:182`), not `events.pageId` (`schema.ts:162`), and not `scenes.povPageId`/`castPageIds`/`locationPageIds` (`types.ts:242-244`).
- *Impact:* After deleting a page: a region still "links" to the dead id (its type quietly degrades to Untyped via `linkedPageType`, `src/db/maps.ts:43`), a timeline event's page link navigates to "This page doesn't exist", and a scene's POV/cast/location picker shows a dangling ref. No data is lost, but the dangling ids are permanent and invisible until stumbled on — and any future code that assumes a non-null `pageId` resolves will misbehave.
- *Remedy:* Extend the existing delete transaction with `regions`/`events` unlink passes (mirror the pins pattern) and a scenes pass that filters the id out of the three ref fields.
- *Trade-off:* A slightly wider transaction; scenes lack a per-ref index so that pass is a table scan — fine at manuscript scale.

**C3 — The backup reminder is blind to manuscript edits · High · XS · High confidence**

- *Evidence:* `src/backup.ts:67-79` (`latestChangeTime`) and `:94-105` (`unbackedChangeCount`) cover pages, maps, events, calendars, and images — not books/chapters/scenes. `BackupBanner.tsx:26-27` returns `null` whenever `hasUnbackedUpChanges(...)` is false, so the time-based "overdue" escalation never even gets evaluated. The snapshot trigger *does* count `scenesChanged` (`src/snapshots.ts:33`) — the asymmetry shows this is an omission, not a decision.
- *Impact:* Concrete trigger: a user backs up, then spends two weeks writing only their novel (scenes). `latestChangeTime` never advances, the banner never appears, and the novel exists nowhere but one browser origin's IndexedDB. This is the app's own stated worst case ("this app's whole value is the user's data") with its primary mitigation disabled.
- *Remedy:* Add `db.scenes.orderBy('updatedAt').last()` (the index exists, `schema.ts:244`) to `latestChangeTime`, and a `scenes.where('updatedAt').above(since).count()` to `unbackedChangeCount`; books/chapters can piggyback on `updatedAt` scans if wanted.
- *Trade-off:* None meaningful — both are cheap indexed reads.

**C4 — Non-quota write failures are silent, and nothing guards multi-tab access · Medium · M · Medium confidence**

- *Evidence:* Nearly every mutation is fire-and-forget from event handlers (e.g. `SceneMetaPanel.tsx:12`, `MapRoute.tsx:380`, `HomeRoute.tsx:88`, `PageRoute.tsx:246`). The safety net, `installStorageErrorListener` → `reportStorageError` (`src/storageError.ts:53-57`), deliberately ignores anything that isn't a quota error. So a `DatabaseClosedError`, `ConstraintError`, or `TransactionInactiveError` rejection vanishes into the console while the user keeps typing. The realistic trigger is two tabs: tab B runs `importAll` (clear + bulkAdd, `db/backup.ts:309`) or `deleteLore` (`lores.ts:102`) while tab A is mid-edit — tab A's writes fail or land in a replaced dataset with no signal. Related: `switchLore` calls `window.location.reload()` immediately after `setCurrentLore` (`lores.ts:34-38`); an in-flight keystroke save can be dropped at that instant (small window, low frequency).
- *Impact:* Silent loss of recent edits in a scenario (multiple tabs on the same origin) that nothing in the app prevents or detects.
- *Remedy:* Two independent pieces: (1) widen `reportStorageError` to raise a generic "recent changes may not have saved" notice for *any* Dexie rejection reaching `unhandledrejection`, with the quota message as the specialized case; (2) a `BroadcastChannel` (or Dexie's `versionchange` event) that makes other tabs freeze into a "this world changed in another tab — reload" overlay when an import/delete/switch happens.
- *Trade-off:* (1) risks false-positive banners from non-write rejections that happen to bubble; needs an error-name allowlist. (2) adds cross-tab machinery to an app that otherwise has none. Confidence is Medium only on frequency-in-practice, not on the mechanism — the code paths are clear.

**Verified clean:** the `MIGRATIONS` ladder is consistent — `CURRENT_SCHEMA_VERSION` (12, `db/backup.ts:34`) matches the Dexie ladder top (`schema.ts:251`), every gap (3, 6, 12) is a genuinely additive no-op documented in place, newer-versioned backups are refused before any `clear()` (`db/backup.ts:179-184`), and `parseBackup` runs before the destructive transaction. Import is one all-or-nothing transaction, so a mid-import quota failure rolls back rather than half-wiping. StrictMode double-invocation of the startup seeds is handled three different, correct ways (`seedTemplates` rw-tx, `seedDefaultCalendar` rw-tx, `bootstrapDefaultLore`/`maybeTakeSnapshot` in-flight promise). `importLoreFromBackup` rolls back both the registry row and the DB on failure (`lores.ts:81-90`).

### 3.2 Security surface

**S1 — Attribute injection in the static HTML export via unescaped `infobox.image` and gallery `dataUrl` · High · S · High confidence**

- *Evidence:* `src/htmlExport.ts:52-53` interpolates `page.infobox.image` raw into `src="…"`; `:63` does the same with `img.dataUrl`. Neither value is covered by import sanitization: `sanitizeBackup` (`db/backup.ts:261-296`) never touches `infobox.image` at all, and its gallery filter only checks `dataUrl.startsWith('data:image/')` — which the payload `data:image/png" onerror="alert(1)` passes. In-app both render through React attribute binding (safe, e.g. `Infobox.tsx:89`), so the exported site is the *only* sink where this fires — exactly the "second raw sink" class the sanitize module's own header warns about.
- *Impact:* Concrete chain: user imports a shared/crafted backup (the app's one acknowledged untrusted input) → later clicks Settings → "Export as HTML site" → the generated site carries live event handlers that execute for anyone who opens or hosts it. The user becomes an unwitting XSS distributor; if the export is hosted on a real origin, it's exploitable there.
- *Remedy:* Belt and braces: (a) run every attribute interpolation in `htmlExport.ts` through `escapeHtml` (it already escapes `"`); (b) validate `infobox.image` at import with the same data-URL filter the gallery gets, and tighten that filter to reject values containing `"` or whitespace (a legitimate data URL has neither).
- *Trade-off:* None — legitimate data URLs are unaffected by either change.

**Otherwise clean, and verifiably so.** The in-app sinks are all guarded: `TimelineVertical.tsx:124` re-sanitizes at render (defence-in-depth over import sanitization), `SearchModal`'s `dangerouslySetInnerHTML` receives text that `highlightSnippet` escapes run-by-run (`search.ts:52-64`, tested), and everything else is React-escaped text. `sanitizeHtml` is a strict DOMPurify whitelist of exactly what Tiptap emits (`sanitize.ts:27-48`), applied at the import boundary for all three HTML-bearing fields (page content, event descriptions, scene content — `db/backup.ts:261-268`), with SVG data-URLs excluded specifically for their script-embedding ability, and DOMPurify tests correctly pinned to jsdom. The Tauri surface is genuinely minimal: CSP has no `unsafe-eval`, `object-src 'none'` (`tauri.conf.json:25` — `style-src 'unsafe-inline'` is required by Tiptap/Leaflet inline styles and is acceptable); capabilities grant only dialog-mediated file access plus `$APPDATA` writes (`capabilities/default.json`); the Rust side is plugin registration only (`lib.rs`). **One forward-looking note:** the moment a future phase adds broader fs scopes or a custom Tauri command, `importAll`'s "untrusted data enters only on import" assumption must be re-audited — S1 shows how a field can slip past the boundary when a new sink appears.

### 3.3 Futureproofing & scalability

**P1 — One keystroke = one full-content write + ≥4 full-table reads · High · M · High confidence**

- *Evidence:* The chain: `LoreEditor.tsx:155` fires `onChange(editor.getHTML())` on every Tiptap transaction (every keystroke), `PageRoute.tsx:246` maps that straight to `update({ content: html })` with no debounce — so each keystroke serializes the whole document and writes the full `content` string to IndexedDB. That write invalidates every `db.pages` liveQuery: `App.tsx:64-69` re-runs `pageRepo.list()` (full table hydration; `syncIndex` itself diffs cheaply, but the *read* is O(all records)), `PageRoute.tsx:46-56` re-runs two more full `pageRepo.list()` calls (knownTitles, autolinkTitles), and `BackupBanner.tsx:22-23` re-runs `latestChangeTime` + `unbackedChangeCount`, which call `db.images.toArray()` — hydrating **every gallery image's data-URL bytes** — just to compute a max/count (`src/backup.ts:71-77, 99-103`).
- *Impact:* At a few hundred text-only pages this is invisible (the code's own measurement: ~100ms for a 500-page full index rebuild, `search.ts:82`). But page `content` embeds body images as data URLs (~100–400KB each at 1600px JPEG q0.85, `LoreEditor.tsx:244`), and gallery images ride along via the BackupBanner query. Rough threshold: at ~50–100 embedded images (~10–30MB hydrated per keystroke across the four queries), typing latency becomes user-visible; at a 2–5k-page world it's a hard cliff. The write side also churns IndexedDB with hundreds of full-content row rewrites per paragraph typed.
- *Remedy:* Three independent, individually shippable pieces: (1) debounce the content commit (~500ms idle, flush on blur/"Done"/unmount); (2) replace the two title-only PageRoute queries with index-only reads (`db.pages.orderBy('title').keys()` — no record hydration; the `title` index exists); (3) make `latestChangeTime`/`unbackedChangeCount` use `orderBy('createdAt').last()` / indexed `count()` instead of `toArray()` for images and events (events would want an `updatedAt` index, a one-line v13).
- *Trade-off:* (1) up to ~500ms of typed text is unsaved at a crash — with flush-on-blur this is strictly better than today's exposure to C4-style failures, but it must actually flush on route change. (3) costs a schema version bump for the events index.

**P2 — Body images inline in `page.content` are the underlying multiplier · Medium · L · Medium confidence**

- *Evidence:* `LoreEditor.tsx:240-246` embeds compressed data URLs directly into the document; the gallery already solved this correctly (`PageImage` in its own table "so editing page text never rewrites image bytes", `types.ts:52-53`).
- *Impact:* Every cost in P1, plus `exportAll` (single in-memory JSON string of the whole DB, `db/backup.ts:208-249`), snapshots (P3), rename scans, and the search body-strip all scale with image bytes rather than text bytes.
- *Remedy:* A body-image Tiptap node that stores an id into the `images` table and resolves at render. This is an L-effort change with a content migration and is the durable fix; P1's mitigations buy the time to do it properly.
- *Trade-off:* Real migration risk (every existing body must be rewritten once), and export/EPUB paths need to resolve refs back to data URLs. Treat P1 as the near-term fix and this as the roadmap item.

**P3 — Auto-snapshots multiply origin storage ~11× · Medium · S · High confidence**

- *Evidence:* `saveSnapshot` stores the full `exportAll()` string — all pages, all data-URL images, all maps — as one row (`src/db/snapshots.ts:8`), default retention 10 (`settings.ts:16`). Snapshots are correctly excluded from exports, but they live in the same origin-quota bucket as the live data.
- *Impact:* A 100MB world (a handful of maps + a few hundred images gets there) quietly consumes ~1.1GB of quota. The failure mode is nasty: the quota error most likely fires *during a snapshot write* — i.e. the safety mechanism is what tips the world over the cliff, and eviction of the whole origin (if `persist()` was denied) takes live data and all snapshots together.
- *Remedy:* Snapshot only the text tables (skip `images` and `maps`, whose bytes change rarely and are covered by real backups), or dedupe unchanged tables between snapshots by content hash.
- *Trade-off:* Restoring a snapshot no longer restores images/maps — restore must merge them from the live DB (they were never cleared) or the Settings UI must say so explicitly. The merge semantics need care; the meta-merge in `importBackupInto` is precedent.

**P4 — Title resolution and backlinks re-scan/re-parse the corpus per interaction · Low today, Medium at ~2–5k pages · M · High confidence**

- *Evidence:* `findPageIdByTitle` and `createPage`'s clash check hydrate the whole table because matching is case-insensitive and the `title` index is case-sensitive (`pages.ts:36, 67-71`); `getBacklinks` DOMParser-parses every page body on every page view (`pages.ts:184-192`); `sceneAppearances` parses every scene per page view (`manuscript.ts:243-262`).
- *Impact:* Page navigation cost grows linearly with corpus size × body size; the DOMParser work is the expensive part (the same cost `syncIndex` was built to avoid — `search.ts:81-89` shows the pattern *and* the fix).
- *Remedy:* Cache `linkedTitles` per page keyed by `updatedAt` (exactly mirroring the search `store`), and/or persist a lowercased-title indexed field. Not urgent; do it when P1 lands so the wins compound.
- *Trade-off:* Cache/denormalized-field invalidation discipline; a `titleLc` field needs a v13 migration.

The autolinker is *not* a scale problem worth flagging: the alternation regex builds only in view mode when enabled (`extensions/Autolink.ts:68-76`), and single-regex longest-match-wins over a few thousand titles is fine.

### 3.4 Architecture & maintainability

**A1 — The storage-agnostic seam covers 2 of ~10 data domains · Medium · M (ongoing) · High confidence**

- *Evidence:* `repositories.ts:16-18` says it plainly: "Scope: pages + maps… Other tables still use their module functions directly and are a follow-up sweep." Meanwhile `usePage.ts:29` reaches past the seam into `db.templates` directly even though it goes through `pageRepo` for pages in the same hook, and every manuscript/calendar/settings call site binds the Dexie singleton transitively at import.
- *Impact:* The planned storage swap (`docs/desktop-transition-investigation.md`, #142) still means touching every module; worse, the half-seam invites drift — new code has two idioms to copy from and the wrong one is currently the majority.
- *Remedy:* Continue the sweep domain-by-domain (templates and meta are the smallest next bites, and `usePage` is the one-line inconsistency to fix first). Consider an ESLint `no-restricted-imports` on `./schema`'s `db` from components, mirroring the successful platform-seam rule.
- *Trade-off:* Interface boilerplate for tables that may never need a second backend; the lint rule needs carve-outs for the db modules themselves.

**A2 — `escapeHtml` is hand-rolled three times · Low · XS · High confidence**

- *Evidence:* `search.ts:44`, `htmlExport.ts:13`, `manuscriptExport.ts:7` — three copies, all currently identical in effect.
- *Impact:* These are XSS-load-bearing functions. A future edit to one copy (or a fourth copy missing `"`) is exactly how S1-class bugs are born.
- *Remedy:* One export in `html.ts` (the module that already owns shared HTML concerns).
- *Trade-off:* None.

Otherwise the architecture holds up well: the barrel + `barrel.test.ts` keeps the public surface honest, `html.ts` genuinely is the single DOMParser home (the only other raw parse is `rewriteLinksInPage`, which goes through `parseHtml`), pure cores are cleanly split from Dexie CRUD (`calendar.ts` vs `db/calendar.ts`, `autolink.ts` vs the extension, `buildEpub`/`compileBookHtml` vs their wrappers), and the platform seam is both real and lint-enforced (`eslint.config.js:25-36` — verified no violations). The module-bound `db` singleton + reload-to-rebind is a documented trade-off; its residual risk is the in-flight-write window noted in C4.

### 3.5 Type safety & correctness guards

**T1 — Backup rows are cast, not validated; a malformed backup imports cleanly and then bricks the app · Medium · M · High confidence**

- *Evidence:* `parseBackup` checks JSON-ness and `Array.isArray(pages)`, then `raw as BackupData` (`db/backup.ts:175-185`). Row shapes are never checked: a page with `title: 42` or missing `tags` sails through `sanitizeBackup` (which only rewrites `content`) into `bulkAdd`. Downstream, every full-table consumer assumes the shape: `linkedTitles` calls `page.title.trim()` transitively via `getBacklinks`/`buildGraphData`, `indexText` calls `page.tags.join` (`search.ts:26`) — the search-sync liveQuery in `App.tsx` means one bad row throws on *every* subsequent edit, app-wide. Separately, imported `meta` rows bypass `updateSettings`'s clamping: `getSettings` spreads stored values raw (`settings.ts:34-35`), so a backup carrying `snapshotRetention: "x"` makes `count > keep` permanently false in `saveSnapshot` (`db/snapshots.ts:12`) — snapshots never prune again, silently compounding P3. (The Settings UI is aware of the NaN hazard — `SettingsRoute.tsx:58` — but import doesn't go through it.)
- *Impact:* The data is intact but the app is unusable, which for a non-technical user is indistinguishable from data loss. Trigger: any hand-edited, truncated, or adversarial backup.
- *Remedy:* A small normalization pass in `sanitizeBackup`: coerce/verify the handful of load-bearing fields per table (string `id`/`title`, array `tags`, numeric timestamps), *drop* rows that can't be normalized and surface the dropped count in the import confirmation. Clamp settings in `getSettings` (one-line reuse of `clamp`), which also fixes the meta bypass.
- *Trade-off:* Hand-written validators that must track `types.ts` — the discriminated cost of not adding a schema library. Given only ~6 fields per table are load-bearing, hand-rolled is proportionate.

Beyond T1, this dimension is clean and worth saying plainly: `strict` TS with **zero** `any`, `as any`, `@ts-ignore`, or `@ts-expect-error` in non-test `src/` (grep-verified); non-null `!` assertions are rare and locally justified (e.g. `graph.ts:107` after explicit map seeding); `MetaEntry.value` is honestly `unknown`; and the repo layer resolves Dexie's `update` overloads by branching instead of casting (`repositories.ts:124-129`).

### 3.6 Testing & verifiability

The baseline is strong: 77 files / 606 passing tests covering the migration ladder step-by-step, versioned + legacy round-trips, refusal of newer-version backups, import sanitization under jsdom (with the happy-dom pitfall documented and worked around), calendar absolute-day math, autolink planning, EPUB structure, and the meta merge semantics (`db/backup.test.ts` is exemplary — it tests the *design choices*, with comments saying which choice each test guards). The gaps that matter are precisely the untested claims behind findings above:

1. **V1 (S):** rename-rewrite tests for scene content and event descriptions — would have caught C1. Bug class: silent referential breakage.
2. **V2 (XS):** `deletePage` cascade assertions for `regions.pageId`, `events.pageId`, scene refs — would have caught C2. Bug class: dangling-id orphans.
3. **V3 (S):** export-XSS regression tests: run `exportAsHtml` over a page whose `infobox.image` is `x" onerror="…` and a gallery row with a quote-bearing data URL; assert the output attribute-escapes — catches S1 and pins every future export sink.
4. **V4 (S):** malformed-row import fuzz: `pages: [{ id:1, title:42 }]` through `importAll`, then assert search-sync/graph don't throw — catches T1.
5. **V5 (XS):** `latestChangeTime` advances when only a scene changes — catches C3.

No coverage-for-coverage's-sake items beyond these; component coverage is already unusually broad for an app this size.

### 3.7 Performance & responsiveness

The dominant issue is P1 (above). Remaining, smaller items:

**Pe1 — Image compression runs synchronously on the main thread · Low · S · High confidence.** `compressImage` (`imageUtils.ts:6-27`) does decode → canvas draw → `toDataURL` on the UI thread; a 20MP photo freezes the editor for the duration. Remedy: `createImageBitmap` + `OffscreenCanvas` in a worker, or at minimum `canvas.toBlob` (async) over `toDataURL`. Trade-off: worker plumbing for a rare interaction — fine to defer.

**Pe2 — Only `GraphView3D` is code-split · Low · S · High confidence.** `GraphRoute.tsx:15` lazy-loads the three.js path (good), but Leaflet + leaflet-draw, react-force-graph-2d, JSZip, and all routes load eagerly in the entry chunk (`App.tsx:4-27`, no other `lazy(` in `src/` — grep-verified). Local-first means no network cost, but parse/execute cost hits every startup, including the desktop shell's window open. Remedy: `React.lazy` the map/graph/book routes. Trade-off: suspense fallbacks and a small flash on first route entry.

Also credit where due: the search index diffing (`syncIndex` skipping unchanged pages by `updatedAt`), the autolink matcher gating, `buildGraphData` running on-demand in a route `useMemo` rather than per-save, and derive-don't-mirror state (`PageRoute.tsx:82-87` resetting during render per react.dev guidance) are all the *right* patterns already in place.

### 3.8 Dependency & supply-chain health

Genuinely healthy: `npm audit` — **0 vulnerabilities**; every major is current (React 19.2, Vite 8, TypeScript 6.0, ESLint 10, Tiptap 3, Dexie 4, react-router 7, Tauri 2); the `esbuild ^0.28.1` override shows active supply-chain attention; no duplicated majors in `npm ls`.

Two low-grade watches:

- **D1 — `leaflet-draw` 1.0.4 · Low · spike:** last released ~2018, effectively unmaintained against Leaflet 1.9. It works today; the risk is being stranded on a Leaflet 2.x migration. Alternatives (`leaflet-geoman`) exist. No action now — just don't build more on its API surface than `MapView` already does.
- **D2 — `@types/flexsearch` 0.7.6 against `flexsearch` 0.8.212 · Low · XS:** the types lag the library by a minor with API changes; the `as string[]` cast at `search.ts:116` is the visible symptom. Check whether 0.8 ships its own types and drop the `@types` package if so.

react-force-graph-2d **and** -3d both being dependencies is intentional (both views exist) and the 3d cost is already lazy-loaded — no finding.

### 3.9 Developer experience & tooling

Short, as instructed — this tier is in good shape. CI runs the same three gates as local on every PR/push (`ci.yml`), the barrel test prevents silent API drift, the port-5174 footgun is pinned with `strictPort` *and* explained in a comment where the next person will trip on it (`vite.config.ts:6-11`), and `version-bump.yml`'s PAT/branch-protection interaction is documented inline. One gap:

**X1 — The Tauri shell is never built in CI · Low · S · Medium confidence.** `ci.yml` runs web lint/build/test on ubuntu only; the shell compiles only when `release.yml` fires on a version tag. A `tauri.conf.json` or capabilities regression is discovered at release time. Remedy: a `windows-latest` job running `npm run tauri build` (or just `cargo check` in `src-tauri`) gated on paths `src-tauri/**`. Trade-off: ~5–10 min of CI on shell-touching PRs.

---

## 4. Positives worth preserving

Cite these so a future refactor doesn't "clean them up":

1. **Sanitize-at-the-boundary + defence-in-depth at the sink** (`db/backup.ts:sanitizeBackup`, `TimelineVertical.tsx:124`). The model is right; S1 is a missed field, not a broken model.
2. **`parseBackup` validates and counts *before* any `clear()`**, and refuses newer-versioned backups (`db/backup.ts:166-206`) — this is the line between "bad file" and "wiped world".
3. **The meta merge-not-clear semantics on import** (`db/backup.ts:330-334`) and the `LOCAL_ONLY_META_KEYS` blacklist with its cycle-aware home (`db/backup.ts:45-47`) — subtle, correct, and test-pinned.
4. **Transaction discipline with StrictMode-aware seeding** — every multi-table mutation is transactional, and all three startup seeds are concurrency-safe by different appropriate means (`templates.ts:197-204`, `db/calendar.ts:30`, `lores.ts:121-124`).
5. **The lint-enforced platform seam** (`eslint.config.js:25-46`, `platform.ts`) — one auditable file for all shell IPC, with per-call detection so tests can flip environments.
6. **Incremental search sync with the measured rationale in the comment** (`search.ts:78-89`) — and the pattern (diff by `updatedAt`, cache the expensive parse) is exactly what P4's fix should copy.
7. **Pure cores split from IO** (`calendar.ts`, `autolink.ts`, `buildEpub`, `buildGraphData`, `graphGeometry` etc.) — this is why the test suite is fast and broad.
8. **Snapshots excluded from `exportAll`** — prevents recursive backup bloat (P3 is about quota, not exports).
9. **The comment culture**: decision-record comments (`why`, `what it guards`, measured numbers) throughout. This audit was fast *because* of them.

---

## 5. Open questions & spikes

1. **P1 threshold measurement (½ day):** build a synthetic 2,000-page world with 100 embedded body images; profile keystroke latency and the four liveQuery re-runs. Confirms (or demotes) P1's severity and gives the debounce a target number.
2. **P3 restore semantics (½ day):** prototype text-only snapshots and decide the restore story for images/maps (merge from live vs. explicit "snapshots don't cover images" copy). Blocks the P3 remedy.
3. **D1 leaflet-draw succession (½ day):** inventory the `leaflet-draw` API surface actually used by `MapView`/`MapRoute` and evaluate `leaflet-geoman` as a drop-in, so a forced migration is a plan, not an emergency.
4. **Multi-tab reality check (hours):** open two tabs, edit in one while importing in the other, and document what actually happens (C4's confidence is Medium on impact frequency; the mechanism is certain but the observed blast radius should be recorded before building the BroadcastChannel guard).
5. **flexsearch 0.8 native types (1 hour):** check if `@types/flexsearch` can be dropped and the `as string[]` cast at `search.ts:116` removed.

---

## 6. Appendix: finding index

| ID | Title | Dimension | Severity | Effort | Confidence | Primary file |
|----|-------|-----------|----------|--------|------------|--------------|
| C1 | Rename doesn't rewrite scene/event wiki-links | Correctness | High | S | High | `src/db/pages.ts` |
| C2 | Delete cascade misses regions/events/scene refs | Correctness | Medium | S | High | `src/db/pages.ts` |
| C3 | Backup banner blind to manuscript edits | Correctness | High | XS | High | `src/backup.ts` |
| C4 | Non-quota write failures silent; no multi-tab guard | Correctness | Medium | M | Medium | `src/storageError.ts` |
| S1 | HTML-export attribute injection (infobox.image, dataUrl) | Security | High | S | High | `src/htmlExport.ts` |
| P1 | Per-keystroke write + ≥4 full-table reads | Scalability | High | M | High | `src/routes/PageRoute.tsx` |
| P2 | Inline body images multiply every full-table cost | Scalability | Medium | L | Medium | `src/components/LoreEditor.tsx` |
| P3 | Snapshots multiply quota ~11× | Scalability | Medium | S | High | `src/db/snapshots.ts` |
| P4 | Per-view corpus scans (backlinks, title resolve, appearances) | Scalability | Low→Med | M | High | `src/db/pages.ts` |
| A1 | Repository seam covers only pages+maps | Architecture | Medium | M | High | `src/db/repositories.ts` |
| A2 | `escapeHtml` triplicated | Architecture | Low | XS | High | `src/html.ts` |
| T1 | Backup rows cast, not validated; settings clamp bypassed | Type safety | Medium | M | High | `src/db/backup.ts` |
| V1 | Missing rename-rewrite tests (scenes/events) | Testing | — | S | High | `src/db/pages.test.ts` |
| V2 | Missing delete-cascade tests | Testing | — | XS | High | `src/db/pages.test.ts` |
| V3 | Missing export-XSS regression tests | Testing | — | S | High | `src/htmlExport.test.ts` |
| V4 | Missing malformed-row import fuzz | Testing | — | S | High | `src/db/backup.test.ts` |
| V5 | Missing manuscript-aware backup-banner test | Testing | — | XS | High | `src/backup.test.ts` |
| Pe1 | Main-thread image compression | Performance | Low | S | High | `src/imageUtils.ts` |
| Pe2 | No route-level code splitting (except 3D graph) | Performance | Low | S | High | `src/App.tsx` |
| D1 | `leaflet-draw` unmaintained | Dependencies | Low | spike | Medium | `package.json` |
| D2 | `@types/flexsearch` version drift | Dependencies | Low | XS | Medium | `package.json` |
| X1 | Tauri shell never built in CI | DevEx | Low | S | Medium | `.github/workflows/ci.yml` |
