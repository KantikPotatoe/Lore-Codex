---
paths:
  - src/db/manuscript.ts
  - src/manuscript*.ts
  - src/components/manuscript/**
  - src/routes/BookRoute.tsx
  - src/routes/ManuscriptRoute.tsx
---

# Manuscript authoring — `src/db/manuscript.ts` + `ManuscriptRoute`/`BookRoute`

The author's real novel, distinct from wiki pages and the in-world Document page type. Per-lore, id-based tables (Dexie stores added in **v11**), all cascade on delete: `Book`→`Chapter`→`Scene` (rich-text `content`, cached `wordCount` recomputed on `updateScene`, `SceneStatus` = Outline→Draft→Revised→Done via `SCENE_STATUSES`, separate from page `STATUSES`). Scenes carry POV/cast/location **page refs** (id-based) → `sceneAppearances(pageId)` lists every scene referencing a page (by ref or inline `[[wiki-link]]`), surfaced on the page. A **Plottr-style grid** of `Plotline` lanes × `Beat` cells (`kind:'plot'`); a `kind:'structure'` lane holds a built-in story structure (`manuscriptStructures.ts`: Save the Cat / Hero's Journey / Snowflake) whose beats align to scenes — deleting an aligned scene reverts its structure beat to unplaced (`sceneId=null`) rather than deleting it (`detachBeatsForScene`). `ManuscriptRoute` = book library; `BookRoute` = workspace with **Write** (`BookWriteView`: `BinderTree` + `SceneEditor` + `SceneMetaPanel`) and **Grid** (`BookGridView` + `StructureControls`) views, plus EPUB / Print-PDF compile buttons. **Export (`src/manuscriptExport.ts`):** pure `buildEpub()` (path→content map, valid EPUB 3 with nav, `mimetype` stored first) + `compileBookHtml()` (self-contained print/Save-as-PDF doc); `exportBookEpub()`/`printBook()` are the DB+download/print wrappers. Manuscript tables are **included in backups** (`exportAll`/`importAll`, scene `content` sanitized on import).
