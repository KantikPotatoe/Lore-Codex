<div align="center">

# 📜 Lore Codex

**A local-first worldbuilding wiki that lives entirely in your browser.**

Write, link, and map the lore of your fictional worlds — inspired by World Anvil
and LoreKeeper. No account, no server, fully offline. Your world never leaves your machine.

[![Version](https://img.shields.io/github/package-json/v/KantikPotatoe/Lore-Codex?style=flat-square&color=c9a24b&label=version)](https://github.com/KantikPotatoe/Lore-Codex/releases)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-c9a24b.svg?style=flat-square)](LICENSE.md)
![React](https://img.shields.io/badge/React-19-1d1a14.svg?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-1d1a14.svg?style=flat-square&logo=typescript)
![Local-first](https://img.shields.io/badge/Local--first-offline-c9a24b.svg?style=flat-square)

</div>

---

## ✨ Why Lore Codex

Everything you write is stored **locally in your browser** via IndexedDB — there's no
sign-up, no cloud, and no network round-trip. It works on a plane, and your lore stays
private by default. Each world is its own isolated database, so you can keep a dozen
settings going at once without them bleeding together.

---

## 🌟 Features

### ✍️ Writing & linking

| | |
|---|---|
| **Rich-text pages** | Articles for characters, places, factions, items, events, and more — with headings, inline images (no upload), and editable tables for stat blocks. |
| **Wiki links** | Type `[[Page Name]]` to link pages. Renaming a page rewrites every reference automatically; broken links are flagged. |
| **Autolinker** | The first mention of any page's title in your prose links itself automatically — no `[[brackets]]` needed. Toggle it off in Settings. |
| **Citations** | Mark a claim with an in-world source — another page or free text, with an optional locator and quote — and a numbered References list builds itself at the foot of the page. |
| **Hover previews** | Hover a `[[wiki link]]` to peek at the linked page's category, title, and summary in a floating card. |
| **Backlinks & TOC** | Every page shows what links to it, plus an auto-generated table of contents from its headings. |
| **External links** | Attach a URL to selected text; opens in a new tab. |

### 🗂️ Organizing

| | |
|---|---|
| **Multiple worlds** | Fully isolated worlds you can create, rename, banner, delete, and switch between — each its own local database. |
| **Page types & templates** | Colour-coded categories with starter infobox rows and optional starter body sections you can drop into a page in one click. Use the built-ins or define your own; switching a page's type keeps the values you filled in. |
| **Tags** | Tag pages freely and open a tag to see every page that shares it. |
| **Infoboxes** | A per-page sidebar card with image, caption, and typed fields — text, numbers, and `[[reference]]` links — grouped under separator headings. |
| **Image galleries** | Attach a grid of images to a page, view them in a lightbox, reorder them, and promote any one to the page's portrait. |

### 🗺️ Visualizing your world

| | |
|---|---|
| **Interactive maps** | Upload a map image and drop pins linked to lore pages. Draw regions as polygons and nest maps inside one another. |
| **Relationship graph** | A force-directed graph of every page and the links between them — node size shows how connected a page is, surfacing hubs and isolated pages. |
| **Timeline & calendars** | Define custom calendars (months, eras, year lengths) and place events on a shared timeline — list or zoomable axis. Calendars share one absolute-day axis so events line up. |

### ✒️ Writing the novel

| | |
|---|---|
| **Manuscript workspace** | Write the actual book alongside its lore. Organize it as **Book → Chapter → Scene**, draft each scene in the same rich-text editor, and track live word counts per scene, chapter, and book. |
| **Scene metadata** | Give each scene a POV, cast, and location by linking wiki pages — then any page shows the scenes it "appears in". Scenes carry their own draft status (Outline → Draft → Revised → Done), separate from page statuses. |
| **Plotline grid** | A Plottr-style board of plotline lanes and beat cells for planning arcs across scenes. |
| **Story structures** | Drop in a built-in framework — Save the Cat, Hero's Journey, or Snowflake — as a structure track and align your scenes to its beats. |
| **Compile & export** | Export a finished book to **EPUB** (a valid `.epub` with navigation) or open a print-ready page for **Save-as-PDF**. |

### 🔍 Finding things

| | |
|---|---|
| **Full-text search** | A keyboard-driven modal searching titles, summaries, tags, and body content, with highlighted snippets. |
| **World health dashboard** | A to-do list for your world: broken `[[links]]` with one-click stub creation, orphan pages nothing links to, and pages still marked Stub. Summarized on Home, full detail at `/health`. |

### 💾 Data & safety

| | |
|---|---|
| **Backup & restore** | Export everything to a JSON file and re-import anytime. Import validates the file, shows what it'll replace, writes a recovery backup first, and migrates older backups forward. |
| **Auto-snapshots** | Local snapshots saved automatically (after ~50 changes or 24h of activity); restore any from Settings. |
| **Export as HTML** | Download a self-contained ZIP of your wiki as a browsable static site — index by category, one page per article, with infoboxes, images, citations, and resolved links. |
| **Settings** | Per-world controls for snapshot frequency and retention, the backup-overdue window, and the autolinker — plus backup, import, HTML export, and deleting the world. |
| **Overdue nudges** | The Home screen and the top banner track edits since your last backup and turn red when one is overdue. |

---

## 🚀 Getting started

You need [Node.js](https://nodejs.org). **First time only:**

```bash
npm install      # download dependencies
```

Then **double-click `start-lore-codex.cmd`** to launch — it opens Firefox at
`http://localhost:5174` and starts the app. Tip: right-click → *Pin to Start* so it
launches like a regular app.

> ⚠️ **Always launch this way.** Your lore is stored in Firefox under the exact address
> `localhost:5174`. Opening a *different* browser or port shows a *different* (empty)
> database — your data isn't gone, it's just tied to the original address. The launcher and
> the pinned port (`vite.config.ts`) guarantee you return to the same place.

<details>
<summary><b>Other commands</b></summary>

```bash
npm run dev      # start manually (also port 5174, hot reload)
npm run build    # type-check + optimized production build → dist/
npm run preview  # preview the production build (port 5174)
npm run lint     # ESLint
npm run test:run # run the test suite once (Vitest)
```

</details>

---

## 🧰 Tech stack

| Area | Built with |
|---|---|
| **Framework** | React 19 · TypeScript (strict) · Vite |
| **Editor** | TipTap |
| **Maps** | Leaflet + leaflet-draw |
| **Graph** | react-force-graph-2d |
| **Storage** | Dexie (IndexedDB) |
| **Search** | FlexSearch |
| **Safety** | DOMPurify (sanitization) · JSZip (HTML export) |
| **Testing** | Vitest |

---

## 🗃️ Project structure

<details>
<summary><b>Where things live</b></summary>

```
src/
  db/                    Data layer (single source of truth), behind a barrel index.ts:
    types.ts             Data-model interfaces
    schema.ts            Dexie schema, version ladder, db singleton
    templates.ts         Page types: built-ins, seeding, template CRUD
    pages.ts             Page CRUD, rename link-rewriting, backlinks
    maps.ts              Maps / pins / regions CRUD
    images.ts            Per-page image gallery CRUD
    graph.ts             Relationship-graph builder
    calendar.ts          Timeline calendar / event CRUD
    snapshots.ts         Snapshot CRUD
    manuscript.ts        Book / chapter / scene / plotline / beat CRUD + word counts
    worldHealth.ts       Broken links / orphans / stubs analysis
    backup.ts            Export / import + versioned migrations + sanitization
  loreId.ts              Active-world id + per-world database naming
  lores.ts               World registry + create/rename/delete/switch
  settings.ts            Per-world settings (snapshots, backup window, autolink)
  calendar.ts            Pure date math (absolute-day axis, eras, formatting)
  search.ts              FlexSearch full-text index + incremental sync
  autolink.ts            Title matcher + first-mention planner for the autolinker
  citations.ts           Reads citation markers from a page body
  toc.ts                 Heading slug / nesting helpers for the table of contents
  sectionNodes.ts        Turns a page type's starter sections into editor nodes
  imageUtils.ts          Client-side image resize / compression
  htmlExport.ts          HTML static-site export (JSZip)
  manuscriptExport.ts    Compile a book to EPUB (JSZip) + print-ready HTML
  manuscriptStructures.ts Built-in story structures (Save the Cat, etc.)
  sanitize.ts            DOMPurify whitelist for imported / raw-rendered HTML
  html.ts                Shared HTML parsing helpers
  backup.ts              Download/import helpers + backup-overdue tracking
  snapshots.ts           Auto-snapshot trigger logic
  storageError.ts        IndexedDB quota detection + notice bus
  wikiLinkHover.ts       Event bus for wiki link hover state
  main.tsx               App entry + ErrorBoundary
  App.tsx                Hash routing, layout shell, global overlays + wiring
  routes/
    LoreSelectorRoute.tsx  World picker (no shell)
    HomeRoute.tsx          Dashboard: hero, stats, recently edited
    PageRoute.tsx          View / edit a lore page
    CategoryRoute.tsx      Page-card grid for a category
    TagRoute.tsx           Page-card grid for a tag
    MapRoute.tsx           Maps, pins, regions
    GraphRoute.tsx         Relationship graph
    TimelineRoute.tsx      Timeline (list / axis)
    ManuscriptRoute.tsx    Book library (grid of books + word-count stats)
    BookRoute.tsx          Book workspace: Write / Grid views + EPUB / PDF compile
    TemplatesRoute.tsx     Manage page-type templates
    SettingsRoute.tsx      Settings, backup / import, HTML export, snapshots
    HealthRoute.tsx         World health: broken links, orphans, stubs
  components/
    manuscript/            Binder tree, scene editor + meta, grid, structure controls
    Sidebar.tsx            Navigation, page list, search trigger
    LoreEditor.tsx         Rich-text editor (TipTap) with toolbar
    Infobox.tsx            Page sidebar card with typed fields
    Backlinks.tsx          "What links here" panel
    References.tsx         Numbered citation list for a page
    TableOfContents.tsx    Auto TOC from page headings
    BrowseCard.tsx         Page card used by the category / tag grids
    EmptyState.tsx         Reusable empty-state placeholder
    Breadcrumb.tsx         Nested-map / page breadcrumb trail
    ConfirmDialog.tsx      Reusable confirm modal
    ImageGallery.tsx       Per-page image grid
    Lightbox.tsx           Fullscreen image viewer
    MapView.tsx            Leaflet map rendering + pins + regions
    MapPreviewCard.tsx     Click-to-preview card before editing a pin / region
    GraphView.tsx          Force-directed graph rendering
    HubsOrphansPanel.tsx   Most-linked / isolated pages beside the graph
    TimelineVertical.tsx   Timeline list view
    TimelineHorizontal.tsx Timeline zoomable axis
    CalendarEditor.tsx     Calendar definition modal
    EventEditor.tsx        Timeline event modal
    SearchModal.tsx        Full-text search overlay with keyboard navigation
    WikiLinkPopover.tsx    Hover preview card for wiki links
    StorageErrorBanner.tsx IndexedDB quota / write-failure notice
    ErrorBoundary.tsx      Top-level crash recovery screen
  extensions/
    WikiLink.ts            The [[wiki link]] editor feature
    Autolink.ts            Decorates first mentions of page titles as links
    Citation.ts            The citation marker editor feature
  index.css                The full theme (colors are CSS variables at the top)
```

</details>

---

## ⚠️ A note on backups

Because your lore lives in this browser under `localhost:5174`, clearing site data,
switching browsers, or opening a different address shows an empty database. So:

- **Always launch with `start-lore-codex.cmd`.**
- **Use Export backup regularly** — keep the JSON files somewhere safe (or in a private repo).
- **Back up each world you care about** — every world is a separate database.

Import is safe by design: it validates the file, shows exactly what you're replacing,
downloads a recovery backup of the current state first, and only then applies the import.

---

## 📄 License

Released under the [GNU GPL v3](LICENSE.md).
