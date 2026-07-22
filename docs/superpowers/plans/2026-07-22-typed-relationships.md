# Typed Relationships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Lore Codex a typed-relationship primitive — one directed row per fact, rendered correctly from both pages — so #136 (family trees) and #137 (diplomacy webs) become views over real data instead of new data models.

**Architecture:** Two new Dexie tables at schema **v15**. `relationshipTypes` holds the user-definable vocabulary (`label` + `inverse` + `group`); `relationships` holds directed `(fromId, toId, typeId, note)` rows. The inversion logic lives in one pure module, `src/relations.ts`, that every consumer — the page aside now, both views later — must go through. A `Relations` panel in the page aside reads a single merged list, and `/templates` grows a section for managing the vocabulary.

**Tech Stack:** TypeScript (strict), React 19, Dexie + dexie-react-hooks (`useLiveQuery`), Vitest + happy-dom + fake-indexeddb.

**Spec:** `docs/superpowers/specs/2026-07-22-typed-relationships-design.md`

## Global Constraints

- **Schema version is 15** — `schema.ts`'s Dexie ladder and `CURRENT_SCHEMA_VERSION` in `db/backup.ts` bump together. Never one without the other.
- **New public API must be re-exported from `src/db/index.ts`** — `barrel.test.ts` fails otherwise.
- **UI never imports the `db` singleton.** Components and routes go through `relationshipRepo`. Lint-enforced (`DB_BAN` in `eslint.config.js`); the ban is on the named `db` import specifically.
- **Pure modules with type-only db imports live at `src/`**, not `src/db/` — a runtime `db` import would drag in the Dexie singleton.
- **No host `alert()`/`confirm()`** — use `ConfirmDialog`.
- **`useLiveQuery` component tests need `afterEach(cleanup)`**, or teardown throws "window is not defined".
- **Symmetry is derived** (`label === inverse`, trimmed + case-folded). Never add a stored `symmetric` field.
- Verification before any PR: `npm run lint && npm run build && npm run test:run`. PR label: `version:minor`.
- Branch: `feat/175-typed-relationships` (already created from `origin/main`; the spec commit is on it).

---

### Task 1: Data-model types + the pure direction rule

The inversion is the one genuinely subtle piece of this feature. It ships first, alone, with no database in sight.

**Files:**
- Modify: `src/db/types.ts` (append at end of file)
- Create: `src/relations.ts`
- Test: `src/relations.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RelationshipGroup`, `RelationshipType`, `Relationship` (types); `isSymmetric(type): boolean`; `ResolvedRelation`; `resolveRelation(row, type, viewerId): ResolvedRelation | null`.

- [ ] **Step 1: Add the two interfaces to `src/db/types.ts`**

Append to the end of the file:

```ts
// ---------------------------------------------------------------------------
// Typed relationships (#175)
// ---------------------------------------------------------------------------
// Untyped [[wiki links]] can say Arthur references Uther but not that Uther is
// his *father*. A Relationship is one directed fact; the RelationshipType it
// points at says how that fact reads from each end.

/** Which view a relationship type feeds. #136 filters to 'kin', #137 to
 *  'faction'/'org'. Stored on the type so a user-invented "Half-sibling of"
 *  tagged 'kin' appears in the family tree without hardcoding its id. */
export type RelationshipGroup = 'kin' | 'faction' | 'org' | 'social' | 'other'

/** A user-definable kind of relationship, with how it reads from each end.
 *  A type is *symmetric* when `label` and `inverse` are the same text — see
 *  isSymmetric() in src/relations.ts. That is the definition, not a shortcut:
 *  there is deliberately no stored flag that could contradict the labels. */
export interface RelationshipType {
  id: string
  label: string // reads from the `from` page: "Parent of"
  inverse: string // reads from the `to` page: "Child of"
  color: string
  group: RelationshipGroup
  order: number // display order in pickers and the page aside
  builtin: boolean // true for the shipped starter vocabulary
}

/** One directed fact: `fromId` is `type.label` of `toId`.
 *  Stored ONCE and rendered from both ends via the type's inverse — two
 *  mirrored rows could desync, and one row cannot disagree with itself. */
export interface Relationship {
  id: string
  fromId: string
  toId: string
  typeId: string
  note: string // free text, '' when none — covers "m. 1042–1067"
  createdAt: number
}
```

- [ ] **Step 2: Write the failing test**

Create `src/relations.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isSymmetric, resolveRelation } from './relations'
import type { Relationship, RelationshipType } from './db'

const parentOf: RelationshipType = {
  id: 'parent-of', label: 'Parent of', inverse: 'Child of',
  color: '#e0a458', group: 'kin', order: 0, builtin: true,
}
const allyOf: RelationshipType = {
  id: 'ally-of', label: 'Ally of', inverse: 'Ally of',
  color: '#7eb09b', group: 'faction', order: 3, builtin: true,
}

const row: Relationship = {
  id: 'r1', fromId: 'uther', toId: 'arthur',
  typeId: 'parent-of', note: '', createdAt: 1,
}

describe('isSymmetric', () => {
  it('is true when both ends read the same', () => {
    expect(isSymmetric(allyOf)).toBe(true)
  })

  it('is false when the ends differ', () => {
    expect(isSymmetric(parentOf)).toBe(false)
  })

  it('ignores surrounding whitespace and case', () => {
    expect(isSymmetric({ ...allyOf, inverse: '  ally of  ' })).toBe(true)
  })
})

describe('resolveRelation', () => {
  it('reads the label from the `from` end', () => {
    const r = resolveRelation(row, parentOf, 'uther')
    expect(r).toEqual({ row, type: parentOf, label: 'Parent of', otherId: 'arthur' })
  })

  it('reads the inverse from the `to` end', () => {
    const r = resolveRelation(row, parentOf, 'arthur')
    expect(r?.label).toBe('Child of')
    expect(r?.otherId).toBe('uther')
  })

  it('reads the same label from either end of a symmetric type', () => {
    const sym: Relationship = { ...row, typeId: 'ally-of' }
    expect(resolveRelation(sym, allyOf, 'uther')?.label).toBe('Ally of')
    expect(resolveRelation(sym, allyOf, 'arthur')?.label).toBe('Ally of')
  })

  it('returns null when the viewer is on neither end', () => {
    expect(resolveRelation(row, parentOf, 'merlin')).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/relations.test.ts`
Expected: FAIL — `Failed to resolve import "./relations"`.

- [ ] **Step 4: Write the implementation**

Create `src/relations.ts`:

```ts
import type { Relationship, RelationshipType } from './db'

// ---------------------------------------------------------------------------
// The direction rule (#175) — pure
// ---------------------------------------------------------------------------
// A relationship is stored once, directed. Which label a page sees depends on
// which end of the row that page is. This module is the ONLY place that
// inversion is derived: the page aside today, the family tree (#136) and the
// diplomacy web (#137) later all call resolveRelation rather than re-deriving
// it, because three copies of this rule is how two views end up disagreeing
// about what "parent" means.
//
// Type-only db imports, so this stays out of src/db/ (a runtime db import
// would drag in the Dexie singleton — see CLAUDE.md).

/** A relationship type is symmetric when it reads the same from both ends
 *  ("Ally of" / "Ally of"). Derived rather than stored: if both labels say the
 *  same thing, the relationship *is* symmetric, and no second field can
 *  contradict them. Load-bearing for duplicate detection — for a symmetric
 *  type, A→B and B→A are the same fact. */
export function isSymmetric(type: RelationshipType): boolean {
  return type.label.trim().toLowerCase() === type.inverse.trim().toLowerCase()
}

/** One relationship as a specific page sees it. */
export interface ResolvedRelation {
  row: Relationship
  type: RelationshipType
  /** How it reads from `viewerId`: the type's label or its inverse. */
  label: string
  /** The page at the far end. */
  otherId: string
}

/** Resolve `row` from `viewerId`'s point of view, or null when the viewer is on
 *  neither end (a caller bug, or a stale row — never render a guess). */
export function resolveRelation(
  row: Relationship,
  type: RelationshipType,
  viewerId: string,
): ResolvedRelation | null {
  if (viewerId === row.fromId) {
    return { row, type, label: type.label, otherId: row.toId }
  }
  if (viewerId === row.toId) {
    return { row, type, label: type.inverse, otherId: row.fromId }
  }
  return null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/relations.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/db/types.ts src/relations.ts src/relations.test.ts
git commit -m "feat: relationship data-model types and the pure direction rule (#175)"
```

