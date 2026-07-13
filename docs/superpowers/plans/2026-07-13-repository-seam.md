# Repository Seam Sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the UI tier exactly one idiom for reaching the data layer — repositories — and enforce it with a lint rule, so the two-idiom drift that produced this issue cannot recur.

**Architecture:** Three new domain repositories (`templateRepo`, `calendarRepo`, `manuscriptRepo`) join the existing `pageRepo`/`mapRepo` in `src/db/repositories.ts`. All 34 UI-tier `db.*` call sites move behind them (or, for two infra-shaped sites, into the data layer). A layered `no-restricted-imports` rule then bans the `db` singleton from everything except `src/db/**`, five named infra modules, and tests.

**Tech Stack:** TypeScript (strict), React, Dexie + dexie-react-hooks (`useLiveQuery`), Vitest + happy-dom + fake-indexeddb, ESLint 10.5.0.

**Spec:** `docs/superpowers/specs/2026-07-13-repository-seam-design.md`
**Issue:** #186

## Global Constraints

- **No behaviour change.** This is a refactor. Every repo method must mirror the *current* query exactly — same table, same ordering, same fallback. Two known traps, both handled below: `getTemplates()` falls back to `BUILTIN_TEMPLATES` on an empty table (so UI reads must NOT use it), and `listScenes()` is chapter-scoped where every UI caller wants book-scoped.
- **Reactivity must survive.** All migrated reads stay inside `useLiveQuery`. This is safe because Dexie tracks reads globally on the `db` instance regardless of call depth (`repositories.ts:11–14`); `pageRepo`/`mapRepo` already prove it in production. Never lift a read out of `useLiveQuery` while moving it.
- **Barrel discipline.** Every new public export must be re-exported from `src/db/index.ts` or `src/db/barrel.test.ts` fails.
- **The infra tier keeps raw `db`, on purpose.** `src/backup.ts`, `src/searchSync.ts`, `src/snapshots.ts`, `src/htmlExport.ts`, `src/manuscriptExport.ts`. Do not sweep these. They do whole-DB, cross-table work.
- **Never write `'no-restricted-imports': 'off'`** in a carve-out. `backup.ts`, `htmlExport.ts` and `manuscriptExport.ts` import `./platform` and must keep their `@tauri-apps/*` ban. Carve-outs re-declare the bans they still want.
- **Stable empty-array identities.** Several components use module-level `const NO_X: T[] = []` fallbacks so `useMemo` deps don't churn. Preserve them exactly; do not inline `?? []` where a named constant exists.
- Run `npm run lint`, `npm run build`, `npm run test:run` before claiming any task done. CI runs all three.

---

### Task 1: `templateRepo` + its six call sites

**Files:**
- Modify: `src/db/repositories.ts` (append a Templates section)
- Modify: `src/db/index.ts` (already `export * from './repositories'` — verify, no edit expected)
- Test: `src/db/repositories.test.ts`
- Sweep: `src/components/Infobox.tsx:34`, `src/components/Sidebar.tsx:36`, `src/usePage.ts:29`, `src/routes/CategoryRoute.tsx:14`, `src/routes/MapRoute.tsx:75`, `src/routes/TemplatesRoute.tsx:18`

**Interfaces:**
- Consumes: `db` from `./schema`; `createTemplate`, `updateTemplate`, `deleteTemplate`, `resetTemplate` from `./templates`; `InfoboxTemplate` from `./types`.
- Produces: `templateRepo: TemplateRepository` with `list()`, `listByName()`, `create()`, `update()`, `remove()`, `reset()`.

Two orderings exist in the wild and both must be kept: `Infobox`/`TemplatesRoute`/`usePage` read `orderBy('name')`; `Sidebar`/`CategoryRoute`/`MapRoute` read `toArray()` (unordered). Do **not** collapse these into one method — that would be a behaviour change (and `Sidebar` groups by category, not name).

- [ ] **Step 1: Write the failing test**

Append to `src/db/repositories.test.ts`:

```ts
describe('templateRepo', () => {
  beforeEach(async () => {
    await db.templates.clear()
    await db.templates.bulkAdd([
      { id: 't2', name: 'Zebra', color: '#111', items: [] },
      { id: 't1', name: 'Aardvark', color: '#222', items: [] },
    ] as never)
  })

  it('list() returns every template', async () => {
    const all = await templateRepo.list()
    expect(all.map((t) => t.id).sort()).toEqual(['t1', 't2'])
  })

  it('listByName() orders by name', async () => {
    const all = await templateRepo.listByName()
    expect(all.map((t) => t.name)).toEqual(['Aardvark', 'Zebra'])
  })

  // The BUILTIN_TEMPLATES fallback in getTemplates() must NOT leak into the
  // repo: UI reads show what the table holds, nothing more.
  it('list() returns empty on an empty table (no builtin fallback)', async () => {
    await db.templates.clear()
    expect(await templateRepo.list()).toEqual([])
  })

  it('update() writes through', async () => {
    await templateRepo.update('t1', { color: '#abc' })
    expect((await db.templates.get('t1'))?.color).toBe('#abc')
  })
})
```

Add `templateRepo` to the existing import from `'./repositories'` at the top of the file.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: FAIL — `templateRepo` is not exported (TypeScript/import error).

- [ ] **Step 3: Implement `templateRepo`**

Append to `src/db/repositories.ts`, and extend the existing `./templates` import:

