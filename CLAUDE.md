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

Each world is its own IndexedDB. `loreId.ts`: `currentLoreId()` (from `localStorage`, default `'default'`), `dbNameFor(id)` (`'lore-app'` / `'lore-app-<id>'`). `lores.ts` owns the `lore-registry` DB + world CRUD (`createLore`/`renameLore`/`setLoreBanner`/`deleteLore`/`switchLore`); `bootstrapDefaultLore()` registers `'default'` on first run.

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

Tauri v2 wraps the unchanged web app (WebView2; data still in IndexedDB inside the webview). See `docs/desktop-transition-investigation.md` for the full plan. **`src/platform.ts` is the only place allowed to call `@tauri-apps/*` APIs or trigger an `<a download>`** (lint-enforced via `no-restricted-imports`). The seam: `saveFile(data, name)` (browser download vs native Save-As; returns `false` on dialog cancel — `downloadBackup()` only stamps `lastBackupAt` when saved) · `openTextFile()` (file input vs native Open; feeds Settings restore and the selector's import wizard) · `writeAppData(relPath, text)` (shell-only, `false` in browser; pre-import safety copies land in `$APPDATA/backups`) · `printHtml(html)` (hidden-iframe print on both targets; `printBook` uses it — no `window.open`). **Migration wizard:** `LoreSelectorRoute`'s "Import World" → `parseBackup` → `importLoreFromBackup(name, json)` (`lores.ts`: registers a world *without* switching, imports via `importBackupInto(target, json)` — the parameterized twin of `importAll` — then the caller `switchLore`s; App-start seeding fills missing built-ins). **No host `alert()`/`confirm()`** — use `ConfirmDialog` (`hideCancel` for notices); wry renders host dialogs unreliably. Shell permissions live in `src-tauri/capabilities/default.json` (dialog save/open + writes to dialog-picked paths + `$APPDATA` writes; keep minimal); CSP is set in `tauri.conf.json` (`img-src data: blob:` is load-bearing). Rust side stays config-only (`lib.rs` registers dialog/fs plugins). `tauri.conf.json` reads `version` from `package.json`; `release.yml` builds the installer on every `v*` tag, and `shell.yml` runs `cargo check` on `windows-latest` for PRs touching `src-tauri/**` (build.rs validates the config + capability ACL, so conf/permission regressions fail there rather than at release). Fonts are self-hosted via `@fontsource` imports in `main.tsx` (keep `index.html` CDN-free). Web build/tests are unaffected — the shell path is behind feature detection.

### Other

- **Auto-snapshots (`src/snapshots.ts`):** `maybeTakeSnapshot()` snapshots when ≥50 records changed or ≥24h passed with ≥1 change; keeps 10 most recent. Called on start + after each edit session.
- **HTML export (`src/htmlExport.ts`):** `exportAsHtml()` builds a JSZip site (`index.html` + `pages/<id>.html` + `style.css`); wiki links rewritten to file paths.
- **Shared HTML (`src/html.ts`):** `parseHtml()`, `stripHtml()`, `wikiLinkTitles()` — use these instead of re-parsing per call site.
- **Wiki hover (`src/wikiLinkHover.ts` + `WikiLinkPopover.tsx`):** debounced module bus; popover fetches the hovered page and renders a floating card.
- **UI prefs/state:** `recents.ts` (recently-viewed pages), `sidebarPrefs.ts` (collapsed groups), `useEscapeKey.ts`.