---

### Task 2: Schema v15 + the type vocabulary

**Files:**
- Modify: `src/db/schema.ts` (add two table fields to the class; add a `version(15)` block after the v14 block ending at :322)
- Create: `src/db/relationshipTypes.ts`
- Test: `src/db/relationshipTypes.test.ts`

**Interfaces:**
- Consumes: `RelationshipType`, `RelationshipGroup` (Task 1).
- Produces: `BUILTIN_RELATIONSHIP_TYPES: RelationshipType[]`; `seedRelationshipTypes(): Promise<void>`; `getRelationshipTypes(): Promise<RelationshipType[]>`; `createRelationshipType(input: NewRelationshipType): Promise<string>`; `updateRelationshipType(id: string, changes: Partial<Omit<RelationshipType, 'id' | 'builtin'>>): Promise<void>`; `deleteRelationshipType(id: string): Promise<void>`; `resetRelationshipType(id: string): Promise<void>`; `countRelationshipsOfType(id: string): Promise<number>`; `NewRelationshipType`.

- [ ] **Step 1: Add the tables to `LoreDB`**

In `src/db/schema.ts`, add to the type import list at the top:

```ts
  Relationship,
  RelationshipType,
```

And add two fields to the class, after `beats!: Table<Beat, string>` (:119):

```ts
  relationshipTypes!: Table<RelationshipType, string>
  relationships!: Table<Relationship, string>
```

- [ ] **Step 2: Add the v15 block**

In `src/db/schema.ts`, immediately after the `.upgrade(...)` closing the v14 block (:322), append inside the constructor:

```ts
    // v15 adds the typed-relationship tables (#175): a user-definable vocabulary
    // plus the directed edges that reference it. New tables need no data
    // migration. `relationships` is indexed on both endpoints because a page's
    // relations are read from both directions and merged into one list.
    this.version(15).stores({
      pages: 'id, title, titleLc, category, updatedAt',
      maps: 'id, name, createdAt',
      pins: 'id, mapId, pageId, childMapId',
      regions: 'id, mapId, pageId, childMapId',
      meta: '&key',
      templates: 'id, name',
      snapshots: '++id, timestamp',
      calendars: 'id, name, createdAt',
      events: 'id, calendarId, startAbsolute, pageId, updatedAt',
      images: 'id, pageId, order, createdAt',
      docLinks: 'id, pageId, documentId',
      books: 'id, order',
      chapters: 'id, bookId, order',
      scenes: 'id, bookId, chapterId, order, updatedAt',
      plotlines: 'id, bookId, order',
      beats: 'id, bookId, plotlineId, sceneId',
      relationshipTypes: 'id, order',
      relationships: 'id, fromId, toId, typeId',
    })
```

- [ ] **Step 3: Write the failing test**

Create `src/db/relationshipTypes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  BUILTIN_RELATIONSHIP_TYPES,
  seedRelationshipTypes,
  getRelationshipTypes,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
  resetRelationshipType,
} from './relationshipTypes'
import { db } from '../db'

beforeEach(async () => {
  await db.relationshipTypes.clear()
  await db.relationships.clear()
})

describe('seedRelationshipTypes', () => {
  it('seeds the built-in vocabulary in order', async () => {
    await seedRelationshipTypes()
    const types = await getRelationshipTypes()
    expect(types.map((t) => t.id)).toEqual(BUILTIN_RELATIONSHIP_TYPES.map((t) => t.id))
    expect(types.every((t) => t.builtin)).toBe(true)
  })

  // React StrictMode invokes the startup effect twice in dev, so this can run
  // concurrently against a fresh DB. Mirrors the seedTemplates concurrency test.
  it('is safe under concurrent invocation (no BulkError, no duplicates)', async () => {
    await Promise.all([seedRelationshipTypes(), seedRelationshipTypes()])
    expect(await db.relationshipTypes.count()).toBe(BUILTIN_RELATIONSHIP_TYPES.length)
  })

  it('re-adds a missing built-in without touching custom types', async () => {
    await seedRelationshipTypes()
    await createRelationshipType({ label: 'Mentor of', inverse: 'Student of', group: 'social' })
    await db.relationshipTypes.delete('ally-of')

    await seedRelationshipTypes()

    const types = await getRelationshipTypes()
    expect(types.some((t) => t.id === 'ally-of')).toBe(true)
    expect(types.filter((t) => t.label === 'Mentor of')).toHaveLength(1)
  })

  it('leaves an edited built-in alone', async () => {
    await seedRelationshipTypes()
    await updateRelationshipType('enemy-of', { label: 'Sworn enemy of' })
    await seedRelationshipTypes()
    expect((await db.relationshipTypes.get('enemy-of'))?.label).toBe('Sworn enemy of')
  })
})

describe('createRelationshipType', () => {
  it('appends after the highest existing order, not the count', async () => {
    await seedRelationshipTypes()
    const highest = BUILTIN_RELATIONSHIP_TYPES.length - 1
    await db.relationshipTypes.delete('parent-of') // count drops, max order does not

    const id = await createRelationshipType({
      label: 'Rival of', inverse: 'Rival of', group: 'social',
    })

    expect((await db.relationshipTypes.get(id))?.order).toBe(highest + 1)
  })

  it('creates a custom type that is not builtin', async () => {
    const id = await createRelationshipType({
      label: 'Created by', inverse: 'Creator of', group: 'other',
    })
    const type = await db.relationshipTypes.get(id)
    expect(type?.builtin).toBe(false)
    expect(type?.inverse).toBe('Creator of')
  })
})

describe('deleteRelationshipType', () => {
  it('refuses to delete a built-in', async () => {
    await seedRelationshipTypes()
    await deleteRelationshipType('parent-of')
    expect(await db.relationshipTypes.get('parent-of')).toBeDefined()
  })

  it('deletes a custom type and cascades its relationships', async () => {
    const id = await createRelationshipType({
      label: 'Rival of', inverse: 'Rival of', group: 'social',
    })
    await db.relationships.add({
      id: 'r1', fromId: 'a', toId: 'b', typeId: id, note: '', createdAt: 1,
    })
    await db.relationships.add({
      id: 'r2', fromId: 'a', toId: 'c', typeId: 'other-type', note: '', createdAt: 2,
    })

    await deleteRelationshipType(id)

    expect(await db.relationshipTypes.get(id)).toBeUndefined()
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual(['r2'])
  })
})

describe('resetRelationshipType', () => {
  it('restores a built-in to its shipped labels and colour', async () => {
    await seedRelationshipTypes()
    await updateRelationshipType('parent-of', { label: 'Sire of', color: '#000000' })

    await resetRelationshipType('parent-of')

    const type = await db.relationshipTypes.get('parent-of')
    const shipped = BUILTIN_RELATIONSHIP_TYPES.find((t) => t.id === 'parent-of')!
    expect(type?.label).toBe(shipped.label)
    expect(type?.color).toBe(shipped.color)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run src/db/relationshipTypes.test.ts`
Expected: FAIL — `Failed to resolve import "./relationshipTypes"`.

- [ ] **Step 5: Write the implementation**

Create `src/db/relationshipTypes.ts`:

```ts
import { db, uid } from './schema'
import type { RelationshipGroup, RelationshipType } from './types'

// ---------------------------------------------------------------------------
// Relationship vocabulary (#175)
// ---------------------------------------------------------------------------
// The user-definable set of relationship kinds. Same vocabulary/content split
// as templates.ts vs pages.ts: this module owns the types, relationships.ts
// owns the edges that reference them, and the dependency runs one way.

/** The shipped starter vocabulary. `group` is what lets #136 ask "which of
 *  these are kinship?" without hardcoding ids — a user-defined "Half-sibling
 *  of" tagged 'kin' joins the family tree automatically. */
export const BUILTIN_RELATIONSHIP_TYPES: RelationshipType[] = [
  { id: 'parent-of', label: 'Parent of', inverse: 'Child of', color: '#e0a458', group: 'kin', order: 0, builtin: true },
  { id: 'sibling-of', label: 'Sibling of', inverse: 'Sibling of', color: '#d9c069', group: 'kin', order: 1, builtin: true },
  { id: 'spouse-of', label: 'Spouse of', inverse: 'Spouse of', color: '#c77e9c', group: 'kin', order: 2, builtin: true },
  { id: 'ally-of', label: 'Ally of', inverse: 'Ally of', color: '#7eb09b', group: 'faction', order: 3, builtin: true },
  { id: 'enemy-of', label: 'Enemy of', inverse: 'Enemy of', color: '#cf6f6f', group: 'faction', order: 4, builtin: true },
  { id: 'member-of', label: 'Member of', inverse: 'Has member', color: '#8aa4c7', group: 'org', order: 5, builtin: true },
]

/** The fields needed to create a custom type; the rest are derived. */
export interface NewRelationshipType {
  label: string
  inverse: string
  group: RelationshipGroup
  color?: string
}

/**
 * Add any missing built-ins. Runs the whole read-modify-write inside one rw
 * transaction so concurrent invocations serialize: React StrictMode
 * double-invokes the startup effect in dev, and without the transaction both
 * reads see an empty table, both bulkAdd the built-ins, and the loser rejects
 * with a duplicate-key BulkError. (Mirrors seedTemplates.)
 *
 * Unlike seedTemplates this does NOT remove built-ins that left the shipped
 * set — dropping a relationship type would orphan every row referencing it.
 * Custom types are never touched, and an edited built-in keeps its edits.
 */
export async function seedRelationshipTypes(): Promise<void> {
  await db.transaction('rw', db.relationshipTypes, async () => {
    const existing = new Set((await db.relationshipTypes.toArray()).map((t) => t.id))
    const missing = BUILTIN_RELATIONSHIP_TYPES.filter((t) => !existing.has(t.id))
    if (missing.length) await db.relationshipTypes.bulkAdd(missing)
  })
}

/** Every type, in display order. */
export async function getRelationshipTypes(): Promise<RelationshipType[]> {
  return db.relationshipTypes.orderBy('order').toArray()
}

/** Create a custom type. Appends at max(order)+1 rather than count, so creating
 *  a type after deleting one never collides with an existing order (the same
 *  reasoning as attachDocument). */
export async function createRelationshipType(input: NewRelationshipType): Promise<string> {
  const id = uid()
  const all = await db.relationshipTypes.toArray()
  const order = all.reduce((max, t) => Math.max(max, t.order + 1), 0)
  await db.relationshipTypes.add({
    id,
    label: input.label,
    inverse: input.inverse,
    color: input.color ?? '#a0a0a0',
    group: input.group,
    order,
    builtin: false,
  })
  return id
}

/** Edit a type. `id` and `builtin` are not editable — a built-in stays a
 *  built-in however it is relabelled, which is what keeps reset meaningful. */
export async function updateRelationshipType(
  id: string,
  changes: Partial<Omit<RelationshipType, 'id' | 'builtin'>>,
): Promise<void> {
  await db.relationshipTypes.update(id, changes)
}

/** How many relationships use this type — shown in the delete confirmation. */
export async function countRelationshipsOfType(id: string): Promise<number> {
  return db.relationships.where('typeId').equals(id).count()
}

/**
 * Delete a custom type and every relationship using it, in one transaction
 * (cascading like deleteCalendar does for its events). Built-ins are refused:
 * seedRelationshipTypes would re-add them on the next start, so offering the
 * delete would be a lie. The UI hides the control for built-ins; this guard is
 * the enforcement.
 */
export async function deleteRelationshipType(id: string): Promise<void> {
  await db.transaction('rw', [db.relationshipTypes, db.relationships], async () => {
    const type = await db.relationshipTypes.get(id)
    if (!type || type.builtin) return
    await db.relationships.where('typeId').equals(id).delete()
    await db.relationshipTypes.delete(id)
  })
}

/** Restore a built-in to its shipped labels, colour and group. No-op for a
 *  custom type, which has no shipped definition to restore. */
export async function resetRelationshipType(id: string): Promise<void> {
  const shipped = BUILTIN_RELATIONSHIP_TYPES.find((t) => t.id === id)
  if (!shipped) return
  await db.relationshipTypes.put({ ...shipped })
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/db/relationshipTypes.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 7: Commit**

```bash
git add src/db/schema.ts src/db/relationshipTypes.ts src/db/relationshipTypes.test.ts
git commit -m "feat: schema v15 relationship tables and the type vocabulary (#175)"
```

---

### Task 3: The relationship edges

**Files:**
- Create: `src/db/relationships.ts`
- Test: `src/db/relationships.test.ts`

**Interfaces:**
- Consumes: `resolveRelation`, `isSymmetric`, `ResolvedRelation` (Task 1); `getRelationshipTypes` (Task 2).
- Produces: `addRelationship(fromId, toId, typeId, note?): Promise<string | null>`; `updateRelationshipNote(id, note): Promise<void>`; `removeRelationship(id): Promise<void>`; `getRelationsFor(pageId): Promise<PageRelation[]>`; `PageRelation`.

- [ ] **Step 1: Write the failing test**

Create `src/db/relationships.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import {
  addRelationship,
  removeRelationship,
  updateRelationshipNote,
  getRelationsFor,
} from './relationships'
import { seedRelationshipTypes } from './relationshipTypes'
import { db } from '../db'
import type { LorePage } from '../db'

function page(id: string, title: string): LorePage {
  return {
    id, title, titleLc: title.toLowerCase(), category: 'Character',
    content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
  }
}

beforeEach(async () => {
  await db.relationships.clear()
  await db.relationshipTypes.clear()
  await db.pages.clear()
  await seedRelationshipTypes()
  await db.pages.bulkAdd([
    page('uther', 'Uther'), page('arthur', 'Arthur'), page('igraine', 'Igraine'),
  ])
})

describe('addRelationship guards', () => {
  it('refuses a self-relation', async () => {
    expect(await addRelationship('uther', 'uther', 'parent-of')).toBeNull()
    expect(await db.relationships.count()).toBe(0)
  })

  it('refuses an exact duplicate', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    expect(await addRelationship('uther', 'arthur', 'parent-of')).toBeNull()
    expect(await db.relationships.count()).toBe(1)
  })

  it('allows the opposite direction of an asymmetric type', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    expect(await addRelationship('arthur', 'uther', 'parent-of')).not.toBeNull()
    expect(await db.relationships.count()).toBe(2)
  })

  it('refuses the opposite direction of a SYMMETRIC type — same fact', async () => {
    await addRelationship('uther', 'igraine', 'spouse-of')
    expect(await addRelationship('igraine', 'uther', 'spouse-of')).toBeNull()
    expect(await db.relationships.count()).toBe(1)
  })

  it('refuses an unknown type', async () => {
    expect(await addRelationship('uther', 'arthur', 'no-such-type')).toBeNull()
  })
})

