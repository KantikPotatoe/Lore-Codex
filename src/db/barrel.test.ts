import { describe, it, expect } from 'vitest'
import * as db from '../db'

// `db.ts` was split into focused modules under `src/db/` behind this barrel.
// Dozens of call sites import their data-layer API from `'../db'` / `'./db'`,
// so the barrel must keep re-exporting the full public surface. This test pins
// that surface: if a future edit drops an `export *` line (or renames/removes a
// public helper) the missing symbol fails here instead of breaking a route at
// runtime. Types are erased at runtime and can't be checked this way — the build
// (tsc) is what guards the type re-exports.
//
// Grouped by the module each name now lives in, so a failure points at the
// submodule whose re-export went missing.
const EXPECTED_FUNCTIONS = [
  // schema.ts
  'categoryColor', 'statusColor', 'pageStatus', 'getMeta', 'setMeta', 'uid', 'now',
  // templates.ts
  'seedTemplates', 'getTemplates', 'defaultInfobox', 'applyTemplate',
  'parseRefTitles', 'serializeRefTitles', 'createTemplate', 'updateTemplate',
  'deleteTemplate', 'resetTemplate', 'pagesUsingTemplate', 'applyTemplateToPages',
  // pages.ts
  'createPage', 'updatePage', 'deletePage', 'findPageIdByTitle', 'renamePage',
  'linkedTitles', 'getBacklinks',
  // maps.ts
  'addMap', 'deleteMap', 'addPin', 'pinType', 'addRegion', 'regionStyle',
  'findParentMapId', 'mapBreadcrumb', 'ancestorMapIds',
  // images.ts
  'addImage', 'updateImageCaption', 'deleteImage', 'reorderImages', 'setAsPortrait',
  // graph.ts
  'buildGraphData',
  // calendar.ts
  'seedDefaultCalendar', 'createCalendar', 'updateCalendar', 'deleteCalendar',
  'addEvent', 'updateEvent', 'deleteEvent',
  // backup.ts
  'parseBackup', 'exportAll', 'importAll', 'migrateBackup',
  // snapshots.ts
  'saveSnapshot', 'getSnapshots', 'deleteSnapshot',
] as const

describe('db barrel', () => {
  it.each(EXPECTED_FUNCTIONS)('re-exports %s as a function', (name) => {
    expect(typeof (db as Record<string, unknown>)[name]).toBe('function')
  })

  it('re-exports the db singleton (a Dexie instance)', () => {
    expect(db.db).toBeDefined()
    expect(typeof db.db.transaction).toBe('function')
    expect(db.db.pages).toBeDefined()
  })

  it('re-exports the LoreDB class', () => {
    expect(typeof db.LoreDB).toBe('function')
    expect(db.db).toBeInstanceOf(db.LoreDB)
  })

  it('re-exports the pageRepo / mapRepo seam', () => {
    expect(typeof db.pageRepo.get).toBe('function')
    expect(typeof db.pageRepo.create).toBe('function')
    expect(typeof db.mapRepo.listMaps).toBe('function')
    expect(typeof db.mapRepo.updatePin).toBe('function')
  })

  it('re-exports the category/status/template constants', () => {
    expect(Array.isArray(db.CATEGORIES)).toBe(true)
    expect(Array.isArray(db.STATUSES)).toBe(true)
    expect(Array.isArray(db.TYPE_COLORS)).toBe(true)
    expect(Array.isArray(db.BUILTIN_TEMPLATES)).toBe(true)
    expect(db.DEFAULT_CATEGORY).toBe('Character')
    expect(db.DEFAULT_STATUS).toBe('Draft')
    expect(typeof db.BUILTIN_ICONS).toBe('object')
    expect(typeof db.BUILTIN_SECTIONS).toBe('object')
    expect(typeof db.CURRENT_SCHEMA_VERSION).toBe('number')
  })
})
