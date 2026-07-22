<div align="center">

# 📜 Lore Codex

**A local-first worldbuilding wiki that lives entirely on your machine.**

Write, link, and map the lore of your fictional worlds — then write the novel beside it.
No account, no server, no network. Your world never leaves your computer.

[![Version](https://img.shields.io/github/package-json/v/KantikPotatoe/Lore-Codex?style=flat-square&color=c9a24b&label=version)](https://github.com/KantikPotatoe/Lore-Codex/releases)
[![Download](https://img.shields.io/badge/Download-Windows%20installer-c9a24b.svg?style=flat-square)](https://github.com/KantikPotatoe/Lore-Codex/releases/latest)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-c9a24b.svg?style=flat-square)](LICENSE.md)
![React](https://img.shields.io/badge/React-19-1d1a14.svg?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-1d1a14.svg?style=flat-square&logo=typescript)
![Tauri](https://img.shields.io/badge/Tauri-v2-1d1a14.svg?style=flat-square&logo=tauri)

</div>

---

## 🚀 Getting started

**[⬇ Download the latest installer →](https://github.com/KantikPotatoe/Lore-Codex/releases/latest)**

Run `Lore.Codex_x64-setup.exe` and you're done — no Node, no terminal, no account,
no sign-up. The app checks for new versions on its own and offers to install them.

> **Windows only, for now.** The installer targets Windows 11/10 (x64) and rides the
> preinstalled WebView2 runtime, which is why it's a ~5 MB download rather than ~100 MB.

---

## ✨ Why Lore Codex

Everything you write stays on your computer. There is no sign-up, no cloud, and no
network round-trip — the app's *only* outbound request is the update check, and you can
turn that off in Settings, after which Lore Codex never reaches the network on its own.
It works on a plane.

Each world is its own isolated database, so you can keep a dozen settings going at once
without them bleeding together — and each one is automatically mirrored to a plain
`.lore` file on disk, so your work survives things that used to be fatal.

---

## 🌟 Features

### ✍️ Writing & linking

| | |
|---|---|
| **Rich-text pages** | Articles for characters, places, factions, items, events, and more — with headings, inline images, and editable tables for stat blocks. |
| **Wiki links** | Type `[[Page Name]]` to link pages. Renaming a page rewrites every reference automatically; broken links are flagged. |
| **Autolinker** | The first mention of any page's title in your prose links itself automatically — no `[[brackets]]` needed. Toggle it off in Settings. |
| **Citations** | Mark a claim with an in-world source — another page or free text, with an optional locator and quote — and a numbered References list builds itself at the foot of the page. |
| **Hover previews** | Hover a `[[wiki link]]` to peek at the linked page's category, title, and summary in a floating card. |
| **Backlinks & TOC** | Every page shows what links to it, plus an auto-generated table of contents from its headings. |
| **Page history** | Every timeline event that touches a page — whether it names the page directly or just mentions it — collected into one chronology in the page's sidebar. |
| **Linked documents** | Attach a curated, drag-ordered shelf of in-world Documents to any page. |
| **Spellcheck** | On by default, with a dictionary language you can pin per device. |

### 🗂️ Organizing

| | |
|---|---|
| **Multiple worlds** | Fully isolated worlds you can create, rename, banner, delete, and switch between — each its own local database and its own file on disk. |
| **Page types & templates** | Colour-coded categories with starter infobox rows and optional starter body sections you can drop into a page in one click. Use the built-ins or define your own; switching a page's type keeps the values you filled in. |
| **Tags** | Tag pages freely and open a tag to see every page that shares it. |
| **Infoboxes** | A per-page sidebar card with image, caption, and typed fields — text, numbers, and `[[reference]]` links — grouped under separator headings. |
| **Image galleries** | Attach a grid of images to a page, view them in a lightbox, reorder them, and promote any one to the page's portrait. |

### 🗺️ Visualizing your world

| | |
|---|---|
| **Interactive maps** | Upload a map image and drop pins linked to lore pages. Draw regions as polygons and nest maps inside one another. |
| **Relationship graph** | A force-directed graph of every page and the links between them, in **2D or 3D** — node size shows how connected a page is, surfacing hubs and isolated pages. Filter by category or by a set of tags, and export the view as an SVG or PNG. |
| **Shortest path** | Pick any two pages and the graph highlights the chain of links connecting them — or tells you whether they're genuinely unconnected or just hidden by your current filters. |
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
| **Rediscovery** | Home resurfaces pages you haven't touched in a while and features a different event each day; the sidebar has a "random page" jump. Nudges back into the corners of your own world. |

### 💾 Data & safety

| | |
|---|---|
| **Automatic disk mirror** | Every world is written to `<app-data>/worlds/<id>.lore` as you work, and always on exit. Writes are atomic — a crash or power cut can never leave a half-written file where a good one was. |
| **Recovery on launch** | If the app's internal storage is ever wiped, the next launch finds the `.lore` files still on disk and offers to restore them. Nothing is written without your click. |
| **Backup & restore** | Export everything to a JSON file and re-import anytime, through a real Save/Open dialog. Import validates the file, shows what it'll replace, writes a recovery backup first, and migrates older backups forward. |
| **Backup on exit** | Optionally drop a dated backup into app data every time you close, rotating by weekday to keep a week of history. |
| **Auto-snapshots** | Local snapshots saved automatically (after ~50 changes or 24h of activity); restore any from Settings. |
| **Export as HTML** | Download a self-contained ZIP of your wiki as a browsable static site — index by category, one page per article, with infoboxes, images, citations, and resolved links. |
| **Overdue nudges** | Home and the top banner track edits since your last *exported* backup and turn red when one is overdue. The disk mirror deliberately doesn't silence them — see [below](#-a-note-on-backups). |
| **Crash recovery** | If the app ever crashes, the recovery screen's first offer is to download a backup before anything else. |

### ⚙️ Settings

Per-world: snapshot frequency and retention, the backup-overdue window, and the autolinker.
Per-device: reopen the last world on launch, spellcheck and its language, backup-on-exit and
where it lands, and whether to check for updates automatically. Device settings live outside
your worlds, so they can never travel inside a backup.

---

## ⚠️ A note on backups

Lore Codex now keeps a `.lore` mirror of every world on disk, which makes it far harder to
lose work than it used to be. But **a mirror is not a backup**, and the distinction matters:

- The mirror lives in app data **on this machine**. A dead drive, a lost laptop, or a
  ransomware hit takes the mirror with the app.
- The mirror is *currency* — it holds the latest state, not history. If you delete a page
  and only notice a week later, the mirror agrees the page is gone. Snapshots and dated
  exit backups are what hold history.

So the advice stands, for the reason it always did:

- **Use Export backup regularly** — keep the JSON files somewhere off this machine
  (a private repo, a synced folder, an external drive).
- **Back up each world you care about** — every world is a separate database and a
  separate export.

This is also why the backup-overdue banner ignores the mirror entirely. Silencing a
"back up your world" reminder because a copy exists *on the same disk* would be a lie.

Import is safe by design: it validates the file, shows exactly what you're replacing,
writes a recovery backup of the current state first, and only then applies the import.

---

## 🧰 Tech stack

| Area | Built with |
|---|---|
| **Framework** | React 19 · TypeScript (strict) · Vite |
| **Desktop shell** | Tauri v2 (WebView2) — dialog, fs, and updater plugins; the Rust side is config-only |
| **Editor** | Tiptap |
| **Maps** | Leaflet + leaflet-draw |
| **Graph** | react-force-graph-2d / -3d |
| **Storage** | Dexie (IndexedDB), mirrored to `.lore` files on disk |
| **Search** | FlexSearch |
| **Safety** | DOMPurify (sanitization) · JSZip (HTML + EPUB export) |
| **Testing** | Vitest · happy-dom · fake-indexeddb |

---

## 🗃️ Project structure

<details>
<summary><b>Where things live</b></summary>

```
src/
  db/                  The data layer and single source of truth, reached only
                       through its barrel index.ts — schema and version ladder,
                       CRUD per domain (pages, maps, calendar, manuscript,
                       images, snapshots), graph building, world-health
                       analysis, and versioned backup export/import.
                       repositories.ts is the seam the UI reads through; no
                       component touches the database directly.
  routes/              One component per hash route — the world picker, home,
                       page view/edit, category and tag grids, map, graph,
                       timeline, manuscript library, book workspace, page
                       types, settings, world health.
  components/          Shared UI, plus a manuscript/ subtree for the binder,
                       scene editor, and plotline grid.
  extensions/          Tiptap editor features: [[wiki links]], the autolinker's
                       decorations, citations, body images.
  platform.ts          The ONLY file allowed to touch Tauri APIs or trigger a
                       download — save/open dialogs, app-data writes, printing,
                       the updater handle, and the window-close hook. Every
                       function has a browser fallback, so the web build works.
  worldMirror*.ts      The per-world .lore disk mirror: pure cadence policy,
  worldIndex.ts        the poll/flush loop, the on-disk world index, and the
  worldRecovery.ts     restore-on-launch flow.
  calendar.ts          Pure date math — the shared absolute-day axis that lets
                       several in-world calendars line up on one timeline.
  search.ts            FlexSearch index + incremental sync.
  *.ts                 Small pure modules beside their feature (autolink,
                       citations, tags, toc, sanitize, storageError, …) and
                       use*.ts hooks. Pure logic is kept out of components so
                       it can be unit-tested without a DOM or a database.

src-tauri/             The desktop shell: Tauri config, capability ACL
                       (deliberately minimal), and config-only Rust.
```

For a far more detailed architecture map — including the reasoning behind the
data layer, the repository seam, and the mirror — see [`CLAUDE.md`](CLAUDE.md).

</details>

---

## 🛠️ Developing

<details>
<summary><b>Running from source</b></summary>

You need [Node.js](https://nodejs.org), plus a [Rust toolchain](https://rustup.rs) for the
desktop shell.

```bash
npm install          # first time only

npm run dev          # web app w/ hot reload → http://localhost:5174
npm run tauri dev    # desktop shell w/ hot reload

npm run build        # type-check + production build → dist/
npm run lint         # ESLint
npm run test:run     # run the test suite once (Vitest)
npm run tauri build  # desktop installer → src-tauri/target/release/bundle/
```

> **The port is pinned to 5174 on purpose.** Browser storage is keyed to the exact
> address, so a drifting port shows an empty database that looks exactly like lost data.
> It's set in `vite.config.ts`, `start-lore-codex.cmd`, and `src-tauri/tauri.conf.json` —
> change it in all three or none.

The web build is how the app is developed, and it keeps working: every native capability
sits behind `platform.ts` with a browser fallback. But the desktop build is the one that
gets you the disk mirror, real file dialogs, and updates — it's how the app is meant to
be run.

</details>

---

## 📄 License

Released under the [GNU GPL v3](LICENSE.md).