describe('getRelationsFor', () => {
  it('merges both directions into one list with the right labels', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')

    const fromUther = await getRelationsFor('uther')
    expect(fromUther.map((r) => [r.label, r.other.title])).toEqual([['Parent of', 'Arthur']])

    const fromArthur = await getRelationsFor('arthur')
    expect(fromArthur.map((r) => [r.label, r.other.title])).toEqual([['Child of', 'Uther']])
  })

  it('sorts by type order, then by the other page title', async () => {
    await addRelationship('uther', 'igraine', 'spouse-of') // order 2
    await addRelationship('uther', 'arthur', 'parent-of') // order 0

    const rows = await getRelationsFor('uther')
    expect(rows.map((r) => r.other.title)).toEqual(['Arthur', 'Igraine'])
  })

  it('skips rows whose other page no longer exists', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    await db.pages.delete('arthur')
    expect(await getRelationsFor('uther')).toEqual([])
  })

  it('carries the note through', async () => {
    const id = await addRelationship('uther', 'igraine', 'spouse-of', 'm. 1042–1067')
    expect((await getRelationsFor('uther'))[0].row.note).toBe('m. 1042–1067')

    await updateRelationshipNote(id!, 'annulled')
    expect((await getRelationsFor('uther'))[0].row.note).toBe('annulled')
  })
})