```ts
// ---------------------------------------------------------------------------
// Page types (templates)
// ---------------------------------------------------------------------------

export interface TemplateRepository {
  /** Every page type, unordered — for callers that group by something else. */
  list(): Promise<InfoboxTemplate[]>
  /** Every page type, ordered by name — for pickers and the /templates list.
   *  Deliberately NOT `getTemplates()`: that falls back to BUILTIN_TEMPLATES on
   *  an empty table, which is seeding behaviour, not a UI read. */
  listByName(): Promise<InfoboxTemplate[]>
  create(name: string, color?: string): Promise<string>
  update(id: string, changes: Partial<InfoboxTemplate>): Promise<void>
  remove(id: string): Promise<void>
  /** Restore a built-in type to its shipped definition. */
  reset(id: string): Promise<void>
}

export const templateRepo: TemplateRepository = {
  list: () => db.templates.toArray(),
  listByName: () => db.templates.orderBy('name').toArray(),
  create: createTemplate,
  update: updateTemplate,
  remove: deleteTemplate,
  reset: resetTemplate,
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Sweep the six call sites**

Each is a one-line swap. Remove `db` from the `'../db'` import where it becomes unused (TypeScript will flag it via `noUnusedLocals`, and lint will too).

`src/components/Infobox.tsx:34`:
```ts
const templates = useLiveQuery(() => templateRepo.listByName(), []) ?? []
```

`src/components/Sidebar.tsx:36`:
```ts
const templates = useLiveQuery(() => templateRepo.list(), []) ?? []
```

`src/usePage.ts:29`:
```ts
const templates = useLiveQuery(() => templateRepo.listByName(), []) ?? NO_TEMPLATES
```

`src/routes/CategoryRoute.tsx:14`:
```ts
const templates = useLiveQuery(() => templateRepo.list(), []) ?? []
```

`src/routes/MapRoute.tsx:75`:
```ts
const templatesData = useLiveQuery(() => templateRepo.list(), [])
```

`src/routes/TemplatesRoute.tsx:18`:
```ts
const templates = useLiveQuery(() => templateRepo.listByName(), [])
```

- [ ] **Step 6: Verify nothing regressed**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all green. `Infobox.test.tsx`, `Sidebar.test.tsx`, `TemplatesRoute.test.tsx` and `MapRoute.test.tsx` exercise these reads — they must still pass, which is the reactivity proof.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories.ts src/db/repositories.test.ts src/components/Infobox.tsx src/components/Sidebar.tsx src/usePage.ts src/routes/CategoryRoute.tsx src/routes/MapRoute.tsx src/routes/TemplatesRoute.tsx
git commit -m "refactor: put page-type reads behind templateRepo (#186)"
```

---

### Task 2: `calendarRepo` + its four call sites

**Files:**
- Modify: `src/db/calendar.ts:102` (export the `NewEventData` type — see Step 0)
- Modify: `src/db/repositories.ts`
- Test: `src/db/repositories.test.ts`
- Sweep: `src/components/CalendarEditor.tsx:17,37`, `src/components/PageHistory.tsx:25,26`, `src/routes/TimelineRoute.tsx:14,15`, `src/routes/HomeRoute.tsx:89,92`

**Interfaces:**
- Consumes: `db`; `createCalendar`, `updateCalendar`, `deleteCalendar`, `addEvent`, `updateEvent`, `deleteEvent` from `./calendar`; `Calendar`, `TimelineEvent` from `./types`.
- Produces: `calendarRepo: CalendarRepository` with `listCalendars()`, `getCalendar()`, `createCalendar()`, `updateCalendar()`, `removeCalendar()`, `listEvents()`, `listEventsByDate()`, `addEvent()`, `updateEvent()`, `removeEvent()`. Also makes `NewEventData` public.

**Exact signatures to mirror** (read from `src/db/calendar.ts`, do not guess):
- `addEvent(data: NewEventData): Promise<string>` where `NewEventData = Omit<TimelineEvent, 'id' | 'startAbsolute' | 'endAbsolute' | 'createdAt' | 'updatedAt'>`
- `updateEvent(id: string, changes: Partial<Omit<TimelineEvent, 'id' | 'createdAt'>>): Promise<void>` — note the `Omit`, it is not a plain `Partial<TimelineEvent>`
- `createCalendar(name: string): Promise<string>`, `updateCalendar(id: string, changes: Partial<Calendar>): Promise<void>`, `deleteCalendar(calendarId: string): Promise<void>`

- [ ] **Step 0: Export `NewEventData`**

`NewEventData` is currently a private type alias (`src/db/calendar.ts:102`), so the repository interface cannot name it. Export it — the barrel re-exports `./calendar` already, so no `index.ts` change is needed:

```ts
export type NewEventData = Omit<TimelineEvent, 'id' | 'startAbsolute' | 'endAbsolute' | 'createdAt' | 'updatedAt'>
```

`PageHistory:26` currently reads `db.calendars.toArray()` (unordered) — it feeds `pageChronology`, which sorts on `startAbsolute` itself, so serving it from the `createdAt`-ordered `listCalendars()` is safe and keeps one method. `HomeRoute:89` reads events unordered (`toArray`) and `PageHistory:25`/`TimelineRoute:15` read them `orderBy('startAbsolute')` — those are genuinely different, so both methods exist.

- [ ] **Step 1: Write the failing test**

Append to `src/db/repositories.test.ts`:

