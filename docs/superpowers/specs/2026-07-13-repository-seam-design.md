# Repository seam — finish the UI sweep, enforce it, and correct the premise

**Issue:** #186 (`[Audit A1] Extend the storage-agnostic repository seam beyond pages+maps`)
**Status:** approved, ready to plan
**Written:** 2026-07-13

---

## 1. Why the issue as filed is half-wrong

#186 (from the v0.23.0 audit) justifies the sweep with portability:

> **Impact:** The planned storage swap (`docs/desktop-transition-investigation.md`, #142) still means touching every module.

That claim does not survive contact with the code, and `desktop-transition-investigation.md` — written *after* the audit — already says so:

- **Phase 2 (#174), the auto-mirrored per-world `.lore` files, needs zero repository work.** It mirrors each world to disk via `exportAll()`. It does not care how the UI reads tables. This is the item the issue calls "the single most important durability item," and the seam is irrelevant to it.
- The sweep is a prerequisite only for **Phase 3b** (records to SQLite), which that doc rates **XL**, describes as the one step that "would feel like a rewrite," and gates behind *"only if 3a leaves a real problem standing — likely it won't."*
- The decisive line (§4.1): *"Any storage backend that isn't Dexie must bring its own invalidation story for all [77] sites. **No repository interface written so far reduces it.**"*

Verified against `main` at v0.36.0: **77 `useLiveQuery` calls across 33 files, plus 5 raw `liveQuery` subscriptions.** *That* reactivity, not table access, is what welds the app to Dexie. Finishing the repository sweep moves the storage swap zero distance.

**So the surviving justification is drift, not portability.** The audit's own second point is the real one: the codebase has two idioms for reaching the data layer, and the wrong one is currently the majority — so new code copies it. The proof is already in the tree: `SearchModal.tsx:43` calls `db.pages.toArray()` even though `pageRepo.list()` has existed since the seam was introduced.

This spec therefore scopes #186 as **consistency plus a guardrail**, and explicitly corrects the record so the stale premise is not re-derived later.

## 2. The boundary

Three tiers, stated explicitly (today it is implicit and half-built):

| Tier | Files | May import `db`? |
|---|---|---|
| **UI** | `src/components/**`, `src/routes/**`, hooks (`usePage.ts`) | No — repositories only |
| **Infra** | `backup.ts`, `searchSync.ts`, `snapshots.ts`, `htmlExport.ts`, `manuscriptExport.ts` | **Yes**, permanently and by design |
| **Data layer** | `src/db/**` | Yes — it owns `db` |

Tests are exempt; they need `db.*` for fixture setup.

The infra tier is a deliberate allowlist, not an oversight. Those five modules do whole-DB, cross-table, transactional work (`exportAll`, the search-index sync, snapshot capture, the two exporters). A per-table repository serves them *worse*, not better: it would force us to invent a bulk/transaction escape hatch and then hand it straight back, reintroducing the leak under a nicer name. Recording this as intentional is part of the deliverable — an unexplained exception is how the next drift starts.

## 3. Scope: 34 UI-tier sites across 19 files

### 3.1 Three new repositories

Grouped by **domain**, following the `mapRepo` precedent (which already covers maps + pins + regions in one repo) rather than one-repo-per-table.

| Repo | Tables | Callers |
|---|---|---|
| `templateRepo` | `templates` | `Infobox`, `Sidebar`, `usePage`, `CategoryRoute`, `MapRoute`, `TemplatesRoute` |
| `calendarRepo` | `calendars`, `events` | `CalendarEditor`, `PageHistory`, `TimelineRoute`, `HomeRoute` |
| `manuscriptRepo` | `books`, `chapters`, `scenes`, `plotlines`, `beats` | `BinderTree`, `BookGridView`, `BookWriteView`, `StructureControls`, `BookRoute`, `ManuscriptRoute` |

The repos stay **thin**. CRUD already exists in `db/templates.ts`, `db/calendar.ts`, `db/manuscript.ts`. Each repo adds the *read* methods the `useLiveQuery` call sites need and delegates mutations to those existing functions — the exact construction `pageRepo` already uses.

All three must be re-exported from the barrel `src/db/index.ts` (`barrel.test.ts` fails otherwise).

### 3.2 Two sites that are not repo-shaped

- **`SettingsRoute.loadCounts()`** (`SettingsRoute.tsx:98–110`) counts all 14 tables inline. That is infra that leaked into a route, not a UI read; turning it into 14 repo calls would be worse than leaving it. It moves wholesale into `src/db/backup.ts` as `countAll(): Promise<BackupCounts>`, sitting next to the `BackupCounts` type that module already owns. The route then calls one function.
- **`db.meta.get(LAST_BACKUP_KEY)`** in `BackupBanner.tsx:21` and `SettingsRoute.tsx:46` → the existing `getMeta()` from `db/schema.ts`. No new repo.

### 3.3 One pure-drift fix

`SearchModal.tsx:43` → `pageRepo.list()`.

## 4. The guardrail

Default-deny via `no-restricted-imports`, mirroring the platform seam that already works in this repo.

**The rule must be layered, never `'off'`.** The naive carve-out — `'no-restricted-imports': 'off'` for the infra files, as the existing `platform.ts` block does — would also disable the `@tauri-apps/*` ban inside `backup.ts`, `htmlExport.ts` and `manuscriptExport.ts`. Those three already import `./platform` and are precisely the files most likely to reach for a Tauri API directly. Plugging the db seam must not hole the platform seam. Each tier therefore re-declares the bans it still wants:

| Tier | `db` banned | `@tauri-apps/*` banned |
|---|---|---|
| default (UI) | yes | yes |
| `platform.ts`, `platform.test.ts` | yes | **no** — it *is* the platform seam |
| `src/db/**` + the 5 infra files | **no** — data layer / whole-DB work | yes |
| `**/*.test.{ts,tsx}` | no | no |

The ban covers the named `db` import from the barrel **and** a direct `**/db/schema` import, so the singleton cannot be grabbed one level down to walk around the rule. Nothing does that today (verified); this keeps it that way.

ESLint is **10.5.0**, so `patterns` with `importNames` is supported — use it rather than enumerating `'./db'` / `'../db'` / `'../../db'` as literal `paths`, which would silently miss any future directory depth.

## 5. Testing & verification

- Extend `src/db/repositories.test.ts` with the three new repos: reads return what the tables hold; mutations delegate to the underlying CRUD.
- `barrel.test.ts` enforces the re-exports.
- **The guardrail must be shown to bite.** A passing lint run proves nothing on its own. Verify by adding a deliberate `import { db } from '../db'` to a component, confirming `npm run lint` *fails* on it, then reverting. This is the acceptance test for the whole change.
- `npm run lint`, `npm run build`, `npm run test:run` all green (CI runs all three).

**Reactivity risk — low.** `useLiveQuery(() => templateRepo.list())` stays reactive: Dexie tracks reads globally on the `db` instance regardless of how deep in the call stack they happen. `repositories.ts:11–14` documents this, and pages + maps already rely on it in production. The existing component tests cover the migrated live-query sites.

## 6. The honesty fix

Non-optional, and the part that stops this recurring:

- **`src/db/repositories.ts` header** — currently claims the seam exists because direct `db` access "blocks the planned Electron / on-disk-JSON move (#142)". Rewrite: the seam exists so there is **one idiom**, enforced by lint. Record that portability is gated on **reactivity** (77 `useLiveQuery` sites), which no repository interface reduces, and point at `desktop-transition-investigation.md` §4.1. Replace the stale "Scope: pages + maps… follow-up sweep" note with the three-tier boundary and the reason infra is exempt.
- **`CLAUDE.md`** — document the tiers and the new lint rule alongside the existing platform-seam rule.
- **Issue #186** — comment recording that the portability premise was stale, and what was actually done instead.

## 7. Non-goals

- No change-bus, no `useRepoQuery`, no touching the 77 `useLiveQuery` sites. That is the real portability prerequisite and it is deliberately out of scope (see §1).
- No repositories for tables that do not leak — `images`, `snapshots` (`SettingsRoute` already goes through `snapshots.ts`).
- No infra rewrite. The five infra modules keep raw `db` and that is the intended end state, not a follow-up.
- No behaviour change. This is a refactor; the app should be pixel- and byte-identical afterward.
