# Lore Codex — Remaining Roadmap (not-yet-implemented)

**Status:** living document · **Compiled:** 2026-06-28

A consolidated, de-duplicated list of every idea across the other roadmap docs
that has **not** shipped yet. Items already delivered have been dropped (see
[What's already done](#whats-already-done-excluded) at the bottom for the audit trail).

**Effort key:** 🟢 small (hours) · 🟡 medium (a day or few) · 🔴 large (multi-session feature)
**Status key:** `parked` = deliberately deferred · `blocked` = waiting on the desktop-app move

Sources: `roadmap.md`, `graph-improvement-ideas.md`, `map-roadmap.md`,
`futureproofing-roadmap.md`, `Misc/lore-codex-feature-roadmap.md`, `Misc/Improvements_Temp1.md`.

---

## Suggested sequencing

1. **Quick wins** → graph quality-of-life (ghost nodes, drag-to-pin, persist view state).
2. **Documents arc** → Linked documents → Manuscripts → outlining/plotlines (the
   biggest untouched product area; closes the gap with Campfire/World Anvil).
3. **Reader-facing gating** → Spoilers → Secrets/reader-advancement (do in order).
4. **Desktop transition** → phased per `desktop-transition-investigation.md`:
   pre-work (meta in backups, v12) + Phase 0 (Tauri shell, platform seam,
   self-hosted fonts) have shipped; Phase 1 (native open/import dialogs,
   first-run migration wizard, CSP, print fix) is next.

---

## Pages & wiki text

### Documents / codex features
> A **Document** page type already exists (`builtin-document`); these make documents
> richer rather than adding the primitive.
- 🟡 **Linked documents on pages** — attach/relate documents to a page. _roadmap #7._
- 🔴 `parked` **Manuscripts** — in-world books / long-form documents. _roadmap #34._
- 🟢 **Outlining with story structures** — Hero's Journey, Save the Cat, Snowflake as
  template starter bodies (just templates/sections). _feature-roadmap Phase 3._
- 🟡 **Multiple plotlines / arcs tracking.** _feature-roadmap Phase 3._
- 🟡 **Link manuscript text to worldbuilding entries** (depends on Manuscripts). _Phase 3._
- 🟡 **Export to EPUB / PDF** (depends on Manuscripts). _Phase 3._

### Structure / navigation
- 🟡 **Hierarchical tree / folders / nested categories** — the sidebar groups by a
  flat category today; true folder nesting / a page tree is not implemented.
  _feature-roadmap Phase 1._
- 🟢→🟡 **Infobox updates in real time** — suspected local edit-state staleness bug
  (reads already go through `useLiveQuery`). Needs a repro to confirm it still occurs.
  _roadmap (verify before scheduling)._

---

## Maps
- 🔴 `blocked` **Map resolution** — quality is capped by browser-storage compression;
  unblocks at desktop-transition **Phase 3a** (assets stored as real files instead of
  data-URLs in IndexedDB — see `desktop-transition-investigation.md` §9). _roadmap #13._

> Map phases 1–4 (typed pins, wiki integration, regions, management), pins-inside-regions,
> and preview-before-edit have all shipped.

---

## Graph

> The first slice (node search + focus/ego mode + hubs/orphans panel) has shipped. The
> graph may be reworked wholesale, so treat these as inputs to that rework.

### Navigation & interaction
- 🟡 **Pin / drag nodes** — drag a node and have it stay put (`fx`/`fy`); the layout
  currently reshuffles every visit.
- 🟡 **Persist view state** — remember zoom/pan, hidden categories, selected tag across
  visits, as a `meta` row (same pattern as `home-config`).

### Visual encoding & readability
- 🟡 **Color by status or tag, not just type** — toggle node colour between page type,
  status, or a chosen tag; a "status" view instantly shows unfinished corners.
- 🟡 **Curved + bundled links and collision force** — reduce hairball overlap past a few
  hundred nodes.
- 🟡 **Show broken / missing links as ghost nodes** — surface `[[links]]` to non-existent
  pages as dashed-outline nodes (a built-in worldbuilding to-do list).
- 🟢 **Distinguish reciprocity** — style mutual links (A↔B) differently from one-way.
- 🟡 `parked` **Infobox image inside nodes** — render the page's infobox image in its
  circle for recognizability. _roadmap #19._

### Insight & analysis
- 🟡 **Connected-components / "islands" detection** — highlight disconnected subgraphs.
- 🟡 **Shortest path between two pages** — pick two nodes, highlight the connecting chain.
- 🟡 **Mini-map / overview** for large graphs.

### Filtering
- 🟡 **Multi-tag filtering with AND/OR** (replaces the single-tag dropdown).
- 🟡 **Degree / depth slider** — hide weakly-connected nodes, or show only N hops from a focus.
- 🟢 **Filter by status** alongside type and tag.

### New graph features
- 🟡 **Timeline / chronology axis** — lay the graph left-to-right by in-world date.
- 🟡 **Export the graph** as PNG/SVG.
- 🟢 **3D toggle** via `react-force-graph-3d` (more wow than utility, cheap).
- 🔴 `parked` **Graph rework** — broader redesign. _roadmap #20._

---

## Relationships (beyond the graph)
- 🔴 **Family trees** — dedicated genealogy view. _roadmap #32 · feature-roadmap Phase 3._
- 🔴 **Diplomacy webs** — relationship/diplomacy graphs between factions. _roadmap #33._

---

## Reader-facing / spoiler controls
- 🔴 **Spoilers** — hide spoiler info (e.g. a character's alive/dead Status) until
  revealed. _roadmap #30._
- 🔴 **Secrets / reader-advancement gating** — show different info depending on how far a
  reader has progressed through the books (depends on Spoilers). _roadmap #31, "much later."_

---

## Creative / freeform
- 🔴 `parked` **Infinite whiteboard / freeform canvas.** _feature-roadmap Phase 3._

---

## Architecture & futureproofing

> Futureproofing Tiers 1–3 (strict TS, Vitest, CI, db split, versioned exports, incremental
> search, ErrorBoundary + quota surfacing, import sanitization) have all shipped. So have the
> desktop-prep items: repository seam (`pageRepo`/`mapRepo`, #140), routes-to-hooks
> (`usePage` + `useWikiLinkNavigation`, #141), and **desktop Phase 0** (Tauri v2 shell,
> `src/platform.ts` save seam, self-hosted fonts, #163) plus its pre-work (portable `meta`
> in backups, schema v12, #162).

- 🔴 **Desktop transition, remaining phases** — the plan lives in
  `desktop-transition-investigation.md` (§9). Next: **Phase 1** (native open/import dialogs,
  first-run migration wizard from Firefox backups, CSP, `alert`/`confirm` → `ConfirmDialog`,
  print fix, release workflow) → **Phase 2** (auto-mirrored per-world `.lore` files on disk)
  → optional **Phase 3a** (assets to real files; unblocks "Map resolution") / **3b** (SQLite,
  only if still needed after 3a).
- 🟡 **Finish the repository sweep** — templates/manuscript/calendar/meta still use raw
  `db.*` in ~15 UI files; only needed if desktop **Phase 3b** (storage swap) ever happens —
  don't do it speculatively.
- 🔴 `parked` **Git-style version history** beyond snapshots. _feature-roadmap Phase 3._

### Residual test coverage (from futureproofing #2)
- 🟢 Add tests for `renamePage()` reference-rewriting, `getBacklinks()`/`linkedTitles()`,
  `buildGraphData()`, `html.ts`, and `search.ts` — the Dexie-touching helpers deferred when
  the harness first landed. Verify which already exist before re-adding.

---

## What's already done (excluded)

Dropped from this list because they've shipped — recorded so the audit is reproducible:

- **Wiki/pages:** clickable tags + sidebar Tags group, alias/flavor links
  (`[[Target|shown]]`), `@` as a second link trigger, autolinker, citations in pages,
  optional default sections, TOC includes H1, default-infobox-fields rework, typed
  infobox fields, hover previews, backlinks, auto-create-on-link.
- **Maps:** typed pins, wiki integration ("show on map" + hover), regions (polygons),
  nested maps + management, pins-inside-regions, preview-before-edit.
- **Timeline:** custom calendars + events, axis-view readability pass.
- **Graph:** node search + focus/ego mode + hubs/orphans panel.
- **Platform:** snapshots, HTML export, image gallery, per-lore settings, multiple worlds.
- **Futureproofing:** strict TS, Vitest harness + CI, `db.ts` split into `src/db/` barrel,
  versioned exports + migration ladder, incremental search index, ErrorBoundary + quota
  surfacing, HTML sanitization on import.
- **Entry types:** the built-in set is already broad (Character, Country, Deity, Geography,
  Item, Organization, Religion, Species, Settlement, Condition, Conflict, Document, Culture,
  Language, Material, Myth, Technology, Tradition, Spell) — so "more entry types" from the
  feature-roadmap is effectively satisfied.
</content>
</invoke>
