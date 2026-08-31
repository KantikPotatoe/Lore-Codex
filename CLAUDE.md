# CLAUDE.md

Guidance for Claude Code working in this repo.

## Models

- **Opus** — planning/design. **Sonnet** — default coding/edits. **Haiku** — cheap mechanical work only when called for.

## Commands

Standard scripts are in `package.json`. Non-obvious bits:

- `npm run tauri dev` / `npm run tauri build` need a **Rust toolchain**; the build emits an NSIS installer to `src-tauri/target/release/bundle/`.
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

Two name collisions worth knowing before you open the wrong file: `db/calendar.ts` is timeline calendar/event **CRUD**, distinct from the pure date math in `src/calendar.ts`; and `db/worldHealth.ts`'s "orphan" means *no incoming links*, which is not the graph view's "isolated" (`degree === 0`).

**Per-lore DB:** `db = new LoreDB(dbNameFor(currentLoreId()))` binds at module load, so the active world is fixed for the page's lifetime. `switchLore()` and deleting the active world call `window.location.reload()` to rebind.

**Repository seam (`repositories.ts`):** the UI reaches data through `pageRepo` / `mapRepo` / `templateRepo` / `calendarRepo` / `manuscriptRepo` — **never** the `db` singleton. Lint-enforced (`no-restricted-imports`), mirroring the `platform.ts` rule. Three tiers: **UI** (components/routes/hooks) → repositories only; **infra** (`src/backup.ts`, `searchSync.ts`, `snapshots.ts`, `htmlExport.ts`, `manuscriptExport.ts`) → keeps raw `db` on purpose for whole-DB cross-table work; **data layer** (`src/db/**`) → owns `db`. Tests are exempt. The seam is about having **one idiom**, not portability — a non-Dexie backend would still have to solve invalidation for ~77 `useLiveQuery` sites, which no repository interface reduces (`docs/desktop-transition-investigation.md` §4.1). Adding a UI read means adding a repo method, not reaching past the seam. Note the ESLint carve-outs re-declare the bans they keep — never write `'no-restricted-imports': 'off'`, or the `@tauri-apps` ban silently dies in `backup.ts`/`htmlExport.ts`/`manuscriptExport.ts`.