```ts
describe('calendarRepo', () => {
  beforeEach(async () => {
    await Promise.all([db.calendars.clear(), db.events.clear()])
    await db.calendars.bulkAdd([
      { id: 'c2', name: 'Second', createdAt: 200 },
      { id: 'c1', name: 'First', createdAt: 100 },
    ] as never)
    await db.events.bulkAdd([
      { id: 'e2', calendarId: 'c1', title: 'Late', startAbsolute: 900 },
      { id: 'e1', calendarId: 'c1', title: 'Early', startAbsolute: 100 },
    ] as never)
  })

  it('listCalendars() orders by createdAt', async () => {
    expect((await calendarRepo.listCalendars()).map((c) => c.id)).toEqual(['c1', 'c2'])
  })

  it('getCalendar() fetches one', async () => {
    expect((await calendarRepo.getCalendar('c2'))?.name).toBe('Second')
  })

  it('getCalendar() returns undefined for an unknown id', async () => {
    expect(await calendarRepo.getCalendar('nope')).toBeUndefined()
  })

  it('listEventsByDate() orders by startAbsolute', async () => {
    expect((await calendarRepo.listEventsByDate()).map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('listEvents() returns every event', async () => {
    expect((await calendarRepo.listEvents()).map((e) => e.id).sort()).toEqual(['e1', 'e2'])
  })
})
```

Add `calendarRepo` to the `'./repositories'` import.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: FAIL — `calendarRepo` is not exported.

- [ ] **Step 3: Implement `calendarRepo`**

Append to `src/db/repositories.ts`. Import the CRUD from `./calendar` and the types; `NewEventData` is declared in `./calendar` — import it as a type from there.

