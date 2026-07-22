# Prompt for Fable 5 — Investigate a Desktop-App Transition for Lore Codex

> Copy everything below the line into Fable 5. It is a self-contained investigation
> brief. Fable must **not modify any code** — its only deliverable is one Markdown
> report.

---

## Role

You are a software architect doing a **read-only investigation**. You will study this
codebase and produce a single Markdown design document that a later engineering session
can execute against. You are *planning*, not *building*.

## Hard constraints — read these first

1. **Do not edit, create, delete, or move any source file** except the one Markdown
   report named in "Deliverable" below. No refactors, no proof-of-concept branches, no
   `package.json` changes, no scaffolding. If you feel the urge to "just try it," stop
   and write the recommendation into the report instead.
2. **Do not run install/build commands that mutate the tree** (`npm install <new dep>`,
   `tauri init`, `electron-forge`, etc.). Read-only commands (`npm ls`, `git log`,
   `cat`, `grep`, reading files) are fine.
3. **Investigate before you conclude.** Read the actual files listed below; do not
   reason purely from this brief. Every recommendation must cite the concrete code it is
   based on (file path + why).
4. **One deliverable, one file.** Everything goes into the single report.

## What Lore Codex is (context, but verify against the code)

Lore Codex is a **local-first, in-browser worldbuilding wiki**. It is a React 19 + Vite 8
+ TypeScript (strict) SPA. **All data lives in the browser's IndexedDB via Dexie**;
nothing leaves the machine. It is currently shipped as a web app served on a pinned local
port (5174) and opened in Firefox via `start-lore-codex.cmd`.

Key architectural facts to confirm and build your analysis on:

- **Data layer** lives entirely in `src/db/` behind a barrel `index.ts`. Dexie schema and
  the `db` singleton are in `src/db/schema.ts` (Dexie store **v11**). CRUD, backups,
  snapshots, manuscript authoring, maps, calendar, graph all sit here.
- **Per-world databases:** each "lore" is its own IndexedDB (`src/loreId.ts`,
  `src/lores.ts`). `db` binds at module load to the active world; `switchLore()` and
  deleting the active world call `window.location.reload()` to rebind. A separate
  `lore-registry` IndexedDB tracks worlds.
- **Backup/restore** is JSON export/import (`src/db/backup.ts`, `src/backup.ts`).
  Backups are **download-based** and there is a known, deliberate limitation: **Firefox
  lacks the File System Access API**, so there is no "save to a real file / re-open the
  same file" flow today. This is a primary motivation for going desktop — call it out.
- **Storage resilience:** IndexedDB quota errors are surfaced through
  `src/storageError.ts` + `StorageErrorBanner`; persistent-storage is requested at
  startup (`requestPersistentStorage`). Auto-snapshots (`src/snapshots.ts`) keep 10
  recent snapshots inside the DB.
- **Security boundary:** untrusted data enters only on **backup import** and is scrubbed
  by DOMPurify in `src/sanitize.ts`. Page bodies render through Tiptap; there is one raw
  render sink in `TimelineVertical`.
- **Heavy browser-API dependencies to watch:** Tiptap editor, Leaflet maps
  (`leaflet` + `leaflet-draw`), FlexSearch index, JSZip (HTML export / EPUB compile),
  data-URL images, `react-force-graph-2d/3d` (WebGL), hash-based routing
  (`react-router-dom`), and EPUB/print-PDF manuscript export (`src/manuscriptExport.ts`).
- Read `CLAUDE.md` at the repo root — it is a dense, accurate architecture map. Trust it
  but spot-check against the source.

## Files to read (start here, expand as needed)

- `CLAUDE.md`, `package.json`, `vite.config.ts`, `tsconfig*.json`, `start-lore-codex.cmd`
- `src/main.tsx`, `src/App.tsx`
- `src/db/schema.ts`, `src/db/index.ts`, `src/db/backup.ts`, `src/db/snapshots.ts`
- `src/backup.ts`, `src/loreId.ts`, `src/lores.ts`
- `src/storageError.ts`, `src/sanitize.ts`
- `src/htmlExport.ts`, `src/manuscriptExport.ts`, `src/imageUtils.ts`
- `.github/workflows/` (CI + version-bump), to understand the release pipeline
- Grep for `window.location`, `localStorage`, `indexedDB`, `IndexedDB`, `URL.createObjectURL`,
  `navigator.storage`, `download`, and `blob:` / `data:` usage — these are the seams that
  a desktop shell changes.

## Investigation objectives