**Key types:** `LorePage` (HTML `content`, `summary`, `tags`, `status`, optional `Infobox`) · `Infobox`/`InfoboxField` (`kind:'separator'`=heading; `fieldType:'text'|'ref'|'number'`, `'ref'` stores `[[Title]]` tokens bound to `refType`) · `InfoboxTemplate`/`TemplateItem` (a **page type**: named coloured category + starter rows + optional `sections` starter body headings + optional `group` (#115 — the sidebar group this type nests under; absent ⇒ backfillable, `''` ⇒ deliberately ungrouped)) · `WorldMap`/`MapPin`/`MapRegion` · `Calendar`/`CalendarMonth`/`CalendarEra` · `TimelineEvent` (in-world date + cached `startAbsolute`/`endAbsolute`) · `Snapshot` · `Book`/`Chapter`/`Scene` (`SceneStatus`, POV/cast/location page refs) · `Plotline`/`Beat` (`kind:'plot'|'structure'`, `StructureType`) · `MetaEntry` (Dexie schema **v12**) · `Lore` (in `src/lores.ts`, separate `lore-registry` DB).

**Helpers:** `BUILTIN_TEMPLATES`, `DEFAULT_CATEGORY`, `TYPE_COLORS`, `STATUSES`+`pageStatus()`/`statusColor()`. Page types are DB-backed: `seedTemplates()` (on start) reconciles built-ins (adds missing, removes dropped built-ins, backfills colours + icons + `sections` from `BUILTIN_SECTIONS` + `group` from `BUILTIN_GROUPS`; leaves custom types alone); CRUD `getTemplates`/`createTemplate`/`updateTemplate`/`deleteTemplate`/`resetTemplate`; `applyTemplate()` swaps rows preserving values. A type also carries optional `sections` (starter `<h2>` body headings); `sectionNodes()` (`src/sectionNodes.ts`) turns them into editor nodes for the editor's "+ Sections" button. `categoryColor()` reads a `liveQuery`-synced cache. `getBacklinks()`/`linkedTitles()` scan body `<a data-wikilink>` + infobox `[[…]]` (via `src/html.ts`). `renamePage(id, title)` atomically rewrites all references, throws on title clash. `findPageIdByTitle()` is **resolve-only** (callers confirm before creating). Calendar/event mutations recompute cached absolute days and cascade-delete on calendar removal.

### Routing — `src/App.tsx` (hash routing)

`/` is special-cased (full-screen `LoreSelectorRoute`, no shell); every other path renders in the `<Sidebar>` + `<main>` shell with `<BackupBanner>` + `<StorageErrorBanner>`. `App.tsx` mounts global overlays (`SearchModal`, `WikiLinkPopover`), drives the incremental search index (`liveQuery` on `db.pages` → `syncIndex()`), and on start runs `installStorageErrorListener`, `bootstrapDefaultLore`, `requestPersistentStorage`, `seedTemplates`, `seedDefaultCalendar`, `maybeTakeSnapshot`.

The route table is in `App.tsx`. The sidebar renders a two-level tree from the pure `src/sidebarTree.ts` (`buildSidebarTree(pages, templates)`, #115) — page-type groups and ungrouped types interleave in one alphabetical sort, driven by the categories present on pages so a category with no template still shows up, ungrouped. Type headers still link to `/browse/:category`; group headers only toggle. Collapse state lives in `sidebarPrefs`, keyed by `groupCollapseKey(name)` (a `group:`-prefixed key) so a group and a type of the same name never share collapse state; its search box is read-only and opens `SearchModal` on focus.

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

The author's real novel, distinct from wiki pages and the in-world Document page type. Per-lore, id-based tables (Dexie stores added in **v11**), all cascade on delete: `Book`→`Chapter`→`Scene`, plus a Plottr-style plotline/beat grid. Manuscript tables are **included in backups** (scene `content` sanitized on import).

→ Details in `.claude/rules/manuscript.md` (loads when you touch manuscript files).

### Relationship graph — `GraphView.tsx` + `GraphRoute`

`buildGraphData(pages, relationships, types)` → nodes+links, with typed relationships as a second edge source alongside resolved wiki links. `linkStyle()` in `src/graphColor.ts` is the single styling authority. Note the vocabulary clash: the graph's **isolated** (`degree === 0`) is not the world-health dashboard's **orphan** (no *incoming* links).

→ Details in `.claude/rules/graph.md` (loads when you touch graph files): typed-edge styling and arrow orientation, the `linkLabel` innerHTML escaping sink, shortest-path highlight, multi-tag filter, and the `useGraphPrefs` pre-hydration write race.

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

Tauri v2 wraps the unchanged web app (WebView2; data still in IndexedDB inside the webview). See `docs/desktop-transition-investigation.md` for the full plan. Three rules that apply everywhere, not just in shell code:

- **`src/platform.ts` is the only place allowed to call `@tauri-apps/*` APIs or trigger an `<a download>`** (lint-enforced via `no-restricted-imports`).
- **No host `alert()`/`confirm()`** — use `ConfirmDialog` (`hideCancel` for notices); wry renders host dialogs unreliably.
- **Fonts are self-hosted** via `@fontsource` imports in `main.tsx` — keep `index.html` CDN-free.

→ Details in `.claude/rules/desktop-shell.md` (loads when you touch `src-tauri/**` or `platform.ts`): the full seam inventory, the close-handler/`backupOnExit` interaction, the migration wizard, capabilities/CSP, and the release/`cargo check` workflows.

### Auto-updater — `src/updater.ts` + `useUpdateCheck.ts` + `UpdateBanner.tsx`

Desktop only, via `tauri-plugin-updater`. The update check is the app's **only**
outbound request — governed by the device-level `autoUpdateCheck` pref, and off
means Lore Codex never reaches the network on its own. That is what keeps the
local-first claim honest, so **don't add unasked network calls.**

→ Details in `.claude/rules/updater.md` (loads when you touch updater files):
minisign signing and the `createUpdaterArtifacts` trap, the `UpdateInfo` handle,
the `shouldCheck`/`NaN` guards, the shared-hook requirement, and why `dismiss()`
refuses after download.

### World mirror — `src/worldMirror.ts` + `worldMirrorSync.ts` + `worldIndex.ts` + `worldRecovery.ts`

Desktop only. Each world auto-mirrors to `<app-data>/worlds/<loreId>.lore` — the
`exportAll()` JSON **verbatim**, written temp-then-rename. **`BackupBanner` and
`backupOnExit` both stay**: the mirror lives in `$APPDATA`, so it has not left
the machine and must never stamp `LAST_BACKUP_KEY` or silence the backup
reminder. The exit backup is a week of *history*; the mirror is *currency*.

→ Details in `.claude/rules/world-mirror.md` (loads when you touch mirror
files): the `shouldMirror` cadence and staleness ceiling, the registry-row guard
in `write()`, epoch-based suspension, the union-never-replace index, recovery,
and the real-DB test harness requirement.

### Other

- **Auto-snapshots (`src/snapshots.ts`):** `maybeTakeSnapshot()` snapshots when ≥50 records changed or ≥24h passed with ≥1 change; keeps 10 most recent. Called on start + after each edit session.
- **HTML export (`src/htmlExport.ts`):** `exportAsHtml()` builds a JSZip site (`index.html` + `pages/<id>.html` + `style.css`); wiki links rewritten to file paths.
- **Shared HTML (`src/html.ts`):** `parseHtml()`, `stripHtml()`, `wikiLinkTitles()` — use these instead of re-parsing per call site.
- **Image import (`src/imageImport.ts` + `imageUtils.ts`):** two different policies, deliberately. `compressImage(file, maxDim, quality)` always re-encodes to JPEG — right for thumbnails and inline art (infobox 800, gallery/editor/home 1600, world banner 1200), where the image is displayed small. **Maps use `importImage(file, maxDim)` instead**, which stores the original bytes verbatim below the cap and preserves the source format above it, because a map is zoomed into and is full of hard edges that JPEG wrecks (#246). The decision is pure (`planImageImport`) precisely so it can be tested — happy-dom has no canvas, so the executor is manual-verification-only. `importImage` type-checks **before** decoding; that check is the only thing keeping SVG out of the DB now that the JPEG re-encode no longer launders every upload, and `sanitizeBackup` blanks (never drops) an unsafe map image — and coerces a missing `width`/`height` to a placeholder rather than letting `[[0,0],[NaN,NaN]]` crash the `/map` route — so its pins survive. Narrowing to the three-format allowlist dropped the old `image/*`-accepts-anything behaviour: AVIF/GIF/BMP/TIFF map uploads that used to transcode now hit the unsupported dialog (#246 — re-add via a `transcode` plan outcome if wanted, never by loosening the allowlist).
- **Wiki hover (`src/wikiLinkHover.ts` + `WikiLinkPopover.tsx`):** debounced module bus; popover fetches the hovered page and renders a floating card.
- **UI prefs/state:** `recents.ts` (recently-viewed pages), `sidebarPrefs.ts` (collapsed groups), `useEscapeKey.ts`.
- **`leaflet-draw` is unmaintained (last release 2018)** and its whole surface is 3 call sites in `MapView.tsx` (polygon drawer + per-layer `editing` handle). **Don't add new call sites** — each is migration debt. Successor is pre-chosen and pre-costed in `docs/leaflet-draw-succession.md` (#189); migrating early buys nothing, since `leaflet-geoman` is equally Leaflet-2-bound.