describe('removeRelationship', () => {
  it('removes by row id, so it works from either end', async () => {
    await addRelationship('uther', 'arthur', 'parent-of')
    const seenFromArthur = await getRelationsFor('arthur')

    await removeRelationship(seenFromArthur[0].row.id)

    expect(await getRelationsFor('uther')).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/relationships.test.ts`
Expected: FAIL — `Failed to resolve import "./relationships"`.

- [ ] **Step 3: Write the implementation**

Create `src/db/relationships.ts`:

```ts
import { db, uid, now } from './schema'
import { isSymmetric, resolveRelation, type ResolvedRelation } from '../relations'
import type { LorePage } from './types'

// ---------------------------------------------------------------------------
// Relationship edges (#175)
// ---------------------------------------------------------------------------
// One directed row per fact, indexed on both endpoints. A page's relations are
// read from BOTH directions and merged into a single list — see getRelationsFor
// for why that isn't the two-panel shape DocumentLinks uses.

/** A relationship as one page sees it, joined to the page at the far end. */
export interface PageRelation extends ResolvedRelation {
  other: LorePage
}

/**
 * Record that `fromId` is `typeId`'s label of `toId`. Returns the new row's id,
 * or null when refused. Guards live here rather than in the component so every
 * caller gets them (the same shape as attachDocument's no-op-on-self-or-dupe):
 *
 *  - self-relation: a page cannot be its own parent
 *  - exact duplicate (same from, to, type)
 *  - for a SYMMETRIC type, the reversed pair as well — "Igraine ally-of Uther"
 *    and "Uther ally-of Igraine" are one fact, and storing both would render
 *    the same line twice on both pages
 *  - an unknown type id, which would render as a blank label
 *
 * Not transactional: this is a single-tab app, and the worst case is a
 * duplicate row the user can delete.
 */
export async function addRelationship(
  fromId: string,
  toId: string,
  typeId: string,
  note = '',
): Promise<string | null> {
  if (fromId === toId) return null

  const type = await db.relationshipTypes.get(typeId)
  if (!type) return null

  const existing = await db.relationships.where('fromId').equals(fromId).toArray()
  if (existing.some((r) => r.toId === toId && r.typeId === typeId)) return null

  if (isSymmetric(type)) {
    const reversed = await db.relationships.where('fromId').equals(toId).toArray()
    if (reversed.some((r) => r.toId === fromId && r.typeId === typeId)) return null
  }

  const id = uid()
  await db.relationships.add({ id, fromId, toId, typeId, note, createdAt: now() })
  return id
}

/** Edit a row's free-text note. */
export async function updateRelationshipNote(id: string, note: string): Promise<void> {
  await db.relationships.update(id, { note })
}

/** Delete by row id — which works identically from either end, because there
 *  is only ever one row per fact. */
export async function removeRelationship(id: string): Promise<void> {
  await db.relationships.delete(id)
}

/**
 * Every relationship touching `pageId`, resolved to this page's point of view
 * and joined to the page at the far end, sorted by type order then title.
 *
 * ONE list, not the owning/reciprocal panels DocumentLinks shows. There, the
 * two directions genuinely differ to the reader. Here they do not: with inverse
 * labels, "Parent of ● Arthur" and "Child of ● Uther" are both simply relations
 * of this page, and splitting them would surface an implementation detail —
 * which end happened to be typed first — as a user-visible distinction.
 *
 * Rows whose far page is missing are skipped (defense in depth; deletePage
 * cascades, so this is rare).
 */
export async function getRelationsFor(pageId: string): Promise<PageRelation[]> {
  const [outgoing, incoming, types] = await Promise.all([
    db.relationships.where('fromId').equals(pageId).toArray(),
    db.relationships.where('toId').equals(pageId).toArray(),
    db.relationshipTypes.toArray(),
  ])
  const typeById = new Map(types.map((t) => [t.id, t]))

  const out: PageRelation[] = []
  for (const row of [...outgoing, ...incoming]) {
    const type = typeById.get(row.typeId)
    if (!type) continue
    const resolved = resolveRelation(row, type, pageId)
    if (!resolved) continue
    const other = await db.pages.get(resolved.otherId)
    if (other) out.push({ ...resolved, other })
  }

  out.sort(
    (a, b) =>
      a.type.order - b.type.order ||
      a.other.title.toLowerCase().localeCompare(b.other.title.toLowerCase()),
  )
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/db/relationships.test.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/db/relationships.ts src/db/relationships.test.ts
git commit -m "feat: relationship edge CRUD with symmetric-aware duplicate guards (#175)"
```

---

### Task 4: Barrel, repository, and the deletePage cascade

Without this task the feature exists but no UI can legally reach it, and deleting a page leaves dangling edges.

**Files:**
- Modify: `src/db/index.ts`
- Modify: `src/db/repositories.ts`
- Modify: `src/db/pages.ts:80` (transaction table list) and `:109` (cascade block)
- Test: `src/db/relationships.test.ts` (append)

**Interfaces:**
- Consumes: everything from Tasks 2 and 3.
- Produces: `relationshipRepo: RelationshipRepository` — the only surface UI code may use.

- [ ] **Step 1: Write the failing cascade test**

Append to `src/db/relationships.test.ts`:

```ts
describe('deletePage cascade', () => {
  it('drops relationships on both endpoints', async () => {
    const { deletePage } = await import('./pages')
    await addRelationship('uther', 'arthur', 'parent-of') // arthur is the `to`
    await addRelationship('arthur', 'igraine', 'sibling-of') // arthur is the `from`

    await deletePage('arthur')

    expect(await db.relationships.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/db/relationships.test.ts -t "both endpoints"`
Expected: FAIL — `expected 2 to be 0`.

- [ ] **Step 3: Add the cascade to `deletePage`**

In `src/db/pages.ts`, extend the transaction table list at :80 (already the array form, so the 5-table varargs cap is not in play):

```ts
  await db.transaction('rw', [db.pages, db.images, db.pins, db.docLinks, db.regions, db.events, db.scenes, db.relationships], async () => {
```

And append inside the transaction, after the two `docLinks` deletes at :109–110:

```ts
    // Drop typed relationships on either endpoint. Unlike pins/regions/events —
    // which keep the row and null its pageId — a relationship IS the pair, so a
    // half-dangling edge has nothing left to mean.
    await db.relationships.where('fromId').equals(id).delete()
    await db.relationships.where('toId').equals(id).delete()
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/db/relationships.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Re-export from the barrel**

In `src/db/index.ts`, add to the module-list comment near the `docLinks.ts` line (:16):

```
//   relationshipTypes.ts — the user-definable relationship vocabulary (#175)
//   relationships.ts — typed directed edges between pages (#175)
```

And add the two re-exports beside `export * from './docLinks'` (:33):

```ts
export * from './relationshipTypes'
export * from './relationships'
```

- [ ] **Step 6: Add the repository**

In `src/db/repositories.ts`, add to the imports:

```ts
import {
  seedRelationshipTypes,
  getRelationshipTypes,
  createRelationshipType,
  updateRelationshipType,
  deleteRelationshipType,
  resetRelationshipType,
  countRelationshipsOfType,
  type NewRelationshipType,
} from './relationshipTypes'
import {
  addRelationship,
  updateRelationshipNote,
  removeRelationship,
  getRelationsFor,
  type PageRelation,
} from './relationships'
import type { RelationshipType } from './types'
```

And append at the end of the file:

```ts
// ---------------------------------------------------------------------------
// Typed relationships (#175)
// ---------------------------------------------------------------------------

export interface RelationshipRepository {
  /** The vocabulary, in display order. */
  listTypes(): Promise<RelationshipType[]>
  createType(input: NewRelationshipType): Promise<string>
  updateType(
    id: string,
    changes: Partial<Omit<RelationshipType, 'id' | 'builtin'>>,
  ): Promise<void>
  /** Deletes a custom type and cascades its relationships. Built-ins refused. */
  removeType(id: string): Promise<void>
  resetType(id: string): Promise<void>
  /** How many relationships use a type — for the delete confirmation. */
  countOfType(id: string): Promise<number>
  seedTypes(): Promise<void>

  /** Every relationship touching a page, from that page's point of view. */
  listFor(pageId: string): Promise<PageRelation[]>
  /** Returns the new row id, or null when refused (self / duplicate / bad type). */
  add(fromId: string, toId: string, typeId: string, note?: string): Promise<string | null>
  updateNote(id: string, note: string): Promise<void>
  remove(id: string): Promise<void>
}

export const relationshipRepo: RelationshipRepository = {
  listTypes: getRelationshipTypes,
  createType: createRelationshipType,
  updateType: updateRelationshipType,
  removeType: deleteRelationshipType,
  resetType: resetRelationshipType,
  countOfType: countRelationshipsOfType,
  seedTypes: seedRelationshipTypes,

  listFor: getRelationsFor,
  add: addRelationship,
  updateNote: updateRelationshipNote,
  remove: removeRelationship,
}
```

- [ ] **Step 7: Run the barrel test and the full suite**

Run: `npx vitest run src/db/barrel.test.ts src/db/relationships.test.ts src/db/relationshipTypes.test.ts`
Expected: PASS — barrel test confirms the new API is re-exported.

- [ ] **Step 8: Commit**

```bash
git add src/db/index.ts src/db/repositories.ts src/db/pages.ts src/db/relationships.test.ts
git commit -m "feat: relationship repository, barrel exports, deletePage cascade (#175)"
```

---

### Task 5: Backup coverage

Eight touchpoints in one file. A relationship that doesn't survive export → import is a relationship the user will lose.

**Files:**
- Modify: `src/db/backup.ts`
- Test: `src/db/backup.test.ts` (append)

**Interfaces:**
- Consumes: `Relationship`, `RelationshipType` types (Task 1); the tables (Task 2).
- Produces: `CURRENT_SCHEMA_VERSION === 15`; `BackupData.relationships`, `BackupData.relationshipTypes`; `BackupCounts.relationships`, `BackupCounts.relationshipTypes`.

- [ ] **Step 1: Write the failing test**

Append to `src/db/backup.test.ts`:

```ts
describe('typed relationships in backups (#175)', () => {
  it('round-trips both new tables through export and import', async () => {
    await db.relationshipTypes.clear()
    await db.relationships.clear()
    await db.pages.clear()
    await db.pages.bulkAdd([
      { id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
        content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
      { id: 'arthur', title: 'Arthur', titleLc: 'arthur', category: 'Character',
        content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 },
    ])
    await db.relationshipTypes.add({
      id: 'parent-of', label: 'Parent of', inverse: 'Child of',
      color: '#e0a458', group: 'kin', order: 0, builtin: true,
    })
    await db.relationships.add({
      id: 'r1', fromId: 'uther', toId: 'arthur',
      typeId: 'parent-of', note: 'm. 1042', createdAt: 1,
    })

    const json = await exportAll()
    await db.relationships.clear()
    await db.relationshipTypes.clear()
    await importAll(json)

    expect(await db.relationshipTypes.get('parent-of')).toMatchObject({ inverse: 'Child of' })
    expect(await db.relationships.get('r1')).toMatchObject({ note: 'm. 1042' })
  })

  it('counts the new tables for the import confirmation', async () => {
    const json = await exportAll()
    const { counts } = parseBackup(json)
    expect(counts.relationships).toBe(await db.relationships.count())
    expect(counts.relationshipTypes).toBe(await db.relationshipTypes.count())
  })

  it('imports a pre-v15 backup with the new tables empty', async () => {
    const legacy = JSON.stringify({
      schemaVersion: 14, pages: [], maps: [], pins: [], regions: [],
      templates: [], calendars: [], events: [], images: [], docLinks: [],
      books: [], chapters: [], scenes: [], plotlines: [], beats: [], meta: [],
    })
    const { data, counts } = parseBackup(legacy)
    expect(counts.relationships).toBe(0)
    expect(data.relationships).toEqual([])
    expect(data.relationshipTypes).toEqual([])
  })

  it('drops edges whose endpoints are not in the backup page set', async () => {
    const crafted = JSON.stringify({
      schemaVersion: 15,
      pages: [{ id: 'uther', title: 'Uther', category: 'Character',
        content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1 }],
      relationshipTypes: [], meta: [],
      relationships: [
        { id: 'ok', fromId: 'uther', toId: 'uther', typeId: 't', note: '', createdAt: 1 },
        { id: 'dangling', fromId: 'uther', toId: 'ghost', typeId: 't', note: '', createdAt: 1 },
      ],
    })
    const { data } = parseBackup(crafted)
    // sanitizeBackup runs inside importAll, so assert through a real import.
    await importAll(crafted)
    expect((await db.relationships.toArray()).map((r) => r.id)).toEqual(['ok'])
    expect(data.relationships).toHaveLength(2) // parseBackup itself does not filter
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/db/backup.test.ts -t "typed relationships"`
Expected: FAIL — `counts.relationships` is `undefined`.

- [ ] **Step 3: Bump the version and extend the payload types**

In `src/db/backup.ts`:

Change `CURRENT_SCHEMA_VERSION` from `14` to `15`.

Add to the type imports:

```ts
  Relationship,
  RelationshipType,
```

Add to `BackupData`, after `beats?: Beat[]`:

```ts
  relationshipTypes?: RelationshipType[]
  relationships?: Relationship[]
```

Add to `BackupCounts`, after `beats: number`:

```ts
  relationshipTypes: number
  relationships: number
```

- [ ] **Step 4: Extend `countAll`**

Replace the body of `countAll` with:

```ts
export async function countAll(): Promise<BackupCounts> {
  const [pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats, relationshipTypes, relationships] =
    await Promise.all([
    db.pages.count(), db.maps.count(), db.pins.count(), db.regions.count(),
    db.templates.count(), db.calendars.count(), db.events.count(), db.images.count(),
    db.docLinks.count(), db.books.count(), db.chapters.count(), db.scenes.count(),
    db.plotlines.count(), db.beats.count(),
    db.relationshipTypes.count(), db.relationships.count(),
  ])
  return {
    pages, maps, pins, regions, templates, calendars, events, images, docLinks,
    books, chapters, scenes, plotlines, beats, relationshipTypes, relationships,
  }
}
```

- [ ] **Step 5: Add the migration step**

In the `MIGRATIONS` map, after the `13: (d) => d,` entry:

```ts
  // v15 added the typed-relationship tables (#175); fill them in for older
  // backups. An empty vocabulary is fine — seedRelationshipTypes() re-adds the
  // built-ins right after import, exactly as seedTemplates does.
  14: (d) => ({
    ...d,
    relationshipTypes: asArray(d.relationshipTypes),
    relationships: asArray(d.relationships),
  }),
```

- [ ] **Step 6: Extend `parseBackup`'s counts**

In the returned `counts` object, after `beats: asArray(data.beats).length,`:

```ts
      relationshipTypes: asArray(data.relationshipTypes).length,
      relationships: asArray(data.relationships).length,
```

- [ ] **Step 7: Extend `exportAll`**

Add `db.relationshipTypes.toArray(), db.relationships.toArray(),` to the `Promise.all` array (after `db.beats.toArray(),` and before `db.meta.toArray(),`), extend the destructuring to `..., beats, relationshipTypes, relationships, allMeta]`, and add `relationshipTypes,` and `relationships,` to the `JSON.stringify` object after `beats,`.

- [ ] **Step 8: Extend `exportSnapshot`**

Relationships are text, so snapshots version them like pages. Add `db.relationshipTypes.toArray(), db.relationships.toArray(),` to the `Promise.all` (after `db.beats.toArray(),`), extend the destructuring to `..., beats, relationshipTypes, relationships, allMeta]`, and add `relationshipTypes,` and `relationships,` to the `JSON.stringify` object after `beats,`.

- [ ] **Step 9: Add endpoint filtering to `sanitizeBackup`**

In the returned object, after the `docLinks` IIFE:

```ts
    // Drop relationship edges whose endpoints aren't in this backup's page set —
    // an untrusted or hand-edited backup could carry dangling ids, and a
    // half-resolvable relationship renders as a blank row. The `note` is plain
    // text rendered as text (React-escaped), so it needs no HTML sanitizing.
    relationships: (() => {
      const pageIds = new Set(asArray(data.pages).map((p) => p.id))
      return asArray(data.relationships).filter(
        (r) => pageIds.has(r.fromId) && pageIds.has(r.toId),
      )
    })(),
```

- [ ] **Step 10: Extend `importBackupInto` and `restoreSnapshotInto`**

In `importBackupInto`: add `target.relationshipTypes, target.relationships` to the transaction table array, add `target.relationshipTypes.clear(), target.relationships.clear(),` to the `Promise.all` of clears, and add these two lines after the `beats` bulkAdd:

```ts
    await target.relationshipTypes.bulkAdd(asArray(data.relationshipTypes))
    await target.relationships.bulkAdd(asArray(data.relationships))
```

Make the identical three changes in `restoreSnapshotInto` (its transaction covers the text tables, which these are).

- [ ] **Step 11: Re-seed the vocabulary after import and restore**

In `importAll`, after `await seedDefaultCalendar()`:

```ts
  await seedRelationshipTypes()
```

Add the same line to `restoreSnapshot` after its `seedDefaultCalendar()` call, and add the import at the top of the file:

```ts
import { seedRelationshipTypes } from './relationshipTypes'
```

- [ ] **Step 12: Run the tests**

Run: `npx vitest run src/db/backup.test.ts`
Expected: PASS — all pre-existing backup tests plus the 4 new ones.

- [ ] **Step 13: Commit**

```bash
git add src/db/backup.ts src/db/backup.test.ts
git commit -m "feat: carry typed relationships through backup, snapshot and import (#175)"
```

---

### Task 6: World-mirror coverage

**Files:**
- Modify: `src/worldMirrorSync.ts` (:120 comment, :128 `COUNTED_TABLES`, :134 `countedTableCounts`)
- Test: `src/worldMirrorSync.realdb.test.ts` (append)

**Interfaces:**
- Consumes: the tables (Task 2).
- Produces: nothing new — extends `mirrorChangeTime()`'s coverage.

**Critical:** mirror logic must be proved against the real-DB harness (`worldMirrorSync.realdb.test.ts`, which mocks only `platform.ts`). Two Criticals reached review because every mirror test mocked `./db` wholesale. Do not add this test to a `./db`-mocking file.

- [ ] **Step 1: Write the failing test**

`mirrorChangeTime()` is module-private and takes a `now` argument — it cannot be
called from a test. Drive the public poll path instead and assert on the mocked
`writeWorldMirror`, the way every other test in this file does.

Append to `src/worldMirrorSync.realdb.test.ts` as a new top-level `describe`.
Note the `beforeEach`: **`write()` refuses a world the registry doesn't know**,
so the registry row is mandatory — 19 of 28 tests broke when the real-DB harness
landed precisely because they skipped it.

```ts
// #175: relationship rows carry no updatedAt, so they belong to the tables the
// probe tracks by COUNT. Without that, a session spent only adding relations
// looks completely idle to the poll.
describe('typed relationships are visible to the change probe (#175)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetWorldMirrorStateForTests()
    vi.mocked(writeWorldMirror).mockResolvedValue(true)

    await registry.lores.clear()
    await registry.lores.add({
      id: activeLoreId, name: 'Aethel', banner: null, createdAt: 1, updatedAt: 1,
    })

    await Promise.all(db.tables.map((t) => t.clear()))
  })

  it('notices a relationship added when no timestamped table changed', async () => {
    const start = Date.now()

    // A page edited an hour ago: there is content to export, and the quiet
    // window is comfortably satisfied so the poll is free to write.
    await db.pages.put({
      id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
      content: '<p>x</p>', summary: '', tags: [],
      createdAt: start - 60 * 60_000, updatedAt: start - 60 * 60_000,
    })

    // First poll: establishes the baseline counts and writes once.
    await maybeMirrorWorld(start)
    expect(writeWorldMirror).toHaveBeenCalledTimes(1)

    // Add ONLY a relationship. No table with an updatedAt/createdAt index moves.
    await db.relationships.add({
      id: 'r-mirror', fromId: 'uther', toId: 'arthur',
      typeId: 'parent-of', note: '', createdAt: 1,
    })

    // A later poll, past the floor, must see the count change and write again.
    await maybeMirrorWorld(start + MIRROR_FLOOR_MS + MIRROR_QUIET_MS + 1_000)
    expect(writeWorldMirror).toHaveBeenCalledTimes(2)
  })
})
```

Add `MIRROR_FLOOR_MS` and `MIRROR_QUIET_MS` to this file's existing import from
`./worldMirror` if they aren't already there (`MIRROR_POLL_MS` is imported the
same way).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/worldMirrorSync.realdb.test.ts -t "no timestamped table changed"`
Expected: FAIL — `expected 1 to be 2`. The second poll sees no change, because
neither new table is probed.

- [ ] **Step 3: Add both tables to the counted set**

In `src/worldMirrorSync.ts`, update the comment at :120 to say **11 tables** rather than 9 and name the two new ones, then extend the constant:

```ts
const COUNTED_TABLES = [
  'pins', 'regions', 'templates', 'docLinks',
  'books', 'chapters', 'plotlines', 'beats', 'meta',
  'relationshipTypes', 'relationships',
] as const
```

And extend `countedTableCounts`:

```ts
async function countedTableCounts(): Promise<Record<CountedTable, number>> {
  const [pins, regions, templates, docLinks, books, chapters, plotlines, beats, meta,
    relationshipTypes, relationships] =
    await Promise.all([
      db.pins.count(), db.regions.count(), db.templates.count(), db.docLinks.count(),
      db.books.count(), db.chapters.count(), db.plotlines.count(), db.beats.count(),
      db.meta.count(), db.relationshipTypes.count(), db.relationships.count(),
    ])
  return { pins, regions, templates, docLinks, books, chapters, plotlines, beats, meta,
    relationshipTypes, relationships }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/worldMirrorSync.realdb.test.ts`
Expected: PASS — the whole file, not just the new test.

- [ ] **Step 5: Commit**

```bash
git add src/worldMirrorSync.ts src/worldMirrorSync.realdb.test.ts
git commit -m "feat: include relationship tables in the mirror change probe (#175)"
```

---

### Task 7: The Relations panel in the page aside

**Files:**
- Create: `src/components/Relations.tsx`
- Test: `src/components/Relations.test.tsx`
- Modify: `src/routes/PageRoute.tsx` (import + render after `<Infobox>`, around :301–314)
- Modify: `src/App.tsx` (:28 import, :105 seeding)
- Modify: `src/index.css` (append the `.relations-*` block)

**Interfaces:**
- Consumes: `relationshipRepo` (Task 4); `PageRelation` (Task 3).
- Produces: `<Relations page={page} editable={editing} />`.

- [ ] **Step 1: Seed the vocabulary at startup**

In `src/App.tsx`, add `seedRelationshipTypes` to the existing `./db` import at :28, and call it beside the others at :105:

```ts
    seedTemplates()
    seedDefaultCalendar()
    seedRelationshipTypes()
```

- [ ] **Step 2: Write the failing test**

Create `src/components/Relations.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Relations from './Relations'
import { db, seedRelationshipTypes, addRelationship, type LorePage } from '../db'

const uther: LorePage = {
  id: 'uther', title: 'Uther', titleLc: 'uther', category: 'Character',
  content: '', summary: '', tags: [], createdAt: 1, updatedAt: 1,
}

beforeEach(async () => {
  await db.relationships.clear()
  await db.relationshipTypes.clear()
  await db.pages.clear()
  await seedRelationshipTypes()
  await db.pages.bulkAdd([
    uther,
    { ...uther, id: 'arthur', title: 'Arthur', titleLc: 'arthur' },
  ])
})

// useLiveQuery components need this, or teardown throws "window is not defined".
afterEach(cleanup)

function renderPanel(editable: boolean) {
  return render(
    <MemoryRouter>
      <Relations page={uther} editable={editable} />
    </MemoryRouter>,
  )
}

describe('Relations', () => {
  it('renders nothing in view mode when the page has no relations', async () => {
    const { container } = renderPanel(false)
    // Let the useLiveQuery resolve before asserting emptiness.
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.relations')).toBeNull()
  })

  it('shows the add form in edit mode even with no relations', async () => {
    renderPanel(true)
    expect(await screen.findByText('Relations')).toBeTruthy()
  })

  it('renders the inverse label when the viewer is the `to` end', async () => {
    await addRelationship('arthur', 'uther', 'parent-of') // Uther is the `to`
    renderPanel(false)
    expect(await screen.findByText('Child of')).toBeTruthy()
    expect(await screen.findByText('Arthur')).toBeTruthy()
  })

  it('shows the note beside the row', async () => {
    await addRelationship('uther', 'arthur', 'spouse-of', 'm. 1042–1067')
    renderPanel(false)
    expect(await screen.findByText('m. 1042–1067')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/components/Relations.test.tsx`
Expected: FAIL — `Failed to resolve import "./Relations"`.

- [ ] **Step 4: Write the component**

Create `src/components/Relations.tsx`:

```tsx
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { relationshipRepo, categoryColor, type LorePage } from '../db'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'
import PagePicker from './PagePicker'

interface Props {
  page: LorePage
  editable: boolean
}

/** The "Relations" panel in the page aside: every typed relationship touching
 *  this page, resolved to its point of view. One merged list — with inverse
 *  labels there is no reader-visible difference between the two stored
 *  directions (see getRelationsFor). Quiet when empty in view mode, matching
 *  PageHistory. */
export default function Relations({ page, editable }: Props) {
  const relations = useLiveQuery(() => relationshipRepo.listFor(page.id), [page.id]) ?? []

  if (!editable && relations.length === 0) return null

  return (
    <section className="relations">
      <h2 className="relations-heading">Relations</h2>
      <ul className="relations-list">
        {relations.map((r) => (
          <li key={r.row.id} className="relations-row">
            <span className="relations-label" style={{ color: r.type.color }}>
              {r.label}
            </span>
            <Link
              to={`/page/${r.other.id}`}
              className="relations-target"
              onMouseEnter={(e) =>
                showPageHover(r.other.id, r.other.title, e.currentTarget.getBoundingClientRect())
              }
              onMouseLeave={scheduleWikiHoverClose}
            >
              <span className="dot" style={{ background: categoryColor(r.other.category) }} />
              {r.other.title}
            </Link>
            {r.row.note && <span className="relations-note">{r.row.note}</span>}
            {editable && (
              <button
                className="tag-x"
                title="Remove relationship"
                onClick={() => relationshipRepo.remove(r.row.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && <AddRelation page={page} />}
    </section>
  )
}

/** The edit-mode add form: pick a type, pick a page, optionally annotate. */
function AddRelation({ page }: { page: LorePage }) {
  const types = useLiveQuery(() => relationshipRepo.listTypes(), []) ?? []
  const [typeId, setTypeId] = useState('')
  const [target, setTarget] = useState<string[]>([])
  const [note, setNote] = useState('')

  const effectiveType = typeId || types[0]?.id || ''
  const canAdd = effectiveType !== '' && target.length > 0

  async function add() {
    if (!canAdd) return
    await relationshipRepo.add(page.id, target[0], effectiveType, note.trim())
    setTarget([])
    setNote('')
  }

  return (
    <div className="relations-add">
      <select
        className="relations-type-select"
        value={effectiveType}
        onChange={(e) => setTypeId(e.target.value)}
      >
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <PagePicker
        value={target}
        onChange={setTarget}
        multiple={false}
        placeholder="Find a page…"
      />
      <input
        className="infobox-value-input relations-note-input"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="mini-btn" disabled={!canAdd} onClick={add}>
        ＋ Add
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/components/Relations.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 6: Mount it in the page aside**

In `src/routes/PageRoute.tsx`, add the import beside the other component imports:

```ts
import Relations from '../components/Relations'
```

The infobox conditional ends with a `)}` at **:323**, immediately before
`{!editing && pinLocations.length > 0 && (` at :325. Insert between them:

```tsx
          <Relations page={page} editable={editing} />
```

- [ ] **Step 7: Add the styles**

Append to `src/index.css`:

```css
/* Typed relationships in the page aside (#175) */
.relations { margin-top: 20px; }
.relations-heading {
  font-size: 13px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ink-dim); margin: 0 0 8px;
}
.relations-list { list-style: none; margin: 0; padding: 0; }
.relations-row {
  display: flex; align-items: baseline; gap: 6px;
  padding: 3px 0; font-size: 14px;
}
.relations-label { flex-shrink: 0; font-size: 12px; }
.relations-target {
  display: inline-flex; align-items: center; gap: 5px;
  color: var(--link); text-decoration: none;
}
.relations-target:hover { text-decoration: underline; }
.relations-note { color: var(--ink-dim); font-size: 12px; font-style: italic; }
.relations-add {
  display: flex; flex-direction: column; gap: 6px;
  margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border);
}
.relations-type-select {
  background: var(--panel); color: var(--ink);
  border: 1px solid var(--border); border-radius: 4px; padding: 4px 6px; font-size: 13px;
}
.relations-note-input { font-size: 13px; }
```

- [ ] **Step 8: Verify the whole suite and the build**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass. Lint in particular confirms `Relations.tsx` never imported the `db` singleton.

- [ ] **Step 9: Commit**

```bash
git add src/components/Relations.tsx src/components/Relations.test.tsx src/routes/PageRoute.tsx src/App.tsx src/index.css
git commit -m "feat: Relations panel in the page aside (#175)"
```

---

### Task 8: Managing the vocabulary on /templates

**Files:**
- Create: `src/components/RelationshipTypesPanel.tsx`
- Test: `src/components/RelationshipTypesPanel.test.tsx`
- Modify: `src/routes/TemplatesRoute.tsx` (import + render below `.templates-layout`, which closes near :320)
- Modify: `src/index.css` (append the `.reltypes-*` block)

`TemplatesRoute.tsx` is already 327 lines with its own master/detail state. The new vocabulary goes in its own component so the route change stays three lines.

**Interfaces:**
- Consumes: `relationshipRepo` (Task 4); `TYPE_COLORS` (`db/schema.ts`).
- Produces: `<RelationshipTypesPanel />` — self-contained, no props.

- [ ] **Step 1: Write the failing test**

Create `src/components/RelationshipTypesPanel.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import RelationshipTypesPanel from './RelationshipTypesPanel'
import { db, seedRelationshipTypes } from '../db'

beforeEach(async () => {
  await db.relationshipTypes.clear()
  await db.relationships.clear()
  await seedRelationshipTypes()
})

afterEach(cleanup)

describe('RelationshipTypesPanel', () => {
  it('lists the seeded vocabulary with both labels', async () => {
    render(<RelationshipTypesPanel />)
    expect(await screen.findByDisplayValue('Parent of')).toBeTruthy()
    expect(await screen.findByDisplayValue('Child of')).toBeTruthy()
  })

  it('marks a type whose labels match as symmetric', async () => {
    render(<RelationshipTypesPanel />)
    // ally-of ships as "Ally of" / "Ally of".
    const hints = await screen.findAllByText('symmetric')
    expect(hints.length).toBeGreaterThan(0)
  })

  it('offers Reset but no Delete for a built-in', async () => {
    render(<RelationshipTypesPanel />)
    await screen.findByDisplayValue('Parent of')
    expect(screen.queryAllByTitle('Delete type')).toHaveLength(0)
    expect(screen.getAllByTitle('Restore shipped labels and colour').length).toBeGreaterThan(0)
  })

  it('adds a custom type, which does offer Delete', async () => {
    render(<RelationshipTypesPanel />)
    fireEvent.click(await screen.findByText('＋ Add type'))
    expect(await screen.findByDisplayValue('New relationship')).toBeTruthy()
    expect((await screen.findAllByTitle('Delete type')).length).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/RelationshipTypesPanel.test.tsx`
Expected: FAIL — `Failed to resolve import "./RelationshipTypesPanel"`.

- [ ] **Step 3: Write the component**

Create `src/components/RelationshipTypesPanel.tsx`:

```tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { relationshipRepo, TYPE_COLORS, type RelationshipGroup, type RelationshipType } from '../db'
import ConfirmDialog from './ConfirmDialog'

const GROUPS: RelationshipGroup[] = ['kin', 'faction', 'org', 'social', 'other']

/** The relationship-type vocabulary editor, shown below the page types on
 *  /templates. Both are the world's user-definable vocabularies, so they share
 *  a route; this lives in its own component because TemplatesRoute already
 *  carries its own master/detail state. */
export default function RelationshipTypesPanel() {
  const types = useLiveQuery(() => relationshipRepo.listTypes(), [])
  const [pendingDelete, setPendingDelete] = useState<RelationshipType | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)

  if (!types) return null

  async function askDelete(type: RelationshipType) {
    setDeleteCount(await relationshipRepo.countOfType(type.id))
    setPendingDelete(type)
  }

  return (
    <section className="reltypes">
      <h2>Relationship types</h2>
      <p className="templates-intro">
        How pages relate to each other. Each type reads one way from the page you
        add it on and the other way from the page it points at — “Parent of” from
        one end is “Child of” from the other. Give both ends the same wording to
        make a type symmetric.
      </p>

      <ul className="reltypes-list">
        {types.map((t) => (
          <li key={t.id} className="reltypes-row">
            <input
              className="reltypes-input"
              value={t.label}
              aria-label="Label"
              onChange={(e) => relationshipRepo.updateType(t.id, { label: e.target.value })}
            />
            <span className="reltypes-sep">/</span>
            <input
              className="reltypes-input"
              value={t.inverse}
              aria-label="Inverse label"
              onChange={(e) => relationshipRepo.updateType(t.id, { inverse: e.target.value })}
            />
            {t.label.trim().toLowerCase() === t.inverse.trim().toLowerCase() && (
              <span className="reltypes-symmetric">symmetric</span>
            )}
            <select
              className="reltypes-group"
              value={t.group}
              aria-label="Group"
              onChange={(e) =>
                relationshipRepo.updateType(t.id, { group: e.target.value as RelationshipGroup })
              }
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="reltypes-colors">
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${t.color === c ? ' is-active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => relationshipRepo.updateType(t.id, { color: c })}
                />
              ))}
            </span>
            {t.builtin ? (
              <button
                className="mini-btn"
                title="Restore shipped labels and colour"
                onClick={() => relationshipRepo.resetType(t.id)}
              >
                Reset
              </button>
            ) : (
              <button
                className="mini-btn danger"
                title="Delete type"
                onClick={() => askDelete(t)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      <button
        className="mini-btn template-new"
        onClick={() =>
          relationshipRepo.createType({
            label: 'New relationship', inverse: 'New relationship', group: 'other',
          })
        }
      >
        ＋ Add type
      </button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.label ?? ''}”?`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (pendingDelete) await relationshipRepo.removeType(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      >
        {deleteCount === 0
          ? 'No pages use this relationship type.'
          : `${deleteCount} relationship${deleteCount === 1 ? '' : 's'} using this type will be deleted too. This cannot be undone.`}
      </ConfirmDialog>
    </section>
  )
}
```

Note `ConfirmDialog`'s real API: it is always mounted and driven by an `open`
prop, and the body text is `children`, not a `message` prop.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/RelationshipTypesPanel.test.tsx`
Expected: PASS — 4 tests.

- [ ] **Step 5: Mount it on the route**

In `src/routes/TemplatesRoute.tsx`, add the import:

```ts
import RelationshipTypesPanel from '../components/RelationshipTypesPanel'
```

And render it after the closing `</div>` of `.templates-layout`, inside the outer `.templates-view` div:

```tsx
      <RelationshipTypesPanel />
```

- [ ] **Step 6: Add the styles**

Append to `src/index.css`:

```css
/* Relationship-type vocabulary on /templates (#175) */
.reltypes { margin-top: 40px; padding-top: 24px; border-top: 1px solid var(--border); }
.reltypes-list { list-style: none; margin: 12px 0; padding: 0; }
.reltypes-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 0; border-bottom: 1px solid var(--border); flex-wrap: wrap;
}
.reltypes-input {
  background: var(--panel); color: var(--ink); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 6px; font-size: 14px; width: 150px;
}
.reltypes-sep { color: var(--ink-dim); }
.reltypes-symmetric {
  font-size: 11px; color: var(--ink-dim); text-transform: uppercase;
  letter-spacing: 0.04em;
}
.reltypes-group {
  background: var(--panel); color: var(--ink); border: 1px solid var(--border);
  border-radius: 4px; padding: 4px 6px; font-size: 13px;
}
.reltypes-colors { display: inline-flex; gap: 3px; }
```

- [ ] **Step 7: Full verification**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all three pass.

- [ ] **Step 8: Commit and open the PR**

```bash
git add src/components/RelationshipTypesPanel.tsx src/components/RelationshipTypesPanel.test.tsx src/routes/TemplatesRoute.tsx src/index.css
git commit -m "feat: manage the relationship-type vocabulary on /templates (#175)"
git push -u origin feat/175-typed-relationships
gh pr create --fill --label version:minor
```

---

## Manual verification before merge

Automated tests do not cover the round trip through the real UI. Run `npm run dev` and confirm:

1. On a Character page in edit mode, add "Parent of" → another character. It appears in the aside.
2. Open the target page. It reads **"Child of"**, pointing back. This is the whole feature.
3. Add "Ally of" from one page; the other shows "Ally of" too. Try adding it again from the other side — it is refused.
4. On `/templates`, rename "Enemy of" to "Sworn enemy of". The existing relationship's label updates on both pages.
5. Give a type the same text in both fields; the "symmetric" hint appears.
6. Add a custom type, use it, then delete it — the confirmation names the right count and the relationships go with it.
7. Delete a page that has relations; the far page's list drops the row rather than showing a blank.
8. Settings → export a backup, then import it. Relationship counts appear in the confirmation and the relations survive.