### 1. Framework recommendation (do not assume one)
Evaluate **Tauri**, **Electron**, and **installable PWA** *against this specific
codebase*. For each, assess: bundle size, security model, how well the existing Vite
build slots in, native filesystem access, auto-update story, Windows-first packaging
(the user is on Windows 11; `start-lore-codex.cmd` is Windows), Rust vs Node backend
burden, and long-term maintenance for a solo developer. **Pick one and justify it**, with
an explicit runner-up and the conditions under which you'd switch. Note webview
differences that could break Leaflet / WebGL force-graph / Tiptap.

### 2. Data layer — IndexedDB → native storage (deep focus)
This is the most important section. Investigate the path from browser IndexedDB/Dexie to
a **native persistence layer** (filesystem-backed JSON/SQLite, or keeping Dexie but adding
real file import/export). Address:
- The current **repository/DB seam** (`src/db/`, the `db` singleton, `useLiveQuery`
  reactivity via `dexie-react-hooks`). How much of the app is insulated from Dexie, and
  where does Dexie leak into components?
- **Per-world DB model** (`dbNameFor`, `switchLore`, the reload-to-rebind pattern) and how
  it maps onto files/folders on disk (e.g. one file per world).
- **Reactivity:** what replaces `useLiveQuery` if the store is no longer Dexie, or how to
  keep Dexie in the webview while gaining real file-open/save.
- A concrete recommendation with **trade-offs**: (a) keep IndexedDB, add native file
  import/export only; (b) keep Dexie API, swap backing store; (c) migrate to SQLite via
  the desktop backend. Weigh migration risk, effort, and the payoff (real file-based
  saves, larger-than-quota storage, no silent origin/port data loss).
- **Migration/compat:** existing users have data in IndexedDB. Describe a one-time
  import path from the current JSON backup format (`CURRENT_SCHEMA_VERSION`, the
  `MIGRATIONS` ladder in `src/db/backup.ts`) into whatever you recommend, so no data is
  stranded.

### 3. Filesystem, backups & the Firefox limitation
Show how going desktop **removes the download-only backup constraint**: real "Save As" /
"Open" dialogs, auto-save to a chosen `.lore` file/folder, and where snapshots live.
Reference the current download-based flow so the before/after is explicit.

### 4. Packaging, build & release
How the current `tsc -b && vite build` pipeline plugs into the chosen framework. Windows
installer, code signing (note if unsigned is acceptable for a personal tool), and how the
existing CI (`.github/workflows/ci.yml`) and label-driven `version-bump.yml` tagging
should evolve. Auto-update options.

### 5. Security surface in a desktop shell
What changes when the app is a native window: CSP, whether `sanitize.ts` is still
sufficient, node/Rust IPC boundaries, loading local images/data-URLs, and any new
attack surface from filesystem access. Keep the current "untrusted data enters only on
import" model in view.

### 6. What breaks or needs adaptation
Enumerate browser-specific assumptions that a desktop shell disturbs: hash routing,
`window.location.reload()` for lore-switching, `localStorage` usage, `URL.createObjectURL`
downloads, port-pinning (5174), origin-keyed IndexedDB, and any WebGL/canvas concerns for
the force-graph and Leaflet under the target webview.

### 7. Phased migration plan
A **staged, low-risk path** (e.g. Phase 0 wrap-as-is in the shell with IndexedDB intact →
Phase 1 native file backups → Phase 2 storage migration → …). Each phase must be
independently shippable and testable, with the existing Vitest suite kept green. Call out
where the repository seam in `src/db/` lets you swap implementations behind the barrel
without touching UI.

### 8. Risks, unknowns & effort
Rank the risks. List open questions that need a spike before committing. Give a rough
relative effort estimate per phase (t-shirt sizes are fine). Flag anything that could
force a rewrite vs. an incremental change.

## Deliverable

Write **one** Markdown file:

`docs/desktop-transition-investigation.md`

Structure it as:

1. **Executive summary** — the recommendation in 5–10 lines (framework + data-layer verdict).
2. **Current architecture (as-is)** — what the code actually does today, with file cites.
3. **Framework evaluation & decision** (objective 1).
4. **Data layer strategy** (objective 2) — the centerpiece.
5. **Filesystem & backups** (objective 3).
6. **Packaging & release** (objective 4).
7. **Security** (objective 5).
8. **Breakage & adaptation checklist** (objective 6).
9. **Phased migration plan** (objective 7).
10. **Risks, open questions & effort** (objective 8).
11. **Appendix: file-by-file seam map** — the specific files that must change, grouped by
    phase, each with a one-line "why."

Every claim about current behavior must cite a real `path:symbol`. Where you recommend a
change, state the trade-off you're accepting, not just the upside. Prefer concrete,
executable guidance over generic best-practice prose. If something can't be determined
without running code, say so and mark it as a spike rather than guessing.

**Reminder: produce only that one Markdown file. Change nothing else.**
