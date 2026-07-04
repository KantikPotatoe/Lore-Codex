# Lore Codex — Desktop Transition Investigation

**Status:** in execution — pre-work (schema v12 `meta` in backups, #162), **Phase 0** (Tauri v2 shell, `src/platform.ts` save seam, self-hosted fonts, #163) and **Phase 1** (open/import dialogs, migration wizard, `ConfirmDialog` everywhere, iframe print, CSP, `release.yml`) shipped 2026-07-03. Spikes resolved: version sync, WebView2 profile (`%LOCALAPPDATA%\com.lorecodex.app\EBWebView`), CSP boots clean, print via hidden iframe. Next: Phase 2 (per-world `.lore` disk mirror). · **Written:** 2026-07-03
**Scope:** evaluate moving Lore Codex from a localhost-served browser SPA to a Windows desktop app; recommend a shell framework and a data-layer strategy; produce a phased, low-risk migration plan.

---

## 1. Executive summary

**Framework: Tauri v2.** Lore Codex is a pure-frontend app — there is no server code anywhere in the repo, and the only native capabilities it needs (file dialogs, file writes, later an updater) are stock Tauri plugins driven from JavaScript, requiring zero custom Rust. On Windows 11 Tauri rides the preinstalled Chromium-based WebView2, which is a *better* engine for this app's WebGL/canvas/Tiptap stack than the Firefox target it ships against today. Installer is ~5–10 MB vs Electron's ~100 MB, and the solo-dev maintenance burden (no Chromium-version treadmill, default-deny capability model) is lower. **Runner-up: Electron** — switch only if a spike shows WebView2 breaking something load-bearing (downloads/print/WebGL), or if future features need a Node.js backend (e.g. an npm-only library doing real work outside the webview). An installable PWA is rejected: it does not solve the core problem (Firefox has neither desktop PWA install nor the File System Access API), so it would force a browser switch *and* still leave data quota-bound in an origin-keyed store.

**Data layer: keep Dexie/IndexedDB as the live store; make disk the durable copy — do not migrate to SQLite now.** IndexedDB works unchanged inside WebView2, and the app's reactivity (`useLiveQuery` in 33 files) is welded to Dexie in a way the young repository seam (`src/db/repositories.ts`, pages+maps only) does not yet insulate. The staged path: wrap as-is with a tiny platform seam for file-save (Phase 0) → native Save-As/Open backup dialogs + first-run migration wizard (Phase 1) → automatic per-world `.lore` JSON mirror on disk, written atomically on the existing snapshot cadence (Phase 2) → *optionally* move binary assets (map/gallery data-URLs) to real files and/or SQLite behind the repositories (Phase 3, only if quota or performance actually bites). One mandatory pre-work item: **backups currently omit the `meta` table** (settings, home-page config), so the migration vehicle would silently drop data — bump the export schema to include it first (§4.5).

---

## 2. Current architecture (as-is)

Verified against source; `CLAUDE.md`'s architecture map is accurate.

### 2.1 Shape of the app

- React 19 + Vite 8 + TypeScript strict SPA (`package.json`; `tsconfig.json` references app/node configs). No server, no API, no service worker, no PWA manifest (grep for `serviceWorker|manifest.json|vite-plugin-pwa` matches only a doc).
- Entry: `src/main.tsx` renders `<StrictMode><ErrorBoundary><HashRouter><App/></HashRouter></ErrorBoundary></StrictMode>`. **Hash routing** — no server-side route support needed, which is desktop-friendly.
- `src/App.tsx:App` runs the startup sequence in one effect: `installStorageErrorListener()`, `bootstrapDefaultLore()`, `requestPersistentStorage()`, `seedTemplates()`, `seedDefaultCalendar()`, `maybeTakeSnapshot()`; a second effect subscribes `liveQuery(() => pageRepo.list())` to keep the FlexSearch index synced.
- Served on a **pinned port**: `vite.config.ts` sets `server/preview: { port: 5174, strictPort: true }` with a comment explaining that IndexedDB is origin-keyed and port drift looks like data loss. `start-lore-codex.cmd` opens Firefox at `http://localhost:5174` and runs `npm run dev`. This launcher *is* the current "desktop app," and its own design doc (`docs/superpowers/specs/2026-06-14-stable-storage-launcher-design.md`) calls it a stopgap until "a real desktop app (Tauri)".

### 2.2 Data layer

- All data in IndexedDB via Dexie 4. `src/db/schema.ts:LoreDB` declares 16 tables across a **v1→v11 version ladder**; `schema.ts:251` binds the singleton at module load: `export const db = new LoreDB(dbNameFor(currentLoreId()))`.
- **Per-world DBs:** `src/loreId.ts:dbNameFor` maps world id → DB name (`'lore-app'` / `'lore-app-<id>'`); `src/loreId.ts:currentLoreId` reads `localStorage['current-lore-id']`. `src/lores.ts` owns a separate `lore-registry` Dexie DB (world id/name/banner) plus `switchLore()`/`deleteLore()`, both of which **call `window.location.reload()`** (lores.ts:37, 71) because the `db` singleton binds once per page lifetime.
- **Repository seam (new, partial):** `src/db/repositories.ts` defines storage-agnostic `PageRepository`/`MapRepository` interfaces with Dexie-backed implementations, explicitly motivated by "the planned Electron / on-disk-JSON move (#142)" (repositories.ts:6). Its header honestly scopes it: *pages + maps only; manuscript, calendar, templates, images, meta, snapshots still use module functions or raw `db.*`*.
- **Where Dexie still leaks into the UI:** a content grep for `\bdb\.` outside `src/db/` (excluding tests) finds direct table access in `src/routes/SettingsRoute.tsx` (counts + `db.meta.get`), `TimelineRoute.tsx`, `TemplatesRoute.tsx`, `ManuscriptRoute.tsx`, `BookRoute.tsx`, `MapRoute.tsx`, `src/components/{BackupBanner,CalendarEditor,ImageGallery,Infobox,Sidebar}.tsx`, all four `src/components/manuscript/*` views, `src/usePage.ts` (templates query), and the non-React helpers `src/backup.ts`, `src/snapshots.ts`, `src/htmlExport.ts`, `src/manuscriptExport.ts`. Additionally **`useLiveQuery` appears 101 times across 33 files** — reactivity, not just data access, is coupled to Dexie.
- **Route-to-hook extraction (also new):** `src/usePage.ts:usePage` shows the intended end state — reads via `useLiveQuery(() => pageRepo.get(id))`, mutations via `pageRepo.*`, the route as presentation.

### 2.3 Backup, snapshots, resilience

- `src/db/backup.ts`: `exportAll()` serialises 14 tables to JSON stamped with `CURRENT_SCHEMA_VERSION` (= 11, mirrors the Dexie version) + `appVersion`; `parseBackup()` validates *before* any destructive step, refuses newer-versioned backups, and runs the `MIGRATIONS` ladder (`migrateBackup()`); `importAll()` clears + bulk-adds in one transaction, then re-seeds built-ins. `sanitizeBackup()` scrubs page/scene/event HTML with DOMPurify and filters non-image / SVG data-URLs at the import boundary.
- **Notably absent from `exportAll()`:** the `meta` and `snapshots` tables. `meta` holds per-lore settings (`src/settings.ts:SETTINGS_KEY`), the home-page config (`home-config`, read in `src/lores.ts:104`), and the last-backup timestamp. Snapshots are disposable; `home-config` and settings are not — see §4.5.
- `src/backup.ts`: download-based flows only. `triggerDownload()` (backup.ts:26) builds a Blob → `URL.createObjectURL` → `<a download>` click. `downloadBackup()`, `downloadPreImportBackup()` (safety copy written before every import; invoked from `SettingsRoute.tsx:confirmImport`), plus the change-tracking that drives `BackupBanner`. Header comment: keep backups "in a synced folder (Dropbox / OneDrive / Google Drive)" — the user must do that move by hand every time, because **Firefox lacks the File System Access API** (the known limitation this transition removes).
- `src/snapshots.ts:maybeTakeSnapshot` snapshots the full `exportAll()` JSON into the `snapshots` table when thresholds from `src/settings.ts:getSettings` are met; retention pruning in `src/db/snapshots.ts:saveSnapshot`. Snapshots live *inside the same IndexedDB they protect* — no help against origin loss or profile wipe.
- `src/storageError.ts`: `isQuotaError()` + a React-free bus; `installStorageErrorListener()` catches `unhandledrejection` (where fire-and-forget Dexie writes land) and raises `StorageErrorBanner`. `src/backup.ts:requestPersistentStorage` asks `navigator.storage.persist()` at startup.
- `src/components/ErrorBoundary.tsx` wraps the tree; its crash fallback's first action is "Download a backup" and it offers `window.location.reload()` (ErrorBoundary.tsx:51).

### 2.4 Security boundary

- `src/sanitize.ts:sanitizeHtml` — DOMPurify with an explicit whitelist of Tiptap-emitted tags/attrs. Runs at **import** (`db/backup.ts:sanitizeBackup`) and again at the one raw render sink (`TimelineVertical`'s `dangerouslySetInnerHTML`). Page bodies re-render through Tiptap's schema; plain-text fields are React-escaped. `src/htmlExport.ts:escapeHtml` and `src/manuscriptExport.ts:toXhtml` guard the two static-export sinks.
- No CSP anywhere: `index.html` has no CSP meta tag, and it **loads Google Fonts from a CDN** (index.html:7–12) — the app is not fully offline today.

### 2.5 Browser-API inventory (the seams a shell disturbs)

| API | Sites (non-test) |
|---|---|
| `URL.createObjectURL` + `<a download>` | `src/backup.ts:26`, `src/graphExport.ts:downloadBlob`, `src/htmlExport.ts:215`, `src/manuscriptExport.ts:exportBookEpub` |
| `window.open` + `document.write` + `win.print()` | `src/manuscriptExport.ts:printBook` |
| `window.location.reload()` / `.hash` | `src/lores.ts:switchLore`, `src/lores.ts:deleteLore`, `src/components/ErrorBoundary.tsx:51` |
| `localStorage` | `src/loreId.ts`, `src/lores.ts` (current world + bootstrap flag), `src/recents.ts`, `src/sidebarPrefs.ts` |
| `navigator.storage.persist/persisted` | `src/backup.ts:14–22` |
| `alert()` / `confirm()` | `SettingsRoute.tsx:104,120,125`, `HomeRoute.tsx:168`, `components/manuscript/StructureControls.tsx:29,33` (the app already has its own `components/ConfirmDialog.tsx`, built *because* "host-provided dialogs … vary across packaging targets (Tauri…)" — `docs/superpowers/specs/2026-06-14-import-safety-design.md`) |
| `<input type="file">` / `FileReader` / canvas | `SettingsRoute.tsx:handleImport` (backup import via `file.text()`), `src/imageUtils.ts:compressImage` (FileReader + canvas `toDataURL`), image pickers in `HomeRoute`/`MapRoute`/`Infobox`/`ImageGallery`/`LoreEditor`/`LoreSelectorRoute` |
| WebGL / canvas 2D | `react-force-graph-3d` (three.js/WebGL, `GraphView3D.tsx`), `react-force-graph-2d` (canvas), `src/graphExport.ts` (offscreen canvas → PNG `toBlob`) |
| Leaflet | `MapView.tsx` — DOM + canvas, no exotic APIs |
| Binary data as data-URLs | map images (`mapRepo.addMap(name, image, …)`), gallery images (`PageImage.dataUrl`), infobox images, world banners (`lores.ts:Lore.banner`) — all stored inline in IndexedDB, which is why the roadmap marks "Map resolution" as `blocked` on the desktop move (`docs/remaining-roadmap.md:52`) |

---

## 3. Framework evaluation & decision

### 3.1 Criteria applied to *this* codebase

The app needs from a shell exactly: (1) a stable origin for IndexedDB, (2) file save/open dialogs + file writes, (3) a Windows installer, (4) optionally an updater. It does **not** need a backend process doing work: every feature — search, graph physics, EPUB zipping, image compression — already runs in the page (FlexSearch, JSZip, canvas in `imageUtils.ts`, `manuscriptExport.ts:buildEpub` is a pure function).

### 3.2 Tauri v2

- **Build integration:** trivially good. Tauri wraps an existing `dist/`; `tauri.conf.json` gets `beforeDevCommand: "npm run dev"` / `beforeBuildCommand: "npm run build"` and `devUrl: http://localhost:5174` (the pinned port in `vite.config.ts` slots straight in; `strictPort` even protects `tauri dev` from drift). Hash routing (`src/main.tsx:HashRouter`) works unchanged under Tauri's production origin.
- **Webview:** WebView2 (Chromium) on Windows, preinstalled/evergreen on Windows 11. Leaflet, Tiptap, canvas, WebGL2 (three.js for `GraphView3D`) are all standard Chromium fare — if anything this *removes* risk versus the current Firefox target (Chromium is the engine these libraries are primarily tested on). The production origin (`http://tauri.localhost` on Windows) is stable across launches and versions, which permanently kills the port-drift/origin-loss class of data hazard that `vite.config.ts` and `start-lore-codex.cmd` exist to mitigate.
- **Native FS:** `@tauri-apps/plugin-dialog` (save/open pickers) + `@tauri-apps/plugin-fs` (scoped reads/writes), both called from TypeScript. No Rust code to write — `src-tauri/` is generated scaffolding plus config.
- **Rust burden:** near zero for this feature set. Rust becomes relevant only in optional Phase 3 (e.g. `tauri-plugin-sql`, still config-level) or if custom commands are ever needed. The real cost is a one-time Rust toolchain install and slower cold release builds.
- **Bundle/install:** NSIS `.exe` or MSI, ~5–10 MB. Irrelevant to disk space but very relevant to build time, CI minutes, and update download size.
- **Security model:** default-deny capabilities; each plugin permission (which paths `fs` may touch, etc.) is declared in `src-tauri/capabilities/`. A compromised page can only do what's whitelisted — a good match for the app's "untrusted data only enters on import" posture (§7).
- **Auto-update:** `tauri-plugin-updater` — signed artifacts (minisign keypair, free) + a `latest.json` on GitHub Releases. Works, but adds key management; see §6 for why to defer it.
- **Known webview gaps to plan around (all confirmed against the seam inventory in §2.5):** wry does **not** handle `<a download>` navigation downloads by default (breaks all four `triggerDownload`-style sinks), and `window.open('')+document.write+print()` (`manuscriptExport.ts:printBook`) plus `alert()/confirm()` are unreliable across wry versions. All have straightforward replacements (§8) and the repo already anticipated the dialog issue with `ConfirmDialog.tsx`.

### 3.3 Electron

- **Build integration:** equally fine (load `dist/` from `file://` or a custom protocol; hash routing again saves the day).
- **Webview:** bundled Chromium — maximum compatibility and *you* control the version; `<a download>` and `window.print()` work natively, so ~4 of the §8 breakages vanish.
- **Cost:** ~100 MB per install *and per update*; a Node main process you must write and secure (context isolation, preload scripts, IPC surface); the Chromium/Electron upgrade treadmill lands on the solo maintainer instead of Microsoft. `electron-updater` is the most mature auto-update story in this comparison.
- **Verdict:** more moving parts owned by you, for capabilities this app doesn't currently need. The roadmap's historical assumption ("Electron + on-disk JSON", `docs/remaining-roadmap.md:130`) predates the repository seam and shouldn't bind the decision.

### 3.4 Installable PWA

- Firefox — the browser the whole current setup is built around — supports neither desktop PWA installation nor the File System Access API, so a PWA means switching to Chrome/Edge *anyway*, at which point the FS Access API would allow real file handles… but storage stays origin-keyed and quota-bound, snapshots stay inside the DB they protect, `navigator.storage.persist()` remains a request rather than a guarantee, and there is no installer/updater story beyond the browser. It solves the smallest slice of the problem for nearly the same disruption. Rejected.

### 3.5 Decision

**Tauri v2**, Windows NSIS target. **Runner-up: Electron.** Switch to Electron if:
1. the Phase-0 spike shows a WebView2/wry blocker without a clean workaround (candidates: print flow, WebGL context loss in `GraphView3D`, IndexedDB durability semantics — §10 spikes), or
2. a future feature genuinely needs Node in the backend (e.g. a filesystem watcher + node-only parser ecosystem), or
3. the Rust toolchain proves an unacceptable ongoing tax in CI (unlikely: it's `cargo build` driven by `tauri-action`).

The Phase 0/1 code changes below are framework-agnostic on purpose (a `platform.ts` seam with browser and shell implementations), so switching shells later costs the scaffolding, not the app work.

---

## 4. Data layer strategy (centerpiece)

### 4.1 How insulated is the app from Dexie, really?

Three layers of coupling, in increasing difficulty:

1. **Mutations & one-shot reads** — largely behind functions already: `pageRepo`/`mapRepo` (`src/db/repositories.ts`) plus per-module CRUD (`db/pages.ts`, `db/maps.ts`, `db/manuscript.ts`, `db/calendar.ts`, …) re-exported through the barrel `src/db/index.ts`. Swappable behind the barrel.
2. **Direct `db.*` table access in UI** — the leak list in §2.4: roughly 15 non-test UI files still query tables directly (templates, manuscript tables, calendars, meta, counts). Mechanical to sweep into repositories; the seam's own header calls this "a follow-up sweep".
3. **Reactivity** — the hard one. `useLiveQuery` (dexie-react-hooks) appears **101 times in 33 files**, plus two raw `liveQuery` subscriptions (`App.tsx:52` for the search index, `db/schema.ts:255` for the category-colour cache). Dexie's change tracking is what makes every view update on every edit with zero app code. The repositories deliberately exploit this: "`useLiveQuery(() => pageRepo.get(id))` stays reactive — Dexie tracks the read globally" (repositories.ts:10–14). **Any storage backend that isn't Dexie must bring its own invalidation story for all 101 sites.** That is the dominant cost of options (b) and (c) below, and no repository interface written so far reduces it.

Also structural: the **binding-at-load pattern**. `db` is constructed at module load from `currentLoreId()` (`schema.ts:251`), and world switches reload the page (`lores.ts:switchLore`). Any redesign that keeps this pattern keeps its simplicity (no dynamic re-binding bugs); file-per-world maps onto it perfectly.

### 4.2 Options

**(a) Keep IndexedDB/Dexie as-is; add native file import/export + an on-disk mirror.**
- *What changes:* nothing in the data layer. A shell-side `platform.ts` provides `saveFile`/`openFile`; `exportAll()` output additionally gets written to a per-world file on disk automatically (details in §5).
- *Payoff:* real Save-As/Open (kills the Firefox limitation), a durable on-disk copy per world that a sync client can pick up, origin stability from the shell itself. Zero reactivity work; the entire Vitest suite (fake-indexeddb based) stays valid.
- *Not gained:* storage beyond browser quota (data-URL images still live in IndexedDB), and the disk copy is a mirror, not the store of record — a write path that fails silently still relies on `storageError.ts` detection.
- *Risk:* **low**. Effort: **S–M**.

**(b) Keep the Dexie API surface, swap the backing store** (e.g. Dexie on top of a custom backend, or absurd-sql-style SQLite-in-webview).
- This buys nothing this app needs: it keeps the quota-ish constraints of webview storage or reimplements Dexie's observability against a different engine — the highest-risk quadrant (all of the reactivity work, little of the payoff). **Rejected.**

**(c) Migrate to SQLite (or JSON files) owned by the shell, behind the repositories.**
- *What changes:* finish the repository sweep (every `db.*` call site), then implement `PageRepository` etc. over `tauri-plugin-sql`; replace `useLiveQuery` with a repo-level change bus (each mutation emits; a `useRepoQuery(fn, deps)` hook re-runs on emit — coarse-grained invalidation is fine at this app's scale) or TanStack Query with invalidation keys.
- *Payoff:* storage bounded by disk, not quota; the DB file *is* the save file; enables the `blocked` roadmap items (full-resolution maps, real asset files, git-style history).
- *Cost/risk:* **high**. 33 files of reactivity change; transactionality of multi-table operations (`renamePage`'s atomic link rewrite, `importAll`'s clear+bulkAdd, `db/calendar.ts`'s cascade updates) must be re-proven; the test suite's fake-indexeddb foundation must be partially replaced. Weeks of work with a long correctness tail.

### 4.3 Recommendation

**Do (a) now — it is the 20% that delivers 80% of the motivation — and defer (c) until a concrete pain (quota, map resolution, perf) makes it worth the reactivity rewrite.** When (c) does happen, do it as two independent moves in this order:

1. **Assets out of the DB first** (Phase 3a): map images, gallery images, banners move from data-URL columns to real files under the app-data dir, referenced by path/asset-URL. This alone removes ~all quota pressure and unblocks "Map resolution" (`docs/remaining-roadmap.md:52`) — *without* touching reactivity, because the records (now holding a file reference instead of a megabyte string) still live in Dexie. The import sanitizer's data-URL checks (`db/backup.ts:sanitizeBackup`) move to file-type validation at the same boundary.
2. **Records to SQLite second** (Phase 3b), only if still needed afterward — likely it won't be: with assets externalized, the structured data of even a huge wiki is a few MB of JSON.

The trade-off being accepted: IndexedDB remains a browser-managed store the user can't see, and the on-disk mirror is eventually-consistent (as stale as the debounce window). That is mitigated by the mirror cadence + quit hook (§5.3) and is strictly better than today, where the *only* durable copy is a manually triggered download.

### 4.4 Per-world model → files on disk

`dbNameFor()`'s scheme maps 1:1 onto files: `<app-data>/worlds/<loreId>.lore` (JSON, the `exportAll()` payload) with the registry's metadata (name, banner) either folded into the file header or kept in a tiny `registry.json`. `switchLore()`'s reload-to-rebind pattern is *kept* — a reload inside the webview is cheap and preserves the "active world fixed for page lifetime" invariant the whole data layer assumes (`CLAUDE.md`, `schema.ts:251`). Deleting a world = `Dexie.delete` (as today, `lores.ts:65`) + moving its `.lore` file to a trash subfolder rather than deleting (cheap insurance the browser could never offer).

### 4.5 Migration & compatibility (no data stranded)

Existing data lives in **Firefox's** IndexedDB under `http://localhost:5174` — no desktop shell can read another browser's profile store. The bridge is the JSON backup format, which already has exactly the right machinery: version stamping (`CURRENT_SCHEMA_VERSION`), a forward ladder (`MIGRATIONS`/`migrateBackup`), pre-import validation (`parseBackup`), and import sanitization. The one-time path:

1. **Pre-work (before the first desktop release), in the web app:** bump `CURRENT_SCHEMA_VERSION` 11→12; `exportAll()` gains a `meta` array (excluding local-only keys: `lastBackupAt`, `snapshot-last-time`); add the corresponding `MIGRATIONS[11]` step (fill `meta: []` for older backups) and restore it in `importAll()`. **Without this, migrating via backup silently loses per-lore settings (`src/settings.ts`) and the user's home-page hero/about text (`home-config`, `lores.ts:104`)** — the `meta` table is currently absent from `exportAll()` (`db/backup.ts:189–226`).
2. In Firefox, one final session: export a backup **per world** (`exportAll()` is per-active-world; the user switches worlds and exports each — the wizard's instructions must say so). Snapshots are not migrated (they're disposable history); `recents`/`sidebarPrefs` in `localStorage` are cosmetic losses.
3. First run of the desktop app: `bootstrapDefaultLore()` finds an empty registry → the lore selector doubles as the migration wizard: "Import a backup file" per world → `parseBackup` → `importAll` → world registered. Old backups of any age keep working via the existing ladder — nothing new to build beyond the wizard UI and multi-file affordance.
4. The web build keeps working throughout (the platform seam falls back to browser behaviors), so there is no flag-day: the user can run both until confident, since each side imports the other's backups.

### 4.6 What replaces `useLiveQuery`?

Nothing, in the recommended plan — that is the point. If Phase 3b ever happens: a module-level change bus per table (`emit('pages')` from every repo mutation) + a `useRepoQuery(queryFn, tables, deps)` hook that re-runs on matching emits. Coarse per-table invalidation is acceptable: the largest live result sets are "all pages" (already re-fetched wholesale on every edit by the search-index subscription in `App.tsx:52` without any observed cost) — the app's scale simply doesn't require row-level precision. The two non-React `liveQuery` subscriptions (`App.tsx`, `schema.ts`) subscribe to the same bus. This is a known, boring pattern; its cost is the 33-file sweep, not design risk.

---

## 5. Filesystem & backups: before / after

### 5.1 Today (the Firefox constraint, explicit)

Every escape of data from the app is a **browser download to the Downloads folder with a timestamped name**: `downloadBackup()` / `downloadPreImportBackup()` (`src/backup.ts`), the graph PNG (`graphExport.ts:downloadBlob`), the HTML-site zip (`htmlExport.ts:215`), the EPUB (`manuscriptExport.ts:exportBookEpub`). There is no "save to the same file", no "open", no user-chosen location — because Firefox has no File System Access API (memory + `src/backup.ts` header both record this as the shaping constraint). Restore is a manual `<input type="file">` upload (`SettingsRoute.tsx:handleImport`). Snapshots (`snapshots.ts`) live inside the same IndexedDB — they protect against bad edits, not against losing the store itself.

### 5.2 After Phase 1 (native dialogs)

- "Back up now" → **Save As** dialog (`plugin-dialog.save`) defaulting to the last-used folder + `lore-backup-<stamp>.json`, written via `plugin-fs.writeTextFile`. Same for graph PNG, HTML export zip, EPUB (binary writes).
- "Import backup" → **Open** dialog; the confirm-with-counts flow (`parseBackup` → `downloadPreImportBackup` → `importAll` in `SettingsRoute.tsx:confirmImport`) is unchanged except the pre-import safety copy is written to a fixed `backups/` folder in app-data instead of downloaded.
- `ErrorBoundary`'s "Download a backup" panic button becomes a real save dialog — strictly better in the moment it matters most.

### 5.3 After Phase 2 (auto-mirror)

- Each world auto-saves its `exportAll()` JSON to `<app-data>/worlds/<loreId>.lore` — **atomically** (write temp file, rename over), debounced on the exact cadence `maybeTakeSnapshot()` already hooks ("on start + after each edit session", `CLAUDE.md`), plus a flush on window close (Tauri close-requested event). The change-detection queries in `snapshots.ts:takeSnapshot` are reused as the dirty check.
- The user may point the worlds folder (or a secondary backup target) at a synced directory — turning the current "please manually move downloads into Dropbox" advice (`src/backup.ts` header) into automatic off-device safety.
- Snapshots can then graduate to `<app-data>/snapshots/<loreId>/<timestamp>.json` files with the same retention policy (`settings.ts:snapshotRetention`) — surviving anything that happens to the webview profile. `BackupBanner`'s nagging logic (`hasUnbackedUpChanges`, `isBackupOverdue`) can be retired or repurposed to watch the mirror's health.

---

## 6. Packaging, build & release

- **Local build:** `npm run tauri build` runs `beforeBuildCommand` (`tsc -b && vite build`, unchanged from `package.json:scripts.build`) then compiles the shell and emits an NSIS `.exe` installer. `npm run dev` / Vitest / ESLint workflows are untouched; `tauri dev` wraps the same Vite server on 5174.
- **Version sync:** `version-bump.yml` already bumps `package.json` and tags `vX.Y.Z` on merge, driven by PR labels. Point `tauri.conf.json`'s `version` at `package.json` so one bump drives both (Tauri supports reading version from a package.json path; verify in the scaffold spike — worst case, a 3-line sync step in the release workflow).
- **CI evolution:** keep `ci.yml` exactly as-is (lint + build + test on ubuntu — it validates the webapp, which remains the substance). Add a *separate* `release.yml` on `push: tags: ['v*']` using `tauri-apps/tauri-action` on `windows-latest` to build the installer and attach it to a GitHub Release. This keeps the slow Rust build off the PR path entirely. (Note the existing caveat in `CLAUDE.md`: the tag is pushed by `version-bump.yml` with a PAT — tag-push events from a PAT *do* trigger workflows, unlike `GITHUB_TOKEN`, so this wiring works; verify once.)
- **Code signing: skip it.** Unsigned is acceptable for a personal tool — the only cost is a one-time SmartScreen "More info → Run anyway" on each new installer, on a machine the author owns. An OV/EV cert is a recurring cost with zero benefit at N=1 users. Revisit only if the app is ever distributed.
- **Auto-update: defer to a later phase, possibly forever.** `tauri-plugin-updater` requires signing update artifacts with a minisign key and hosting `latest.json`; for a solo user, "download the new installer from GitHub Releases when you feel like it" is simpler and has no key-loss failure mode. The app's data lives outside the install dir, so reinstall-over-top is safe. If update fatigue sets in, add the updater then (Phase 4, S-sized).
- **`start-lore-codex.cmd` retires** in production (the installer creates the shortcut; origin stability is inherent). Keep it for the dev workflow if desired.

---

## 7. Security surface in a desktop shell

- **Threat model stays the same at the app layer:** untrusted data enters only via backup import, and `db/backup.ts:sanitizeBackup` + `src/sanitize.ts:sanitizeHtml` remain exactly as necessary and sufficient as today — a desktop shell raises the *stakes* of an XSS (a script in the webview could try to reach shell APIs) but not the entry points. Keep the DOMPurify boundary; do not relax it because "it's local now."
- **Capabilities are the new boundary.** With Tauri, the equivalent of "what can injected script do" is governed by `src-tauri/capabilities/`: grant `dialog` (all of it is user-mediated), `fs` scoped to `$APPDATA/**` plus dialog-returned paths only, and nothing else. No shell-execute, no HTTP, no custom Rust commands ⇒ even a successful XSS is confined to the app's own data directory — which the attacker-controlled backup already replaced anyway. This is materially stronger than Electron's default posture and infinitely stronger than granting a Node `require` surface.
- **Add a CSP — currently there is none** (`index.html`). Tauri injects the CSP from `tauri.conf.json`; set roughly `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'` (data-URL images are load-bearing everywhere: editor images, infobox, maps, galleries — `img-src data:` is required; Tiptap/React need no script relaxations). **Prerequisite: self-host the Google Fonts** (`index.html:7–12`) — required for offline correctness anyway.
- **IPC boundary:** in Phases 0–2 the only IPC is plugin calls from `platform.ts` (save/open/write). Centralizing them in one module keeps the audit surface one file. No `dangerousRemoteDomainIpcAccess`, no custom protocol handlers beyond defaults.
- **New in Phase 3a:** serving user images from disk via Tauri's asset protocol — scope it to the app's assets dir; validate file type on import (replacing the data-URL prefix checks in `sanitizeBackup`). SVG stays excluded (same reasoning as `db/backup.ts:249–254` — scriptable content).
- **`window.open`-based print** (`printBook`) writes compiled HTML into a blank window; that HTML passes through `toXhtml` → `sanitizeHtml` already (`manuscriptExport.ts:13`). Whatever replaces the print mechanism (§8) must keep feeding it sanitized markup — no new gap, just don't lose the old guarantee.

---

## 8. Breakage & adaptation checklist

Ordered by severity under a Tauri/WebView2 shell. "Fix" names the phase from §9.

| # | Assumption / site | What happens in the shell | Fix |
|---|---|---|---|
| 1 | `<a download>` + `URL.createObjectURL` — `backup.ts:triggerDownload`, `graphExport.ts:downloadBlob`, `htmlExport.ts:215`, `manuscriptExport.ts:exportBookEpub` | **Breaks.** wry does not handle download navigations by default; the click silently does nothing. This includes *backups* — unusable without a fix, hence it gates Phase 0. | `platform.ts:saveFile(data, suggestedName)` — browser impl = current code, Tauri impl = dialog + fs. 4 call sites. (Phase 0) |
| 2 | Existing user data origin-keyed to Firefox `localhost:5174` | Desktop app starts with an **empty DB**; looks like total data loss to the user | First-run migration wizard + per-world backup export from Firefox (§4.5). Pre-work: schema v12 `meta` export. (Phase 1; pre-work ships in the web app first) |
| 3 | `window.open('') + document.write + win.print()` — `manuscriptExport.ts:printBook` | Unreliable: Tauri's `window.open` is not a full Chromium popup; print support via wry varies | Render into a hidden same-window iframe and call its `print()`, or a dedicated print WebviewWindow. **Spike.** (Phase 1) |
| 4 | `alert()`/`confirm()` — `SettingsRoute.tsx`, `HomeRoute.tsx:168`, `StructureControls.tsx:29,33` | Suppressed or inconsistent in wry (the repo's own import-safety spec flagged exactly this) | Replace the 6 remaining sites with the existing `components/ConfirmDialog.tsx` pattern. (Phase 1) |
| 5 | Google Fonts CDN — `index.html:7–12` | App typography breaks offline; violates the new CSP | Self-host the three families (Cinzel, EB Garamond, Inter) as bundled woff2. (Phase 0/1) |
| 6 | No CSP — `index.html` | Webview runs with default policy; Tauri expects a configured CSP | Set CSP in `tauri.conf.json` incl. `img-src data:` (§7). (Phase 1) |
| 7 | Port pinning + `start-lore-codex.cmd` | Obsolete in production (stable app origin); still correct for dev | No change; retire the `.cmd` as the user-facing entry point. (Phase 0) |
| 8 | `window.location.reload()` — `lores.ts:37,71`, `ErrorBoundary.tsx:51` | Works (reloads the webview page). The rebind-on-reload pattern survives intact | None. |
| 9 | `HashRouter` — `main.tsx` | Works under the production origin; **do not** switch to BrowserRouter (history routing over custom protocols is where SPAs break) | None. |
| 10 | `localStorage` — `loreId.ts`, `lores.ts`, `recents.ts`, `sidebarPrefs.ts` | Works; persisted in the WebView2 profile under app-data. Wiping webview data would also wipe the active-world pointer & bootstrap flag | Accept now; optionally move `current-lore-id` + `lore-bootstrapped` into a shell config file in Phase 2 (they gate data visibility, unlike the cosmetic prefs). |
| 11 | `navigator.storage.persist()` — `backup.ts:14` | Harmless; likely auto-granted or no-op in WebView2 | None; delete once the disk mirror exists. |
| 12 | IndexedDB itself (Dexie, 16 tables, per-world DBs) | Works in WebView2. **Verify** where the profile lives (`%LOCALAPPDATA%\<app>\EBWebView\...`) and that it survives app updates/reinstalls | Spike in Phase 0; document the folder for manual-backup peace of mind. |
| 13 | WebGL (`GraphView3D`/three), canvas 2D (`GraphView`, `graphExport` PNG, `imageUtils.compressImage`) | Expected fine (Chromium); WebGL depends on ANGLE/driver | Smoke-test in the Phase 0 spike; 3D graph is non-critical (2D fallback exists). |
| 14 | Leaflet + leaflet-draw (`MapView.tsx`) | Plain DOM/canvas — fine | None. |
| 15 | `<input type="file">`/`FileReader` image pickers (6 sites, §2.5) | Work fine in WebView2 | None (optionally nativize later for folder defaults). |
| 16 | Vitest suite (happy-dom/jsdom + fake-indexeddb) | Unaffected — app code is unchanged in Phase 0; `platform.ts` browser impl keeps tests browser-shaped | Add unit tests for the seam's browser impl; Tauri impl is thin enough to leave to manual verification. |

---

## 9. Phased migration plan

Each phase ships independently, keeps `npm run lint/build/test:run` green, and leaves the web build working (the platform seam always has a browser implementation).

**Pre-work (web app, before any shell): backup schema v12.** Add `meta` (minus local-only keys) to `exportAll`/`importAll`, bump `CURRENT_SCHEMA_VERSION`, add `MIGRATIONS[11]`, tests alongside `db/backup.test.ts`. *Why first:* every backup taken from today onward becomes a complete migration vehicle. (Size: **S**)

**Phase 0 — wrap as-is (shell + save seam).**
Scaffold `src-tauri/` (config only; `devUrl` → 5174, `beforeBuildCommand` → existing build). Create `src/platform.ts` exposing `saveFile(data: Blob|string, suggestedName: string)` with browser (current `triggerDownload` code) and Tauri (dialog+fs) implementations chosen by feature detection; convert the 4 download sinks to it. Self-host fonts. Everything else untouched — Dexie/IndexedDB intact inside WebView2. Run the §10 spikes against this build. *Exit criterion:* installer produces a working app; backups save via real dialog; existing web flow unchanged. (Size: **M**, mostly scaffolding + spikes)

**Phase 1 — native backups & first-run migration.**
Open-dialog import path in `SettingsRoute`; pre-import safety copy to an app-data `backups/` folder; migration wizard on the empty-registry first run (§4.5, reusing `parseBackup` counts UI); replace remaining `alert`/`confirm` with `ConfirmDialog`; fix the print path (checklist #3); set the CSP. *Exit criterion:* a Firefox user migrates all worlds via backups with settings + home config intact, and never touches the Downloads folder again. (Size: **M**)

**Phase 2 — the disk becomes durable: per-world auto-mirror.**
`<app-data>/worlds/<loreId>.lore` written atomically on the `maybeTakeSnapshot` cadence + on close; a "world files" section in Settings (reveal folder, set secondary/synced backup target); snapshots optionally to disk; retire/repurpose `BackupBanner`. Registry metadata mirrored to `registry.json`. *Exit criterion:* deleting the entire WebView2 profile loses at most one debounce-window of edits, recovered by opening the `.lore` file. (Size: **M**)

**Phase 3 (optional, pain-driven) — storage evolution behind the seam.**
- **3a — assets to disk:** map/gallery/infobox/banner images stored as files, records hold references; asset-protocol serving; import/export packs assets (zip-based `.lore` container). Unblocks map resolution. No reactivity changes. (Size: **L**)
- **3b — records to SQLite:** finish the repository sweep (§4.1 layer 2), introduce the change-bus + `useRepoQuery` (§4.6), implement repositories over `tauri-plugin-sql`, port `renamePage`/`importAll` transactionality, migrate tests. Only if 3a leaves a real problem standing. (Size: **XL** — this is the item that would feel like a rewrite; everything before it is incremental.)

**Phase 4 (optional) — updater** via `tauri-plugin-updater` if manual installs grow tiresome. (Size: **S**)

---

## 10. Risks, open questions & effort

### Risks, ranked

1. **Migration UX / stranded data** (high impact, controllable): a user who installs the desktop app before exporting per-world backups from Firefox sees an empty app; `meta` omission would silently drop settings/home config. *Mitigation:* pre-work schema v12 ships first; wizard copy explicitly walks the per-world export; Firefox data is never deleted by the transition (it just sits there as a fallback).
2. **wry/WebView2 behavioral gaps** (medium): downloads (certain, fix planned), print (probable, spike), host dialogs (known, fix planned), WebGL edge cases (unlikely). *Mitigation:* all are Phase 0/1 spikes with known fallbacks; Electron remains the documented plan B (§3.5).
3. **Dual-target drift** (medium, chronic): web + desktop share one codebase; a new feature using a browser-only or shell-only API breaks the other target. *Mitigation:* the rule "all shell APIs go through `platform.ts`" is small enough to hold by convention + a lint grep in CI if it ever slips.
4. **IndexedDB durability semantics under WebView2** (low probability, high impact): profile location, eviction policy, behavior across WebView2 runtime updates. *Mitigation:* Phase 0 spike; Phase 2's disk mirror caps the blast radius permanently.
5. **Phase 3b underestimation** (high if attempted): the 101-site reactivity sweep plus transactional re-proofs is the only genuinely large item. *Mitigation:* it is optional, last, and gated on demonstrated need; 3a (assets) removes its main motivator first.

### Open questions → spikes (½–1 day each, on the Phase 0 build)

- Where does WebView2 put the IndexedDB profile for a Tauri app, and does it survive uninstall/reinstall and WebView2 runtime updates? (Informs migration copy + mirror urgency.)
- Does `win.print()`/window.open flow work at all under current wry, and does a hidden-iframe print render `compileBookHtml` correctly (page breaks)?
- `GraphView3D` (three.js WebGL2) + `graphExport` canvas-PNG under WebView2 — render and export correctly?
- Can `tauri.conf.json` read the version from `package.json` in Tauri v2, or does `release.yml` need a sync step? Does the PAT-pushed tag from `version-bump.yml` trigger the release workflow? (One-time verification.)
- NSIS vs MSI target; per-user install (no admin) preferred.

### Effort summary

| Item | Size |
|---|---|
| Pre-work: schema v12 (`meta` in backups) | **S** |
| Phase 0: shell scaffold + `platform.ts` + fonts + spikes | **M** |
| Phase 1: dialogs, wizard, print, CSP, ConfirmDialog sweep | **M** |
| Phase 2: atomic per-world mirror + settings UI | **M** |
| Phase 3a: assets to disk | **L** |
| Phase 3b: SQLite + reactivity replacement | **XL** (avoid until forced) |
| Phase 4: updater | **S** |

Nothing in Phases 0–2 forces a rewrite of anything; the only rewrite-shaped item in the whole plan is 3b, and the strategy's core claim is that 3a makes it unnecessary.

---

## 11. Appendix: file-by-file seam map

### Pre-work (web app)
| File | Why |
|---|---|
| `src/db/backup.ts` | Bump `CURRENT_SCHEMA_VERSION` to 12; add `meta` to `BackupData`/`exportAll`/`importAll`/`sanitizeBackup` passthrough; add `MIGRATIONS[11]` |
| `src/db/backup.test.ts` | Cover the v11→v12 ladder + meta round-trip |

### Phase 0
| File | Why |
|---|---|
| `src-tauri/**` (new) | Shell scaffold: config, capabilities (dialog + scoped fs), icons; no custom Rust |
| `src/platform.ts` (new) | The shell seam: `saveFile()` (browser + Tauri impls); all future shell APIs land here |
| `src/backup.ts` | `triggerDownload` → `platform.saveFile` |
| `src/graphExport.ts` | `downloadBlob` → `platform.saveFile` |
| `src/htmlExport.ts` | Zip download → `platform.saveFile` |
| `src/manuscriptExport.ts` | EPUB download → `platform.saveFile` |
| `index.html` | Drop Google Fonts CDN; reference self-hosted woff2 |
| `package.json` | `tauri` scripts + `@tauri-apps/*` deps (dev-time; app deps unchanged) |

### Phase 1
| File | Why |
|---|---|
| `src/platform.ts` | Add `openFile()` (dialog + read) |
| `src/routes/SettingsRoute.tsx` | Import via `openFile`; pre-import copy to app-data; `alert()` → dialog component |
| `src/routes/LoreSelectorRoute.tsx` | First-run migration wizard (empty registry ⇒ offer per-world backup import) |
| `src/components/ErrorBoundary.tsx` | Panic backup via `platform.saveFile` |
| `src/manuscriptExport.ts` | `printBook` → hidden-iframe / print-window mechanism (spike outcome) |
| `src/routes/HomeRoute.tsx`, `src/components/manuscript/StructureControls.tsx` | Replace `alert`/`confirm` with `ConfirmDialog` |
| `src-tauri/tauri.conf.json` | CSP (`img-src data:` etc.) |
| `.github/workflows/release.yml` (new) | Tag-triggered Windows installer build (`tauri-action`); `ci.yml` untouched |

### Phase 2
| File | Why |
|---|---|
| `src/platform.ts` | `writeWorldMirror(loreId, json)` atomic write; app-data paths; close-requested flush hook |
| `src/snapshots.ts` | After `maybeTakeSnapshot`'s dirty check, also refresh the disk mirror (shared cadence) |
| `src/lores.ts` | Mirror registry to `registry.json`; world delete moves `.lore` to trash folder |
| `src/backup.ts` / `src/components/BackupBanner.tsx` | Retire or repurpose overdue-backup nagging (mirror supersedes it) |
| `src/routes/SettingsRoute.tsx` | "World files" section: reveal folder, choose synced backup target |

### Phase 3a (optional)
| File | Why |
|---|---|
| `src/imageUtils.ts` | Compress → write file via platform seam, return reference instead of data URL |
| `src/db/images.ts`, `src/db/maps.ts`, `src/lores.ts` | Records hold asset references; delete cascades remove files |
| `src/db/backup.ts` | `.lore` becomes a zip container (JSON + assets); sanitizer's data-URL checks become file-type checks |
| `src/htmlExport.ts`, `src/components/{MapView,ImageGallery,Infobox}.tsx` | Resolve asset references (asset protocol) instead of inlining data URLs |

### Phase 3b (optional, avoid until forced)
| File | Why |
|---|---|
| `src/db/repositories.ts` | Extend interfaces to templates/manuscript/calendar/meta/images; SQLite implementations |
| ~15 UI files from §4.1 layer 2 | Sweep remaining raw `db.*` calls into repositories |
| 33 `useLiveQuery` files + `src/App.tsx` + `src/db/schema.ts` | Reactivity swap: change bus + `useRepoQuery` |
| `src/db/pages.ts`, `src/db/calendar.ts`, `src/db/backup.ts` | Re-prove transactional operations (rename rewrite, cascades, import) on SQLite |