```ts
// ---------------------------------------------------------------------------
// Calendars & timeline events
// ---------------------------------------------------------------------------

export interface CalendarRepository {
  /** Every calendar, ordered by creation. */
  listCalendars(): Promise<Calendar[]>
  getCalendar(id: string): Promise<Calendar | undefined>
  createCalendar(name: string): Promise<string>
  /** Rewrites every event's cached absolute days in one transaction — see
   *  `updateCalendar` in `calendar.ts`. */
  updateCalendar(id: string, changes: Partial<Calendar>): Promise<void>
  /** Cascade-deletes the calendar's events. */
  removeCalendar(id: string): Promise<void>

  /** Every event, unordered. */
  listEvents(): Promise<TimelineEvent[]>
  /** Every event on the shared absolute-day axis, earliest first. */
  listEventsByDate(): Promise<TimelineEvent[]>
  addEvent(data: NewEventData): Promise<string>
  /** Always recomputes the cached absolute days — see `updateEvent` in
   *  `calendar.ts`. `id`/`createdAt` are not patchable. */
  updateEvent(id: string, changes: Partial<Omit<TimelineEvent, 'id' | 'createdAt'>>): Promise<void>
  removeEvent(id: string): Promise<void>
}

export const calendarRepo: CalendarRepository = {
  listCalendars: () => db.calendars.orderBy('createdAt').toArray(),
  getCalendar: (id) => db.calendars.get(id),
  createCalendar,
  updateCalendar,
  removeCalendar: deleteCalendar,

  listEvents: () => db.events.toArray(),
  listEventsByDate: () => db.events.orderBy('startAbsolute').toArray(),
  addEvent,
  updateEvent,
  removeEvent: deleteEvent,
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 5: Sweep the four call sites**

`src/components/CalendarEditor.tsx:17` and `:37`:
```ts
const calendars = useLiveQuery(() => calendarRepo.listCalendars(), []) ?? []
// ...
const cal = await calendarRepo.getCalendar(id)
```
(`handleNew` already calls the imported `createCalendar` — leave that; it is a data-layer function, not a `db.*` reach. Switching it to `calendarRepo.createCalendar` is optional polish, not required.)

`src/components/PageHistory.tsx:25–26`:
```ts
const events = useLiveQuery(() => calendarRepo.listEventsByDate(), [])
const calendars = useLiveQuery(() => calendarRepo.listCalendars(), [])
```

`src/routes/TimelineRoute.tsx:14–15`:
```ts
const calendars = useLiveQuery(() => calendarRepo.listCalendars(), []) ?? []
const events    = useLiveQuery(() => calendarRepo.listEventsByDate(), []) ?? []
```

`src/routes/HomeRoute.tsx:89` and `:91–94`:
```ts
const events = useLiveQuery(() => calendarRepo.listEvents(), []) ?? NO_EVENTS
const featured = useMemo(() => pickFeaturedEvent(events, todayIndex()), [events])
const featuredCal = useLiveQuery(
  () => (featured ? calendarRepo.getCalendar(featured.calendarId) : undefined),
  [featured?.calendarId],
)
```

- [ ] **Step 6: Verify**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all green. `PageHistory.test.tsx` and `HomeRoute.test.tsx` cover these reads.

- [ ] **Step 7: Commit**

```bash
git add src/db/repositories.ts src/db/repositories.test.ts src/components/CalendarEditor.tsx src/components/PageHistory.tsx src/routes/TimelineRoute.tsx src/routes/HomeRoute.tsx
git commit -m "refactor: put calendar + event reads behind calendarRepo (#186)"
```

---

### Task 3: `manuscriptRepo` + its six call sites

**Files:**
- Modify: `src/db/repositories.ts`
- Modify: `src/db/manuscript.ts` (add `listScenesForBook`)
- Test: `src/db/repositories.test.ts`
- Sweep: `src/components/manuscript/BinderTree.tsx:19,23`, `BookGridView.tsx:17-20`, `BookWriteView.tsx:15`, `StructureControls.tsx:15-17`, `src/routes/BookRoute.tsx:13`, `src/routes/ManuscriptRoute.tsx:14,15`

**Interfaces:**
- Consumes: `db`; `listBooks`, `listChapters`, `listPlotlines`, `listBeats` from `./manuscript` (these already match the inline UI queries exactly — delegate, do not reimplement); `Book`, `Chapter`, `Scene`, `Plotline`, `Beat` from `./types`.
- Produces: `manuscriptRepo: ManuscriptRepository`, and a new `listScenesForBook(bookId): Promise<Scene[]>` exported from `./manuscript`.

The existing `listScenes(chapterId)` is **chapter**-scoped; all six UI callers want **book**-scoped. That is the one genuinely missing read. Add it to `manuscript.ts` beside its sibling so the module stays the single owner of scene queries.

- [ ] **Step 1: Write the failing test**

Append to `src/db/repositories.test.ts`:

```ts
describe('manuscriptRepo', () => {
  beforeEach(async () => {
    await Promise.all([
      db.books.clear(), db.chapters.clear(), db.scenes.clear(),
      db.plotlines.clear(), db.beats.clear(),
    ])
    await db.books.bulkAdd([
      { id: 'b2', title: 'Second', synopsis: '', order: 1, createdAt: 1, updatedAt: 1 },
      { id: 'b1', title: 'First', synopsis: '', order: 0, createdAt: 1, updatedAt: 1 },
    ] as never)
    await db.chapters.bulkAdd([
      { id: 'ch2', bookId: 'b1', title: 'Two', order: 1 },
      { id: 'ch1', bookId: 'b1', title: 'One', order: 0 },
    ] as never)
    await db.scenes.bulkAdd([
      { id: 's2', bookId: 'b1', chapterId: 'ch1', title: 'Later', order: 1, wordCount: 5 },
      { id: 's1', bookId: 'b1', chapterId: 'ch1', title: 'Sooner', order: 0, wordCount: 3 },
      { id: 's3', bookId: 'b2', chapterId: 'ch9', title: 'Other book', order: 0, wordCount: 1 },
    ] as never)
  })

  it('listBooks() orders by order', async () => {
    expect((await manuscriptRepo.listBooks()).map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('getBook() fetches one', async () => {
    expect((await manuscriptRepo.getBook('b2'))?.title).toBe('Second')
  })

  it('listChaptersForBook() is scoped to the book and ordered', async () => {
    expect((await manuscriptRepo.listChaptersForBook('b1')).map((c) => c.id)).toEqual(['ch1', 'ch2'])
  })

  // The read the UI needed and the module never had: book-scoped, not
  // chapter-scoped. Must not leak scenes from other books.
  it('listScenesForBook() is scoped to the book and ordered', async () => {
    expect((await manuscriptRepo.listScenesForBook('b1')).map((s) => s.id)).toEqual(['s1', 's2'])
  })

  it('listAllScenes() spans every book', async () => {
    expect((await manuscriptRepo.listAllScenes()).map((s) => s.id).sort()).toEqual(['s1', 's2', 's3'])
  })

  it('getScene() fetches one', async () => {
    expect((await manuscriptRepo.getScene('s1'))?.title).toBe('Sooner')
  })
})
```

Add `manuscriptRepo` to the `'./repositories'` import.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: FAIL — `manuscriptRepo` is not exported.

- [ ] **Step 3: Add `listScenesForBook` to `src/db/manuscript.ts`**

Place it directly beneath the existing `listScenes` (around line 173):

```ts
/** Every scene in a book, in reading order. The binder, the grid and the
 *  structure lane all work book-at-a-time; `listScenes` above is the
 *  chapter-scoped sibling. */
export async function listScenesForBook(bookId: string): Promise<Scene[]> {
  return db.scenes.where('bookId').equals(bookId).sortBy('order')
}
```

- [ ] **Step 4: Implement `manuscriptRepo`**

Append to `src/db/repositories.ts`:

```ts
// ---------------------------------------------------------------------------
// Manuscript: books → chapters → scenes, plus the plotline/beat grid
// ---------------------------------------------------------------------------

export interface ManuscriptRepository {
  listBooks(): Promise<Book[]>
  getBook(id: string): Promise<Book | undefined>

  /** Chapters of one book, in reading order. */
  listChaptersForBook(bookId: string): Promise<Chapter[]>

  getScene(id: string): Promise<Scene | undefined>
  /** Scenes of one book, in reading order. */
  listScenesForBook(bookId: string): Promise<Scene[]>
  /** Every scene across every book — for library-wide word-count stats. */
  listAllScenes(): Promise<Scene[]>

  /** Plotline lanes of one book, in lane order (includes the structure lane). */
  listPlotlinesForBook(bookId: string): Promise<Plotline[]>
  /** Every beat in one book, unordered (the grid places them by cell). */
  listBeatsForBook(bookId: string): Promise<Beat[]>
}

export const manuscriptRepo: ManuscriptRepository = {
  listBooks,
  getBook: (id) => db.books.get(id),

  listChaptersForBook: listChapters,

  getScene: (id) => db.scenes.get(id),
  listScenesForBook,
  listAllScenes: () => db.scenes.toArray(),

  listPlotlinesForBook: listPlotlines,
  listBeatsForBook: listBeats,
}
```

Mutations (create/update/delete/reorder/structure) are deliberately absent: every UI caller already imports those functions from the barrel and none of them touches `db.*`. Adding pass-throughs nobody calls would be boilerplate for its own sake (YAGNI).

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm run test:run -- src/db/repositories.test.ts
```

Expected: PASS.

- [ ] **Step 6: Sweep the six call sites**

`src/components/manuscript/BinderTree.tsx:18–25`:
```ts
const chapters = useLiveQuery(
  () => manuscriptRepo.listChaptersForBook(bookId),
  [bookId],
) ?? NO_CHAPTERS
const scenes = useLiveQuery(
  () => manuscriptRepo.listScenesForBook(bookId),
  [bookId],
) ?? NO_SCENES
```

`src/components/manuscript/BookGridView.tsx:17–20`:
```ts
const scenes = useLiveQuery(() => manuscriptRepo.listScenesForBook(bookId), [bookId]) ?? NO_SCENES
const chapters = useLiveQuery(() => manuscriptRepo.listChaptersForBook(bookId), [bookId]) ?? NO_CHAPTERS
const plotlines = useLiveQuery(() => manuscriptRepo.listPlotlinesForBook(bookId), [bookId]) ?? NO_PLOTLINES
const beats = useLiveQuery(() => manuscriptRepo.listBeatsForBook(bookId), [bookId]) ?? NO_BEATS
```

`src/components/manuscript/BookWriteView.tsx:14–17`:
```ts
const scene = useLiveQuery(
  () => (selectedSceneId ? manuscriptRepo.getScene(selectedSceneId) : undefined),
  [selectedSceneId],
)
```

`src/components/manuscript/StructureControls.tsx:15–17`. Note line 16 currently reads plotlines with `toArray()` (unordered) while `BookGridView` reads them sorted; `listPlotlinesForBook` is sorted and that is a safe superset — the component only does `.find(p => p.kind === 'structure')`:
```ts
const scenes = useLiveQuery(() => manuscriptRepo.listScenesForBook(bookId), [bookId]) ?? NO_SCENES
const plotlines = useLiveQuery(() => manuscriptRepo.listPlotlinesForBook(bookId), [bookId]) ?? NO_PLOTLINES
const beats = useLiveQuery(() => manuscriptRepo.listBeatsForBook(bookId), [bookId]) ?? NO_BEATS
```

`src/routes/BookRoute.tsx:13`:
```ts
const book = useLiveQuery(() => (bookId ? manuscriptRepo.getBook(bookId) : undefined), [bookId])
```

`src/routes/ManuscriptRoute.tsx:14–15`:
```ts
const books = useLiveQuery(() => manuscriptRepo.listBooks(), []) ?? NO_BOOKS
const scenes = useLiveQuery(() => manuscriptRepo.listAllScenes(), []) ?? NO_SCENES
```

- [ ] **Step 7: Verify**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all green. `BinderTree.test.tsx`, `BookGridView.test.tsx`, `BookWriteView.test.tsx`, `StructureControls.test.tsx`, `BookRoute.test.tsx` and `ManuscriptRoute.test.tsx` all cover these reads — this is the largest reactivity surface in the sweep, so a green run here is the load-bearing check.

- [ ] **Step 8: Commit**

```bash
git add src/db/repositories.ts src/db/repositories.test.ts src/db/manuscript.ts src/components/manuscript/ src/routes/BookRoute.tsx src/routes/ManuscriptRoute.tsx
git commit -m "refactor: put manuscript reads behind manuscriptRepo (#186)"
```

---

### Task 4: The three non-repo sites — `getMany`, `getMeta`, `countAll`

**Files:**
- Modify: `src/db/repositories.ts` (add `getMany` to `PageRepository`)
- Modify: `src/db/backup.ts` (add `countAll`)
- Test: `src/db/repositories.test.ts`, `src/db/backup.test.ts`
- Sweep: `src/components/SearchModal.tsx:43`, `src/components/BackupBanner.tsx:21`, `src/routes/SettingsRoute.tsx:46,98-110`

**Interfaces:**
- Produces: `pageRepo.getMany(ids: string[]): Promise<(LorePage | undefined)[]>`; `countAll(): Promise<BackupCounts>` exported from `./backup`.
- Consumes: the existing `getMeta<T>(key: string): Promise<T | undefined>` from `./schema` and `BackupCounts` from `./backup`.

These three sites are each the wrong shape for a domain repo, so they are handled individually:
1. `SearchModal` bulk-hydrates recently-viewed ids — `pageRepo` needs a bulk read it never had.
2. `BackupBanner`/`SettingsRoute` read one meta key — `getMeta()` already exists; just use it.
3. `SettingsRoute.loadCounts()` counts all 14 tables inline — that is infra that leaked into a route. It moves into `db/backup.ts`, which already owns `BackupCounts`.

- [ ] **Step 1: Write the failing tests**

In `src/db/repositories.test.ts`, inside the existing `pageRepo` describe block:

```ts
it('getMany() hydrates ids in order, undefined for the missing', async () => {
  const a = await pageRepo.create({ title: 'Alpha' })
  const b = await pageRepo.create({ title: 'Beta' })
  const got = await pageRepo.getMany([b, 'no-such-id', a])
  expect(got.map((p) => p?.title)).toEqual(['Beta', undefined, 'Alpha'])
})
```

In `src/db/backup.test.ts`:

```ts
it('countAll() reports what each table holds', async () => {
  await db.pages.clear()
  await db.templates.clear()
  await db.pages.bulkAdd([
    { id: 'p1', title: 'A', content: '', summary: '', tags: [], category: 'x', createdAt: 1, updatedAt: 1 },
    { id: 'p2', title: 'B', content: '', summary: '', tags: [], category: 'x', createdAt: 1, updatedAt: 1 },
  ] as never)

  const counts = await countAll()

  expect(counts.pages).toBe(2)
  expect(counts.templates).toBe(0)
  // Every BackupCounts key must be populated — a missing table would silently
  // read as `undefined` in the Settings import summary.
  for (const value of Object.values(counts)) expect(typeof value).toBe('number')
})
```

Import `countAll` from `'./backup'` and `db` from `'./schema'` as that file already does.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm run test:run -- src/db/repositories.test.ts src/db/backup.test.ts
```

Expected: FAIL — `pageRepo.getMany` is not a function; `countAll` is not exported.

- [ ] **Step 3: Add `getMany` to `PageRepository`**

In `src/db/repositories.ts`, add to the `PageRepository` interface (after `get`):

```ts
  /** Several pages by id, in the order given. Ids with no page come back
   *  `undefined` — callers drop them (a recently-viewed list can name a page
   *  that has since been deleted). */
  getMany(ids: string[]): Promise<(LorePage | undefined)[]>
```

and to the `pageRepo` object (after `get`):

```ts
  getMany: (ids) => db.pages.bulkGet(ids),
```

- [ ] **Step 4: Add `countAll` to `src/db/backup.ts`**

Place it directly beneath the `BackupCounts` interface (after line 91), so the type and its producer sit together:

```ts
/** Live row counts for every table, in `BackupCounts` shape. Settings shows
 *  these beside an incoming backup's counts so the user can see exactly what a
 *  restore would replace. Lives here, not in the route, because the table list
 *  belongs to the backup format — add a table to the format and this must
 *  follow. */
export async function countAll(): Promise<BackupCounts> {
  const [pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats] = await Promise.all([
    db.pages.count(), db.maps.count(), db.pins.count(), db.regions.count(),
    db.templates.count(), db.calendars.count(), db.events.count(), db.images.count(),
    db.docLinks.count(), db.books.count(), db.chapters.count(), db.scenes.count(),
    db.plotlines.count(), db.beats.count(),
  ])
  return {
    pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats,
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run test:run -- src/db/repositories.test.ts src/db/backup.test.ts
```

Expected: PASS.

- [ ] **Step 6: Sweep the three call sites**

`src/components/SearchModal.tsx:40–45`:
```ts
const recent =
  useLiveQuery(async () => {
    const ids = getRecent()
    if (ids.length === 0) return NO_PAGES
    const pages = await pageRepo.getMany(ids)
    return pages.filter((p): p is LorePage => p != null)
  }, []) ?? NO_PAGES
```

`src/components/BackupBanner.tsx:21` — `getMeta` is already exported from the barrel:
```ts
const lastBackup = useLiveQuery(() => getMeta<number>(LAST_BACKUP_KEY), [])
```

`src/routes/SettingsRoute.tsx:46`:
```ts
const lastBackup = useLiveQuery(() => getMeta<number>(LAST_BACKUP_KEY), [])
```

`src/routes/SettingsRoute.tsx:98–110` — delete `loadCounts` entirely and call `countAll()` at its call sites (grep for `loadCounts(` in that file; it feeds the import summary). The local `BackupCounts` import stays if still referenced by state types.

After this, `SettingsRoute.tsx` and `BackupBanner.tsx` no longer import `db` at all — remove it from their `'../db'` import lists.

- [ ] **Step 7: Verify — and confirm the UI tier is now clean**

```bash
npm run lint && npm run build && npm run test:run
```

Then prove zero UI-tier leaks remain (this is the gate for Task 5):

```bash
grep -rn "\bdb\.\(pages\|maps\|pins\|regions\|templates\|images\|calendars\|events\|snapshots\|books\|chapters\|scenes\|plotlines\|beats\|meta\|docLinks\)\b" src/components src/routes src/usePage.ts --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Expected: **no output.** If anything prints, sweep it before continuing — Task 5's lint rule will fail the build otherwise.

- [ ] **Step 8: Commit**

```bash
git add src/db/repositories.ts src/db/repositories.test.ts src/db/backup.ts src/db/backup.test.ts src/components/SearchModal.tsx src/components/BackupBanner.tsx src/routes/SettingsRoute.tsx
git commit -m "refactor: bulk page read, getMeta, and countAll() out of the routes (#186)"
```

---

### Task 5: The guardrail — a layered `no-restricted-imports`

**Files:**
- Modify: `eslint.config.js`

**Interfaces:**
- Consumes: nothing. Depends only on Task 4's clean grep.
- Produces: a lint error on any `db` import outside the data layer, the five infra modules, and tests.

**This is the task the whole issue exists for.** The sweep without the rule just re-drifts — that is precisely how we got here, since `repositories.ts` has said "follow-up sweep" in its header the whole time and nobody followed up.

**The trap, stated once more:** do **not** carve out infra with `'no-restricted-imports': 'off'`. `backup.ts`, `htmlExport.ts` and `manuscriptExport.ts` all import `./platform`; switching the rule off wholesale would also switch off their `@tauri-apps/*` ban — holing the platform seam to plug this one. Each carve-out re-declares the bans it still wants.

- [ ] **Step 1: Write the rule**

Replace the `rules` block and the `platform.ts` override in `eslint.config.js` with:

```js
// The two seams, both enforced by no-restricted-imports. Because a later
// config block REPLACES this rule rather than merging with it, every
// carve-out below must re-declare the bans it still wants — writing
// `'no-restricted-imports': 'off'` anywhere would silently drop the other
// seam's ban in those files.
const TAURI_BAN = {
  group: ['@tauri-apps/*'],
  message:
    'Shell APIs go through the platform seam — add what you need to src/platform.ts instead (see CLAUDE.md "Desktop shell").',
}

const DB_BAN = {
  group: ['**/db', '**/db/schema'],
  importNames: ['db'],
  message:
    'The UI reaches the data layer through a repository, not the Dexie singleton — add what you need to src/db/repositories.ts (see CLAUDE.md "Data layer").',
}
```

then, in the exported config:

```js
  {
    files: ['**/*.{ts,tsx}'],
    extends: [ /* unchanged */ ],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN, DB_BAN] }],
    },
  },
  {
    // The platform seam itself (and its tests, which mock the plugin modules)
    // is the one place allowed to import @tauri-apps/*. It still may not touch
    // the Dexie singleton.
    files: ['src/platform.ts', 'src/platform.test.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [DB_BAN] }],
    },
  },
  {
    // The data layer owns `db`; the infra modules below do whole-DB,
    // cross-table work (exportAll, the search-index sync, snapshot capture,
    // the two exporters) that a per-table repository would serve worse, not
    // better. This exemption is deliberate and permanent — see the header of
    // src/db/repositories.ts. They keep the Tauri ban.
    files: [
      'src/db/**/*.ts',
      'src/backup.ts',
      'src/searchSync.ts',
      'src/snapshots.ts',
      'src/htmlExport.ts',
      'src/manuscriptExport.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', { patterns: [TAURI_BAN] }],
    },
  },
  {
    // Tests set up fixtures against the tables directly.
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
```

- [ ] **Step 2: Confirm the codebase is already clean**

```bash
npm run lint
```

Expected: PASS. (Task 4 removed the last UI-tier `db` import. If this fails, the failures ARE the remaining leaks — fix them, don't weaken the rule.)

- [ ] **Step 3: Prove the guardrail bites — the acceptance test**

A green lint run proves nothing on its own; it must *fail* on a violation. Temporarily add to `src/components/Backlinks.tsx` (any UI file will do):

```ts
import { db } from '../db'
```

Run:
```bash
npm run lint
```

Expected: **FAIL**, with the message `The UI reaches the data layer through a repository, not the Dexie singleton — add what you need to src/db/repositories.ts (see CLAUDE.md "Data layer").`

- [ ] **Step 4: Prove the platform seam survived**

With the db import reverted, temporarily add to `src/backup.ts` (an infra file, exempt from the db ban):

```ts
import { save } from '@tauri-apps/plugin-dialog'
```

Run:
```bash
npm run lint
```

Expected: **FAIL**, with the platform-seam message. This is the check that the carve-out did not hole the other seam — if it passes, the config regressed and `'off'` crept in somewhere.

- [ ] **Step 5: Revert both probes and verify green**

```bash
git checkout -- src/components/Backlinks.tsx src/backup.ts
npm run lint && npm run build && npm run test:run
```

Expected: all green, working tree clean apart from `eslint.config.js`.

- [ ] **Step 6: Commit**

```bash
git add eslint.config.js
git commit -m "chore: lint the data-layer seam shut, layered so the platform ban survives (#186)"
```

---

### Task 6: Correct the record

**Files:**
- Modify: `src/db/repositories.ts` (header comment, lines 1–18)
- Modify: `CLAUDE.md` (Data layer section)

The stale premise in `repositories.ts` — that the seam exists because direct `db` access "blocks the planned Electron / on-disk-JSON move (#142)" — is what made #186 look like portability work. Leaving it in place guarantees someone re-derives it.

- [ ] **Step 1: Rewrite the `repositories.ts` header**

Replace lines 1–18 with:

```ts
// Repository seam over the data layer.
//
// The seam exists so the UI has exactly ONE idiom for reaching data: routes and
// components call a repository, never the Dexie singleton. That is enforced by
// lint (`no-restricted-imports` in eslint.config.js), because the honour system
// did not hold — this file's header used to say "follow-up sweep" and the sweep
// did not happen, so new code kept copying the wrong idiom.
//
// What this seam is NOT: a portability layer. An earlier header claimed it
// unblocked the storage swap (#142). It does not. Phase 2 of the desktop move
// (#174) mirrors worlds to disk via exportAll() and needs nothing from here, and
// any non-Dexie backend must bring its own invalidation story for the ~77
// `useLiveQuery` sites — which no repository interface reduces. See
// docs/desktop-transition-investigation.md §4.1. Do not justify work here on
// portability grounds without re-reading that section.
//
// Reactivity note: the read methods just return the promise from a `db.*`
// query, so `useLiveQuery(() => pageRepo.get(id), [id])` stays reactive —
// Dexie tracks the read globally on the `db` instance regardless of how deep in
// the call stack it happens, so wrapping it in a method changes nothing.
//
// Tiers:
//   UI (components, routes, hooks) — repositories only. Lint-enforced.
//   Infra (src/backup.ts, searchSync.ts, snapshots.ts, htmlExport.ts,
//          manuscriptExport.ts) — keeps raw `db`, permanently and on purpose:
//          it does whole-DB, cross-table, transactional work that a per-table
//          repository would serve worse, not better.
//   Data layer (src/db/**) — owns `db`.
```

- [ ] **Step 2: Update CLAUDE.md**

In the **Data layer** section, after the "Per-lore DB" paragraph, add:

```markdown
**Repository seam (`repositories.ts`):** the UI reaches data through `pageRepo` / `mapRepo` / `templateRepo` / `calendarRepo` / `manuscriptRepo` — **never** the `db` singleton. Lint-enforced (`no-restricted-imports`), mirroring the `platform.ts` rule. Three tiers: **UI** (components/routes/hooks) → repositories only; **infra** (`src/backup.ts`, `searchSync.ts`, `snapshots.ts`, `htmlExport.ts`, `manuscriptExport.ts`) → keeps raw `db` on purpose for whole-DB cross-table work; **data layer** (`src/db/**`) → owns `db`. Tests are exempt. The seam is about having **one idiom**, not portability — a non-Dexie backend would still have to solve invalidation for ~77 `useLiveQuery` sites, which no repository interface reduces (`docs/desktop-transition-investigation.md` §4.1). Adding a UI read means adding a repo method, not reaching past the seam. Note the ESLint carve-outs re-declare the bans they keep — never write `'no-restricted-imports': 'off'`, or the `@tauri-apps` ban silently dies in `backup.ts`/`htmlExport.ts`/`manuscriptExport.ts`.
```

- [ ] **Step 3: Verify**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all green (comment-only changes, but CLAUDE.md and the header are load-bearing documentation and the suite must stay green).

- [ ] **Step 4: Commit**

```bash
git add src/db/repositories.ts CLAUDE.md
git commit -m "docs: state what the repository seam is for, and what it isn't (#186)"
```

---

### Task 7: Ship it

- [ ] **Step 1: Full verification from a clean state**

```bash
npm run lint && npm run build && npm run test:run
```

All three must be green — CI runs exactly these.

- [ ] **Step 2: Confirm the sweep is total**

```bash
grep -rn "from '\.\./db'\|from '\./db'\|from '\.\./\.\./db'" src/components src/routes src/usePage.ts --include=*.ts --include=*.tsx | grep -v "\.test\." | grep "\bdb\b,\|{ db }\|{ db," | grep -v "pageRepo\|mapRepo\|templateRepo\|calendarRepo\|manuscriptRepo"
```

Expected: no output. (Belt-and-braces; the lint rule is the real gate.)

- [ ] **Step 3: Open the PR**

```bash
gh pr create --title "chore: one idiom for the data layer — finish the repository seam and lint it shut (#186)" --label "version:patch" --body "$(cat <<'EOF'
Closes #186.

## What

Every UI-tier `db.*` call site (34 across 19 files) now goes through a repository, and a lint rule keeps it that way.

- **Three new domain repos** — `templateRepo`, `calendarRepo`, `manuscriptRepo` — joining `pageRepo`/`mapRepo`, following the existing `mapRepo` precedent of grouping a domain rather than a table.
- **Three sites that weren't repo-shaped**, handled individually: `pageRepo.getMany()` for `SearchModal`'s bulk hydrate; the existing `getMeta()` for the two `LAST_BACKUP_KEY` reads; and `SettingsRoute.loadCounts()` — a 14-table count living in a route — moved into `db/backup.ts` as `countAll()`, next to the `BackupCounts` type it returns.
- **A layered `no-restricted-imports` rule** banning the `db` singleton outside `src/db/**`, five named infra modules, and tests.

## The premise correction

The audit filed #186 as portability work: direct `db.*` access "blocks the planned storage swap". **That premise was stale, and this PR says so in the code.**

Phase 2 of the desktop move (#174) mirrors worlds to disk via `exportAll()` and needs nothing from this seam. And per `docs/desktop-transition-investigation.md` §4.1, any non-Dexie backend must bring its own invalidation story for the ~77 `useLiveQuery` sites — which *no repository interface reduces*. The seam buys **one idiom**, not portability. `repositories.ts`'s header (which previously made the portability claim) and CLAUDE.md now both state this, so it doesn't get re-derived in six months.

The drift was real, though, and the tree proved it: `SearchModal` reached for `db.pages` directly, and `BinderTree`/`BookGridView` hand-rolled book-scoped queries that already existed in `manuscript.ts`.

## Why the lint rule is layered

The obvious carve-out — `'no-restricted-imports': 'off'` for the infra files — would also disable the **`@tauri-apps/*` ban** in `backup.ts`, `htmlExport.ts` and `manuscriptExport.ts`. Those three import `./platform` and are the likeliest to violate it. Plugging one seam must not hole the other, so each carve-out re-declares the bans it keeps.

## Verification

- `npm run lint`, `npm run build`, `npm run test:run` green.
- New repo tests in `src/db/repositories.test.ts`; `countAll()` test in `src/db/backup.test.ts`.
- **The guardrail was proven to bite**, not just to pass: a deliberate `import { db }` in a component fails lint with the seam message, and a deliberate `@tauri-apps` import in `backup.ts` still fails with the platform message. Both probes reverted.
- No behaviour change intended. Repo methods mirror the current queries exactly — notably `templateRepo` does *not* route through `getTemplates()`, which falls back to `BUILTIN_TEMPLATES` on an empty table.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Note the `version:patch` label: this is a refactor with no user-visible change.
