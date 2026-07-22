# CLAUDE.md

Guidance for Claude Code working in this repo.

## Models

- **Opus** — planning/design. **Sonnet** — default coding/edits. **Haiku** — cheap mechanical work only when called for.

## Commands

```bash
npm run dev        # Vite dev server (hot reload)
npm run build      # tsc -b + vite build → dist/
npm run lint       # ESLint
npm run preview    # serve built dist/
npm test           # Vitest (watch)
npm run test:run   # Vitest (CI, one-shot)
npm run tauri dev    # desktop shell w/ hot reload (needs Rust toolchain)
npm run tauri build  # desktop NSIS installer → src-tauri/target/release/bundle/
```

- **Port pinned to 5174** (`strictPort` in `vite.config.ts`; `start-lore-codex.cmd` opens Firefox there; `src-tauri/tauri.conf.json` `devUrl` points at it too). IndexedDB is origin-keyed, so a drifting port shows an empty DB that looks like lost data — change it in **all** places or none.
- TS `strict`. CI (`.github/workflows/ci.yml`) runs lint + build + test on PRs/pushes to `main`; run all three before claiming done.
- Tests: Vitest + happy-dom + fake-indexeddb (`*.test.{ts,tsx}`). **DOMPurify tests need jsdom** — add `// @vitest-environment jsdom` (happy-dom's parser lets `<script>` survive).
- **Version labels on every PR.** `.github/workflows/version-bump.yml` bumps `package.json` + tags `vX.Y.Z` on merge to `main`, driven by the PR's label. **Always add one** when opening a PR: `version:minor` for a new feature, `version:patch` for a bug fix or chore, `version:major` for a breaking change. No label ⇒ patch. (If PR checks ever fail to start, suspect a transient GitHub event-delivery incident — check githubstatus.com — not the config; an empty-commit push re-triggers once it recovers.)

## Git workflow

Trunk-based: short-lived branches off `main`, one PR each, **squash-merge**, label drives the version bump, the tag triggers the release. No `develop`, no `release/*` — the repo ships continuously from `main`.

- **Branch from `origin/main`, never local `main`** — `git switch -c type/123-slug origin/main`. Local `main` silently falls behind, because every merge is followed by a bot commit (the version bump) that you didn't pull.
- **Naming: `type/<issue>-<slug>`**, type ∈ `feat` `fix` `chore` `ci` `perf` `docs` `polish`. (History predates this and drifted — `feature/`, bare `graph-*`. Don't imitate those.)
- **Delete at merge time**, not in a later sweep: `gh pr merge --squash --delete-branch`. The repo also has `deleteBranchOnMerge`, and `fetch.prune` should be on locally.
- **Squash-merge breaks `git branch --merged`.** It reports squashed branches as unmerged, so *never* trust it to decide what's safe to delete — check the PR state (`gh pr list --head <branch> --state all`). A July 2026 cleanup found 28 false "unmerged" branches this way, plus one branch that had genuinely never had a PR.
- **Don't use `git stash`.** Two stashes rotted for months holding the only copy of two shipped docs' provenance (`docs/archive/`). GitHub Desktop auto-stashes on branch switch — that's where they came from. Use a WIP commit on a branch: visible, pushable, survives.

**Protection on `main`** (ruleset "main protection"): `deletion`, `non_fast_forward`, `pull_request` (0 approvals — solo repo), and `required_status_checks` on **`verify` only**. Two things to know before touching it:

- **Only require `verify`.** It's the one job that runs on every PR. `desktop.yml`'s `cargo-check` is path-scoped to `src-tauri/**` + `package.json`, so requiring it would permanently block every pure-web PR on a check that never starts.
- **The Admin role is an `always` bypass, and that is load-bearing** — `version-bump.yml` pushes the bump commit and tag straight to `main` with an admin PAT. Narrowing that bypass to `pull_request` mode breaks the release pipeline. The practical consequence: these rules are a guardrail that turns a mistake into a deliberate override, not a wall against the repo owner.

## Architecture

**Lore Codex** — a local-first, in-browser worldbuilding wiki. All data lives in IndexedDB via Dexie; nothing leaves the machine. Reactive reads use `useLiveQuery` (dexie-react-hooks) throughout.

### Data layer — `src/db/`

Single source of truth (types, schema, CRUD, templates, backlinks, graph, export/import) behind a **barrel `index.ts` that re-exports everything**. Always import from `'../db'`; **re-export new public API from `index.ts`** (`barrel.test.ts` fails otherwise).

| Module | Holds |
|---|---|
| `types.ts` | data-model interfaces (no runtime code) |
| `schema.ts` | `LoreDB` + version ladder + `db` singleton, `getMeta`/`setMeta`, category/status defs, `uid()`/`now()` |
| `templates.ts` | page types: built-ins, seeding, infobox/template CRUD |
| `pages.ts` | page CRUD, `renamePage` link-rewriting, backlinks |
| `maps.ts` | maps/pins CRUD + `pinType`, nested maps/regions |
| `images.ts` | image gallery CRUD |
| `graph.ts` | `buildGraphData` |
| `calendar.ts` | timeline calendar/event CRUD (distinct from pure `src/calendar.ts`) |
| `backup.ts` | `exportAll`/`importAll`/`parseBackup` + versioning + import sanitization (`CURRENT_SCHEMA_VERSION` mirrors Dexie store version) |
| `snapshots.ts` | snapshot CRUD |
| `manuscript.ts` | manuscript authoring CRUD: `Book`→`Chapter`→`Scene`, plotline/beat grid, story structures, word counts, `sceneAppearances()` |
| `worldHealth.ts` | `computeWorldHealth(pages)` — pure: broken links, orphans (no incoming links), stubs |

**Per-lore DB:** `db = new LoreDB(dbNameFor(currentLoreId()))` binds at module load, so the active world is fixed for the page's lifetime. `switchLore()` and deleting the active world call `window.location.reload()` to rebind.

**Repository seam (`repositories.ts`):** the UI reaches data through `pageRepo` / `mapRepo` / `templateRepo` / `calendarRepo` / `manuscriptRepo` — **never** the `db` singleton. Lint-enforced (`no-restricted-imports`), mirroring the `platform.ts` rule. Three tiers: **UI** (components/routes/hooks) → repositories only; **infra** (`src/backup.ts`, `searchSync.ts`, `snapshots.ts`, `htmlExport.ts`, `manuscriptExport.ts`) → keeps raw `db` on purpose for whole-DB cross-table work; **data layer** (`src/db/**`) → owns `db`. Tests are exempt. The seam is about having **one idiom**, not portability — a non-Dexie backend would still have to solve invalidation for ~77 `useLiveQuery` sites, which no repository interface reduces (`docs/desktop-transition-investigation.md` §4.1). Adding a UI read means adding a repo method, not reaching past the seam. Note the ESLint carve-outs re-declare the bans they keep — never write `'no-restricted-imports': 'off'`, or the `@tauri-apps` ban silently dies in `backup.ts`/`htmlExport.ts`/`manuscriptExport.ts`.

**Key types:** `LorePage` (HTML `content`, `summary`, `tags`, `status`, optional `Infobox`) · `Infobox`/`InfoboxField` (`kind:'separator'`=heading; `fieldType:'text'|'ref'|'number'`, `'ref'` stores `[[Title]]` tokens bound to `refType`) · `InfoboxTemplate`/`TemplateItem` (a **page type**: named coloured category + starter rows + optional `sections` starter body headings) · `WorldMap`/`MapPin`/`MapRegion` · `Calendar`/`CalendarMonth`/`CalendarEra` · `TimelineEvent` (in-world date + cached `startAbsolute`/`endAbsolute`) · `Snapshot` · `Book`/`Chapter`/`Scene` (`SceneStatus`, POV/cast/location page refs) · `Plotline`/`Beat` (`kind:'plot'|'structure'`, `StructureType`) · `MetaEntry` (Dexie schema **v12**) · `Lore` (in `src/lores.ts`, separate `lore-registry` DB).

**Helpers:** `BUILTIN_TEMPLATES`, `DEFAULT_CATEGORY`, `TYPE_COLORS`, `STATUSES`+`pageStatus()`/`statusColor()`. Page types are DB-backed: `seedTemplates()` (on start) reconciles built-ins (adds missing, removes dropped built-ins, backfills colours + `sections` from `BUILTIN_SECTIONS`; leaves custom types alone); CRUD `getTemplates`/`createTemplate`/`updateTemplate`/`deleteTemplate`/`resetTemplate`; `applyTemplate()` swaps rows preserving values. A type also carries optional `sections` (starter `<h2>` body headings); `sectionNodes()` (`src/sectionNodes.ts`) turns them into editor nodes for the editor's "+ Sections" button. `categoryColor()` reads a `liveQuery`-synced cache. `getBacklinks()`/`linkedTitles()` scan body `<a data-wikilink>` + infobox `[[…]]` (via `src/html.ts`). `renamePage(id, title)` atomically rewrites all references, throws on title clash. `findPageIdByTitle()` is **resolve-only** (callers confirm before creating). Calendar/event mutations recompute cached absolute days and cascade-delete on calendar removal.

### Routing — `src/App.tsx` (hash routing)

`/` is special-cased (full-screen `LoreSelectorRoute`, no shell); every other path renders in the `<Sidebar>` + `<main>` shell with `<BackupBanner>` + `<StorageErrorBanner>`. `App.tsx` mounts global overlays (`SearchModal`, `WikiLinkPopover`), drives the incremental search index (`liveQuery` on `db.pages` → `syncIndex()`), and on start runs `installStorageErrorListener`, `bootstrapDefaultLore`, `requestPersistentStorage`, `seedTemplates`, `seedDefaultCalendar`, `maybeTakeSnapshot`.

| Path | Component | Purpose |
|---|---|---|
| `/` | `LoreSelectorRoute` | world picker (create/rename/banner/delete/switch), no shell |
| `/home` | `HomeRoute` | editable overview: hero/about, stats, recently edited |
| `/page/:id` | `PageRoute` | view/edit: header, editor, infobox, backlinks |
| `/browse/:category` | `CategoryRoute` | page-card grid for a category (`BrowseCard`s) |
| `/tag/:tag` | `TagRoute` | page-card grid for a tag |
| `/map` | `MapRoute` | Leaflet map with pins/regions |
| `/graph` | `GraphRoute` | force-directed relationship graph |
| `/timeline` | `TimelineRoute` | timeline (list or axis view) |
| `/manuscript` | `ManuscriptRoute` | book library (grid of books + word-count stats) |
| `/book/:bookId` | `BookRoute` | book workspace: Write / Grid views, EPUB / Print-PDF compile |
| `/templates` | `TemplatesRoute` | manage page-type templates |
| `/settings` | `SettingsRoute` | per-lore settings, backup/import, HTML export, snapshots, delete world |
| `/health` | `HealthRoute` | world health: broken links, orphans, stubs |

Sidebar groups pages by category (headers link to `/browse/:category`); its search box is read-only and opens `SearchModal` on focus.

### Multiple worlds — `src/loreId.ts` + `src/lores.ts`

Each world is its own IndexedDB. `loreId.ts`: `currentLoreId()` (from `localStorage`, default `'default'`), `dbNameFor(id)` (`'lore-app'` / `'lore-app-<id>'`). `src/registryDb.ts` owns the `lore-registry` DB itself (tables `lores` + `appMeta`, now **v2** — `appMeta` added in its own `version(2)` block); `lores.ts` re-exports `registry`/`Lore` from it and layers world CRUD (`createLore`/`renameLore`/`setLoreBanner`/`deleteLore`/`switchLore`); `bootstrapDefaultLore()` registers `'default'` on first run.

`src/appSettings.ts` holds device-level, app-wide prefs — `openLastWorld`, `spellcheck`/`spellcheckLang`, `backupOnExit`, `defaultBackupDir` — as ONE `appMeta` row (`getAppSettings`/`updateAppSettings`, validate-on-read like `settings.ts`). These deliberately live outside per-world `meta`: per-world `LoreSettings` travels inside that world's backup, and none of these five prefs is a property of a world — keeping them in the registry DB makes them structurally incapable of leaking into a backup. When `openLastWorld` is on, `LoreSelectorRoute` redirects straight to `/home` (pure `shouldOpenLastWorld()`, guarded: once per page-life, only if the remembered world still exists, never when `CURRENT_LORE_KEY` is absent — the just-deleted-my-world case). `LoreEditor` (and `SceneEditor`, which renders it) syncs `spellcheck`/`spellcheckLang` onto the live editor DOM rather than re-creating the editor, so an in-flight edit is never dropped.

### Rich text — `src/components/LoreEditor.tsx` + `src/extensions/WikiLink.ts`

Tiptap with `StarterKit` (Link → external `ext-link`, new tab), `WikiLink` (`[[Page Title]]` inline node, `data-wikilink`/`data-title`), `Citation` (in-line `<sup data-citation>` marker — page-ref or free-text source + locator/quote), `Autolink` (decoration-only, see below), `Image` (data-URL, compressed on insert via `imageUtils.compressImage`), `TableKit` (resizable). View mode: clicking a wiki link resolves via `findPageIdByTitle()`, **confirms before creating** a missing stub (broken targets get `.is-broken`). Edit mode: Ctrl/Cmd-click follows links; hover → `wikiLinkHover.ts` bus (suppressed in edit mode). `wikiAutocomplete.ts` powers `[[`-typing suggestions.

- **Autolinker (`src/autolink.ts` + `extensions/Autolink.ts`):** pure core compiles known titles into one longest-match-wins matcher (`buildTitleMatcher`) and plans the **first unseen** occurrence per title (`planAutolinks`, skipping existing links + the page's own title); the extension renders those as ProseMirror decorations (not stored markup). Toggled by `settings.autolinkEnabled`.
- **Citations (`src/citations.ts` + `components/References.tsx`):** pure `parseCitations(html)` reads markers from a body (like `html.ts`); `References.tsx` renders the numbered list, included in HTML export.

### Timeline & calendars — `src/calendar.ts` + `TimelineRoute`

`calendar.ts` is **pure date math** (no React/Dexie): `dateToAbsolute()`/`absoluteToDate()` map to a shared absolute-day integer so calendars share one axis (no leap rules; `yearLength` = sum of months); plus `eraForYear()`, `formatDate()`. Events cache `startAbsolute`/`endAbsolute`, recomputed on event/calendar change (`updateCalendar()` rewrites all its events in one tx). `TimelineRoute` → `TimelineVertical` (list) / `TimelineHorizontal` (zoom/pan axis); `CalendarEditor`/`EventEditor` modals.

`src/pageChronology.ts` is the **pure** per-page view of the same data: `pageChronology(pageId, title, events, calendars)` returns the events that reference a page — by `event.pageId` (role `linked`) or by a wiki link to its title in `description` (role `mention`) — sorted on the shared `startAbsolute` axis so several calendars read as one chronology. Rendered by `PageHistory.tsx` in the page aside; rows deep-link to `/timeline?event=<id>`, which `TimelineRoute` resolves by deriving the display calendar from the event (pure `resolveDisplayCalendar` in `src/timelineDisplay.ts`: toolbar pick › deep-linked event's calendar › first calendar), scrolling to row id `tl-event-<id>` and flashing it (`.is-focused`), the same shape as `/map?pin=<id>`.

### Manuscript authoring — `src/db/manuscript.ts` + `ManuscriptRoute`/`BookRoute`

The author's real novel, distinct from wiki pages and the in-world Document page type. Per-lore, id-based tables (Dexie stores added in **v11**), all cascade on delete: `Book`→`Chapter`→`Scene` (rich-text `content`, cached `wordCount` recomputed on `updateScene`, `SceneStatus` = Outline→Draft→Revised→Done via `SCENE_STATUSES`, separate from page `STATUSES`). Scenes carry POV/cast/location **page refs** (id-based) → `sceneAppearances(pageId)` lists every scene referencing a page (by ref or inline `[[wiki-link]]`), surfaced on the page. A **Plottr-style grid** of `Plotline` lanes × `Beat` cells (`kind:'plot'`); a `kind:'structure'` lane holds a built-in story structure (`manuscriptStructures.ts`: Save the Cat / Hero's Journey / Snowflake) whose beats align to scenes — deleting an aligned scene reverts its structure beat to unplaced (`sceneId=null`) rather than deleting it (`detachBeatsForScene`). `ManuscriptRoute` = book library; `BookRoute` = workspace with **Write** (`BookWriteView`: `BinderTree` + `SceneEditor` + `SceneMetaPanel`) and **Grid** (`BookGridView` + `StructureControls`) views, plus EPUB / Print-PDF compile buttons. **Export (`src/manuscriptExport.ts`):** pure `buildEpub()` (path→content map, valid EPUB 3 with nav, `mimetype` stored first) + `compileBookHtml()` (self-contained print/Save-as-PDF doc); `exportBookEpub()`/`printBook()` are the DB+download/print wrappers. Manuscript tables are **included in backups** (`exportAll`/`importAll`, scene `content` sanitized on import).

### Relationship graph — `GraphView.tsx` + `GraphRoute`

`buildGraphData(pages)` → nodes+links: each page a node (lone pages = isolated dots, intentional), resolved wiki link = edge, self-links dropped, A↔B collapses to one undirected edge, `degree` drives size. **Runs on demand in `GraphRoute`'s `useMemo`** (not per-save). Filtering clones nodes/links (the force sim mutates them); derives `hubs`/**isolated** pages (`degree === 0`) in `HubsOrphansPanel` — distinct from the world-health dashboard's "orphan" (no *incoming* links; an isolated page is always an orphan, but a page with only outgoing links is an orphan without being isolated).

**Shortest-path highlight (`shortestPath`/`findPath`, pure, in `db/graph.ts`):** two `PagePicker`s in `GraphPathControls` pick From/To endpoints; BFS runs over the **drawn** (filtered) links so every highlighted hop is on screen, and the **full** links are consulted only to tell `kind:'hidden'` ("your filters hide it") from `kind:'none'` ("not connected"). Ties break by node id, so the same pair always yields the same chain. `GraphView` reuses its hover/selection dim machinery for the chain, and the path **outranks hover** so a stray mouse move can't wipe the answer; endpoints get a gold ring, node fills stay their category colour. Endpoints are ephemeral route state (a persisted path would resurrect a stale highlight). 2D only, like the selection pulse and depth filter. The search (`shortestPath`/`findPath`, like `connectedComponents`) reads link endpoints through the shared `endId`/`LinkEnd` helpers, because the force sim mutates a drawn link's `source`/`target` from an id string into the resolved node object in place; a string-only reader silently fails post-render. (`edgeKey` takes already-resolved ids — its callers wrap them in `endId` first.)

**Multi-tag filter (`src/tagFilter.ts` + `orderTagChips` in `src/tags.ts`, both pure):** the toolbar's tag chips hold a *set* of tags plus a `TagMode` (`'any'`/`'all'`), persisted in the `graph-view` meta row; a legacy single `tag` string is read-migrated by `migrateView` and dropped on the next write. `matchesTags` is the one predicate — the node filter and colour-by-tag accenting both use it, so "colour by tag + Match all" lights up exactly the intersection the filter would show. An empty selection means "no filter" to `matchesTags` but "highlight nothing" to `nodeFill`, which is why `nodeFill` checks `tags.length` itself. Chips are count-ordered and capped at 12 with a "+N more" disclosure; selected tags are always shown. A selected tag can vanish from the data (its last page deleted or retagged) while staying in the persisted selection, since `toggleTag` only ever adds/removes what's clicked. `GraphRoute` therefore derives the effective selection by intersecting the persisted `tags` with the tags actually present in `tagCounts`, and never writes the pruned set back — the same derive-don't-write-back pattern `fromValid`/`toValid` use above for stale path endpoints. That's what lets the selection resurrect if the tag returns; pruning the stored row would destroy it permanently.

**Pre-hydration write race (`useGraphPrefs.ts`):** the initial `zoomToFit` fires `onZoomEnd` → `setCam` before the async `useLiveQuery` reads for the `graph-view`/`graph-pins` rows resolve, so an unguarded `writeView({ ...view, cam })` persisted `DEFAULT_VIEW` over the user's saved row on every visit to `/graph` — and the resulting `viewDraft` then masked the real hydration for the rest of the page's life. `getMeta` returns `undefined` both while loading and when no row exists, so the queries now resolve `?? null`, making `undefined` uniquely mean "still loading"; `writeView`/`writePins` check that and drop (never queue) any write attempted before hydration.

### Page right sidebar — `Infobox.tsx`, `TableOfContents.tsx`, `Backlinks.tsx`, `PageHistory.tsx`

Sticky `.page-aside`: **TOC** (scans `h2`/`h3` post-render, slugifies ids, shown only if >3 headings, `IntersectionObserver` active-section) · **Infobox** (image/caption/fields; `applyTemplate()` preserves values; empty separators hidden in view; `[[links]]` via `WikiText.tsx`; typed-field editors branch only in edit mode — `RefField.tsx` for `ref`, numeric input for `number`) · **Backlinks** · **History** (`PageHistory.tsx`, per-page chronology; quiet when empty, first 8 rows then "Show all N").

### Search — `src/search.ts` + `SearchModal.tsx`

FlexSearch `Index` (tokenize `'forward'`, res 5), synced on every `db.pages` change. **Incremental:** `buildIndex()` does the first full build, then `syncIndex(pages)` applies only deltas — unchanged pages (matched by `updatedAt`) skip the costly `stripHtml` parse (~100ms→~0.4ms at 500 pages). `searchPages(query)` → ≤20 results with snippet; `highlightSnippet()` marks the first query word. `SearchModal` is a full-screen overlay (keyboard nav).

### Sanitization & resilience

- **HTML sanitization (`src/sanitize.ts`):** `sanitizeHtml()` runs DOMPurify with an explicit whitelist of the tags/attrs Tiptap emits (blocks/marks, `data-wikilink`+`ext-link` anchors, `data:` images, tables). Applied **on import** (`importAll()` scrubs page `content` + event `description` — the boundary where untrusted backups enter) **and** at the one raw render sink (`TimelineVertical`'s `dangerouslySetInnerHTML`). Page bodies render through Tiptap (rebuilt from schema, inherently safe); plain-text fields are React-escaped.
- **Crash recovery (`src/components/ErrorBoundary.tsx`):** wraps the tree in `main.tsx` (outside the router); fallback's first action is "Download a backup", plus reload + technical details.
- **Quota surfacing (`src/storageError.ts`):** React-free bus + `isQuotaError()`; `installStorageErrorListener()` hooks `window` `unhandledrejection` (where fire-and-forget Dexie writes land) and raises a one-time `StorageErrorBanner`.

### Backup & data safety — `src/db/backup.ts` + `src/backup.ts`

`exportAll()`/`importAll()` serialise the whole DB to/from JSON. **Import replaces all data** (no merge), guarded by `parseBackup()` (validates + returns `counts` *before* any `clear()`); older backups re-seed built-ins after import. Import (on the **Settings** route) shows counts, writes `downloadPreImportBackup()` first, then imports.

**Versioned exports:** payload stamps `schemaVersion` (`CURRENT_SCHEMA_VERSION`, mirrors Dexie store version) + `appVersion`. `parseBackup()` runs `migrateBackup()` (a `MIGRATIONS` ladder); no version ⇒ legacy v1. **When the exported shape changes, bump `CURRENT_SCHEMA_VERSION` and add a `MIGRATIONS` step.** `importAll()` coerces tables to arrays defensively. Since **v12**, portable `meta` rows (settings, home config, graph prefs) travel in backups and are **merged on import** (bulkPut, never cleared — so old meta-less backups/snapshots don't wipe settings); device-local keys (`LAST_BACKUP_KEY`, `SNAPSHOT_TIME_KEY`, defined in `db/backup.ts`) are excluded on export and dropped on import.

`src/backup.ts` (storage helpers): `downloadBackup`, `downloadPreImportBackup`, `requestPersistentStorage`, and the change-tracking driving `BackupBanner`/Home overdue state (pages, maps, events). **Backups stay download-based** (Firefox lacks the File System Access API).

### Desktop shell — `src-tauri/` + `src/platform.ts` (transition Phases 0–1)

Tauri v2 wraps the unchanged web app (WebView2; data still in IndexedDB inside the webview). See `docs/desktop-transition-investigation.md` for the full plan. **`src/platform.ts` is the only place allowed to call `@tauri-apps/*` APIs or trigger an `<a download>`** (lint-enforced via `no-restricted-imports`). The seam: `saveFile(data, name, { defaultDir })` (browser download vs native Save-As pre-filled with `defaultDir`; returns `false` on dialog cancel — `downloadBackup()` only stamps `lastBackupAt` when saved) · `openTextFile()` (file input vs native Open; feeds Settings restore and the selector's import wizard) · `writeAppData(relPath, text)` (shell-only, `false` in browser; pre-import safety copies land in `$APPDATA/backups`) · `printHtml(html)` (hidden-iframe print on both targets; `printBook` uses it — no `window.open`) · `pickDirectory()` (shell-only native folder picker; the path is a **hint that pre-fills the Save dialog, never a write grant** — Tauri only scopes fs writes to paths picked in the *current* session's dialog, so a folder remembered from an earlier session can't be written to) · `onCloseRequested(handler)` (shell-only; intercepts window close, awaits `handler` — wrapped so a failing/hanging handler can never wedge the window shut — then destroys the window; a no-op in the browser). `App.tsx` wires the close handler to `backupOnExit()` (`src/backup.ts`), racing it against a 5s timeout so a hung export can't leave the app unclosable. Because `pickDirectory()`'s result is never a write grant, `backupOnExit()` writes to `$APPDATA/backups` instead of the user's chosen folder, and — unlike a normal backup — deliberately does **not** stamp `LAST_BACKUP_KEY`: an `$APPDATA` copy hasn't left the machine, so silencing the backup-reminder banner would be a lie. The only new permission this needed is `core:window:allow-destroy` (no new fs scope, no new Rust deps). **Migration wizard:** `LoreSelectorRoute`'s "Import World" → `parseBackup` → `importLoreFromBackup(name, json)` (`lores.ts`: registers a world *without* switching, imports via `importBackupInto(target, json)` — the parameterized twin of `importAll` — then the caller `switchLore`s; App-start seeding fills missing built-ins). **No host `alert()`/`confirm()`** — use `ConfirmDialog` (`hideCancel` for notices); wry renders host dialogs unreliably. Shell permissions live in `src-tauri/capabilities/default.json` (dialog save/open + writes to dialog-picked paths + `$APPDATA` writes; keep minimal); CSP is set in `tauri.conf.json` (`img-src data: blob:` is load-bearing). Rust side stays config-only (`lib.rs` registers dialog/fs plugins). `tauri.conf.json` reads `version` from `package.json`; `release.yml` builds the installer on every `v*` tag, and `desktop.yml` runs `cargo check` on `windows-latest` for PRs touching `src-tauri/**` or `package.json` (`build.rs` validates the config, the semver it reads from `package.json`, and the capability ACL — so those regressions fail on the PR, not at release). Fonts are self-hosted via `@fontsource` imports in `main.tsx` (keep `index.html` CDN-free). Web build/tests are unaffected — the shell path is behind feature detection.

### Auto-updater — `src/updater.ts` + `useUpdateCheck.ts` + `UpdateBanner.tsx`

Desktop only. `tauri-plugin-updater` fetches a **minisign-signed** `latest.json`
from `releases/latest/download/` on the GitHub repo; `release.yml` emits and
signs it via `includeUpdaterJson: true` plus the `TAURI_SIGNING_PRIVATE_KEY`
secrets. The pubkey is committed in `tauri.conf.json`; **losing the private key
permanently strands every installed copy** (`docs/updater-key.md`). Signing
also requires `bundle.createUpdaterArtifacts: true` in `tauri.conf.json`
itself — it defaults to `false`, and without it the bundler emits no updater
artifact and no `.sig` at all, so the release ships with no `latest.json`
regardless of whether the workflow secrets are set. This is the single least
discoverable requirement in the whole feature.

`platform.ts` owns the only `@tauri-apps/plugin-updater` import and returns an
**`UpdateInfo` handle** (`version`/`notes`/`download()`/`install()`) rather than
free functions — `install()` must act on the same plugin `Update` instance
`check()` returned, and a module-level "current update" would race. Download and
install are **separate calls on purpose**: on Windows the NSIS installer
terminates the running app, so installing must be a second, explicit click.

`updater.ts` is pure (`shouldCheck` 24h throttle — a future timestamp counts as
due, so a clock rollback can't wedge checking off, and a non-finite
`lastCheckedAt` counts as due too, since `coerceSettings` accepts `NaN`
— `typeof NaN === 'number'` — and `NaN` fails every comparison, so an
unguarded check would silently disable update checking forever; `isDismissed`
is plain string identity, since the plugin decides what's *newer*).
`useUpdateCheck` is the one state machine both consumers read — literally one,
via `UpdateCheckProvider`/`useSharedUpdateCheck` (`src/UpdateCheckContext.tsx`),
which wraps the sidebar shell in `App.tsx`. Calling the hook directly in a
second component would give it its own `pending` handle, letting the banner
dismiss a version the other instance had already downloaded; the shared hook
throws outside the provider rather than falling back silently. Automatic
checks fail **silently**; manual "Check now" in Settings surfaces errors and
bypasses both throttle and dismissal. `lastUpdateCheckAt` is stamped only on a
**successful** check — a failed one hasn't learned anything, and muting checks
for 24h over one network blip would be worse than retrying next launch.

`dismiss()` refuses to run once a check has produced a live handle and moved
past `available` (so `downloading`/`ready`/`installing`/post-install `error`
are all refused, deliberately broader than the states today's UI can dismiss
from): dismissing a downloaded update would both clear the update
handle and record the version as dismissed, stranding an installer already on
disk that `install()` would then no-op on and that automatic checks would
never re-offer. Neither the banner nor the Settings panel renders a dismiss
control once an update is downloaded.

The check is the app's **only** outbound request, governed by the device-level
`autoUpdateCheck` pref (`appSettings.ts`, registry DB — structurally incapable
of travelling in a world backup). Off means automatic checks stop entirely —
Lore Codex never reaches the network on its own — while the explicit "Check
now" button in Settings still reaches it when the user clicks it. That
distinction is what keeps the local-first claim honest: nothing outbound
happens unasked.

### World mirror — `src/worldMirror.ts` + `worldMirrorSync.ts` + `worldIndex.ts` + `worldRecovery.ts`

Desktop only. Each world auto-mirrors to `<app-data>/worlds/<loreId>.lore` —
the `exportAll()` JSON **verbatim**, so `parseBackup`'s validation and
`MIGRATIONS` ladder restore it and no second format needs versioning. Written
**temp-then-rename** (`fs:allow-rename`), so a crash or the close-handler
timeout can never leave a truncated file where a good mirror was.

**Cadence.** `worldMirror.ts` is pure (`shouldMirror`: a quiet window so writes
fall between editing bursts, an interval floor so a long session doesn't
rewrite tens of MB every 30s, a **staleness ceiling** that overrides the quiet
window after 10 min, and the non-finite/future-timestamp guards `shouldCheck`
carries). The ceiling exists because the quiet window is otherwise unreachable
for a steady typist — `PageRoute` commits content after 500ms, so
`lastChangeAt` slides forward faster than 30s can elapse and no write fired for
the whole session (#233). It measures from a **session-start anchor** until the
first write of the page-life lands, not from `lastMirrorAt` alone: that starts
at 0 every page-life, so a ceiling measured from it is true on the *first* poll
of every launch and would force a multi-MB export mid-burst. The floor is
evaluated on every path including the stale one, which keeps
`MIRROR_MAX_STALE_MS >= MIRROR_FLOOR_MS` a tuning choice, not a correctness
dependency. **There is no dirty flag** — `worldMirrorSync.ts` polls
a mirror-specific `mirrorChangeTime()`, *not* `latestChangeTime()` (that sees
only 6 of the 15 tables `exportAll()` writes, and `BackupBanner`/`backupOnExit`
depend on exactly that shape, so it stays as-is). `mirrorChangeTime()` combines
those six indexed reads with a `count()` on each of the other nine, so an add
or delete registers even with no timestamp to read. It is **not** complete: an
in-place edit to a row on those nine is invisible between polls, and
`maps`/`calendars` notice an add but not an edit. `flushWorldMirror()` on close
is the deliberate backstop for all of it — unconditional, writing whenever the world
has any content. `lastMirrorAt` is module state, not persisted. The poll loop
(`startMirrorLoop`) is **gated on `isTauri()`**, not left to the seam's browser
no-op: a mirror attempt calls `exportAll()` *before* reaching the seam, and the
no-op never advances `lastMirrorAt`, so an ungated loop would re-serialize the
whole database every 30s for the life of a browser session and discard it.

**The load-bearing guard: `write()` refuses when `activeLoreId` has no row in
the registry DB.** Without it, the recovery launch is a data-loss mechanism —
`App.tsx` seeds templates and a calendar into the freshly-evicted (empty) DB,
and the loop then renames *that* over the good `.lore` within 30s while the
panel still advertises the pre-clobber timestamp. Stated as a precondition in
`write()` rather than at a caller so poll and close-flush are covered together.

**Suspension is epoch-based, not just depth.** `write()` captures
`suspendEpoch` before `exportAll()` and re-checks it after, because a
suspension raised *and released* during an in-flight export would otherwise let
the stale payload commit. Attempts are dropped, never queued — a deferred write
fires against the state it was meant to avoid. Suspension wraps `importAll()`
and `restoreSnapshot()` in `SettingsRoute` (both are `clear()` + `bulkAdd` over
the active DB) **and `restoreWorld` in `LoreSelectorRoute`**: restore reuses the
world's original id, so it targets the *active* DB — the older comment claiming
the selector needs no guard was invalidated by that change.

**The index is a union, never a replace** (`worldIndex.ts`, pure:
`mergeWorldIndex`/`markWorldMirrored`/`dropWorldFromIndex`). Rebuilding
`registry.json` from the registry DB — the volatile store this feature exists
to survive — meant an eviction erased the pointers to the files that survived.
Entries leave only via an explicit drop (`deleteLore`, or a rollback that
created the entry). `mirroredAt` is stamped **only by a real write**; `null`
means no file exists, and `plannedRecovery` excludes those. The file carries a
`{version, worlds}` envelope: legacy bare arrays migrate forward, and a
*newer* version reads as unreadable so an older build can't flatten it.
`readRegistryMirror()` distinguishes **absent from unreadable**
(`fs:allow-exists`) and every writer refuses on unreadable — a shrinking write
must never follow a failed read. All three writers serialize through
`withRegistryMirrorLock`; unlocked, a drop racing a stamp resurrects a deleted
entry and two writers share one tmp path. `registry.json` existing at all is
what keeps `fs:allow-read-dir` ungranted.

**Recovery.** `bootstrapDefaultLore()` declines to seed when the registry is
empty *and* the disk index names a world with a real `mirroredAt` — that
combination means the store was lost, not a first run. Without it, a wiped
profile (which takes `localStorage`, so `lore-bootstrapped` is unset) re-seeds
`default` and `plannedRecovery` filters the single-world user out of their own
recovery. `App.tsx` chains `bootstrapDefaultLore().then(syncRegistryMirror)` so
the read precedes the write. `LoreSelectorRoute` offers matching worlds;
**nothing is written without a click**, and worlds with `mirroredAt: null` are
listed separately as lost-with-no-copy rather than hidden. Deleting a world
trashes its `.lore` to `worlds/trash/` *before* re-indexing.

**Observability is part of the feature.** Settings shows the mirror's path,
last successful write, last error, and whether the index is readable — because
a mirror that has never once succeeded is otherwise indistinguishable from one
working perfectly until recovery day.

**`BackupBanner` and `backupOnExit` both stay.** The mirror lives in `$APPDATA`
— it has not left the machine, so it must not stamp `LAST_BACKUP_KEY` or
silence the backup reminder, the same reasoning already written into
`backupOnExit`. The weekday-rotating exit backup is a week of *history*; the
mirror is *currency*. The mirror flushes **first** on close (it is atomic;
`backupOnExit`'s write is not) and its rejection is caught, so a failing mirror
can't take the exit backup down with it.

**Testing note.** Mirror logic must be proved against the real-DB harness
(`worldMirrorSync.realdb.test.ts`, which mocks only `platform.ts`). Two
Criticals reached review because every mirror test mocked `./db` wholesale and
the fixtures could not represent the failure; when the real harness was added,
19 of 28 existing tests broke — they had never seeded a registry row.

### Other

- **Auto-snapshots (`src/snapshots.ts`):** `maybeTakeSnapshot()` snapshots when ≥50 records changed or ≥24h passed with ≥1 change; keeps 10 most recent. Called on start + after each edit session.
- **HTML export (`src/htmlExport.ts`):** `exportAsHtml()` builds a JSZip site (`index.html` + `pages/<id>.html` + `style.css`); wiki links rewritten to file paths.
- **Shared HTML (`src/html.ts`):** `parseHtml()`, `stripHtml()`, `wikiLinkTitles()` — use these instead of re-parsing per call site.
- **Wiki hover (`src/wikiLinkHover.ts` + `WikiLinkPopover.tsx`):** debounced module bus; popover fetches the hovered page and renders a floating card.
- **UI prefs/state:** `recents.ts` (recently-viewed pages), `sidebarPrefs.ts` (collapsed groups), `useEscapeKey.ts`.
- **`leaflet-draw` is unmaintained (last release 2018)** and its whole surface is 3 call sites in `MapView.tsx` (polygon drawer + per-layer `editing` handle). **Don't add new call sites** — each is migration debt. Successor is pre-chosen and pre-costed in `docs/leaflet-draw-succession.md` (#189); migrating early buys nothing, since `leaflet-geoman` is equally Leaflet-2-bound.
