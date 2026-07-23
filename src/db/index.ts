// Barrel for the data layer.
//
// `db.ts` used to be a single ~1,100-line god-module that everything imported.
// It's now split into focused modules under `src/db/`, but this barrel re-exports
// the entire public surface so every call site keeps importing from `'../db'` /
// `'./db'` unchanged. Add new data concerns to the appropriate module and, if it
// introduces public API, make sure it's re-exported here.
//
//   types.ts      — the data-model interfaces (no runtime code)
//   schema.ts     — LoreDB class, version ladder, the `db` singleton, meta,
//                   categories/statuses, shared uid()/now() helpers
//   templates.ts  — page types: built-ins, seeding, infobox/template helpers, CRUD
//   pages.ts      — page CRUD, rename + link-rewrite, backlinks
//   maps.ts       — maps, pins & regions CRUD, pin/region type resolution
//   images.ts     — per-page gallery CRUD, portrait assignment
//   docLinks.ts   — curated document attachments (page ↔ document join)
//   relationshipTypes.ts — the user-definable relationship vocabulary (#175)
//   relationships.ts — typed directed edges between pages (#175)
//   manuscript.ts — books/chapters/scenes/plotlines/beats CRUD, word count
//   graph.ts      — relationship-graph builder
//   calendar.ts   — timeline calendar/event CRUD (cached absolute-day upkeep)
//   backup.ts     — exportAll / importAll / parseBackup
//   snapshots.ts  — automatic local version history
//   repositories  — pageRepo / mapRepo / templateRepo / calendarRepo /
//                   manuscriptRepo: the UI's one lint-enforced idiom for
//                   reaching data (not a portability layer — see its header)

export * from './types'
export * from './schema'
export * from './templates'
export * from './pages'
export * from './maps'
export * from './images'
export * from './bodyImageMigration'
export * from './docLinks'
export * from './relationshipTypes'
export * from './relationships'
export * from './manuscript'
export * from './graph'
export * from './worldHealth'
export * from './calendar'
export * from './backup'
export * from './snapshots'
export * from './repositories'
