# Typed relationships primitive — design

**Issue:** #175 · **Date:** 2026-07-22 · **Status:** approved, not yet implemented

Links today are untyped `[[mentions]]`: the app knows Arthur references Uther,
but not that Uther is his *father* rather than his *enemy*. Family trees (#136)
and diplomacy webs (#137) are both views over data the model cannot express.
Building either one first means building the relationship model twice, in two
shapes that then have to be reconciled.

This spec covers the data model, CRUD, the page-aside editor, the type-vocabulary
admin, and backup/mirror coverage. The views stay in their own issues.

---

## 1. Data model

Two tables. One holds the vocabulary, one holds the facts.

```ts
/** Which view a type feeds. #136 filters to 'kin', #137 to 'faction'/'org'. */
export type RelationshipGroup = 'kin' | 'faction' | 'org' | 'social' | 'other'

/** A user-definable kind of relationship, with how it reads from each end. */
export interface RelationshipType {
  id: string
  label: string      // reads from the `from` page:  "Parent of"
  inverse: string    // reads from the `to` page:    "Child of"
  color: string
  group: RelationshipGroup
  order: number      // display order in pickers and the aside
  builtin: boolean
}

/** One directed fact: `fromId` is `type.label` of `toId`. */
export interface Relationship {
  id: string
  fromId: string
  toId: string
  typeId: string
  note: string       // '' when none
  createdAt: number
}
```

### One row per fact

A relationship is stored **once**, directed, and rendered from both ends by
consulting `label` or `inverse`. The rejected alternative was writing two
mirrored rows (`Uther→Arthur parent-of` plus `Arthur→Uther child-of`) so each
page reads only its outgoing edges. That buys simpler queries and pays for them
with a class of bug the app cannot detect: edit or delete one row, miss its twin,
and the world quietly disagrees with itself. One row cannot desync from itself.

### Symmetry is derived, not stored

A type is symmetric when `label === inverse` after trimming and case-folding.
This is the definition, not a shortcut — if both ends read "Ally of", the
relationship *is* symmetric, and there is no second field that can contradict it.

It is load-bearing beyond display. Duplicate detection depends on it: for
`ally-of`, `(A→B)` and `(B→A)` are the same fact and the second must be refused;
for `parent-of` they are different rows. Both being present is a kinship cycle —
wrong, but the author's business to resolve and #136's problem to render, not
something this layer forbids.

### The `note` field

One optional free-text string, rendered small beside the row. It covers the
issue's "optional in-world dates" (`m. 1042–1067`) and everything else
(`estranged since the Siege`) at near-zero cost.

Calendar-backed dates — `calendarId` plus cached `startAbsolute`/`endAbsolute`,
like `TimelineEvent` — were considered and rejected for now. They would duplicate
`EventEditor`'s date-entry UI, join `updateCalendar()`'s obligation to recompute
every dependent row, and require cascade-on-calendar-delete. That is a large
fraction of this issue's total cost for something no planned view consumes:
nothing in #136 or #137 sorts or positions by relationship date. Birth order in a
family tree comes from the pages, not the edges.

### Seeded built-ins

| id | label | inverse | group |
|---|---|---|---|
| `parent-of` | Parent of | Child of | kin |
| `sibling-of` | Sibling of | Sibling of | kin |
| `spouse-of` | Spouse of | Spouse of | kin |
| `ally-of` | Ally of | Ally of | faction |
| `enemy-of` | Enemy of | Enemy of | faction |
| `member-of` | Member of | Has member | org |

The `group` field is what lets #136 ask "which types are kinship?" without
hardcoding ids — including for types the user invents. A user-defined
"Mentor of / Student of" tagged `social` is a first-class citizen; a user-defined
"Half-sibling of" tagged `kin` appears in the family tree automatically.

---

## 2. Module layout

### `src/relations.ts` — pure

Type-only imports, so it stays out of `src/db/` per the placement rule in
CLAUDE.md (a runtime `db` import would drag in the Dexie singleton).

```ts
isSymmetric(type: RelationshipType): boolean
resolveRelation(row, type, viewerId): { label, otherId, color }
```

`resolveRelation` is the one genuinely subtle piece of the feature: `viewerId ===
row.fromId` yields `type.label` with `toId` as the other end; `viewerId ===
row.toId` yields `type.inverse` with `fromId`. Two branches, fully unit-testable
without a database.

**Every consumer goes through it** — the aside today, #136 and #137 later —
rather than re-deriving the inversion. Direction logic scattered across three
views is how the two views end up disagreeing about what "parent" means.

### `src/db/relationshipTypes.ts` — vocabulary

`BUILTIN_RELATIONSHIP_TYPES`, `seedRelationshipTypes()`, CRUD,
`resetRelationshipType()`.

Built-ins hold `order` 0..5 in the table above. A newly created type appends at
`max(order) + 1` rather than `count`, so creating a type after deleting one never
collides with an existing order — the same reasoning as `attachDocument`.

`seedRelationshipTypes()` copies `seedTemplates()`'s rw-transaction guard
verbatim. React StrictMode double-invokes the startup effect in dev; without the
transaction both calls read an empty table, both `bulkAdd` the built-ins, and the
loser rejects with a duplicate-key `BulkError`.

**Deliberate divergence from templates:** built-in relationship types can be
edited and reset but not deleted — the delete control is absent for them.
Deleting a built-in *template* today is futile, because the next `seedTemplates()`
re-adds it; that wart should not be copied into new code. Deleting a **custom**
type cascades its relationships behind a `ConfirmDialog` showing the count,
matching how `deleteCalendar` cascades its events.

### `src/db/relationships.ts` — edges

CRUD plus the joined read. Depends on `relationshipTypes.ts` to render labels;
the dependency runs one way. Same vocabulary/content split as `templates.ts` vs
`pages.ts`.

**Guards live here, not in the component** (matching `attachDocument`'s
"no-op on self or duplicate" shape):

- `fromId === toId` — refused.
- Duplicate `(from, to, type)` — refused; **order-insensitive for symmetric
  types**, so `ally-of` cannot be added twice from opposite ends.

### `getRelationsFor(pageId)` — one list, not two panels

Queries both the `fromId` and `toId` indexes, resolves each row through
`resolveRelation`, and returns a single merged list sorted by `type.order` then
target title.

This is a deliberate departure from `DocumentLinks`, which shows "Documents" and
"Attached to" as separate panels. There, the two directions genuinely differ to
the reader. Here they do not: with inverse labels, "Parent of ● Arthur" and
"Child of ● Uther" are both simply *relations of this page*. Splitting them would
surface an implementation detail — which end happened to be typed first — as a
user-visible distinction that means nothing.

Deletion is by row id, so it works identically from either end.

---

## 3. UI

### `src/components/Relations.tsx` — page aside

Slots into `.page-aside` (`PageRoute.tsx:301`) between `<Infobox>` and
`<Backlinks>`. Relations are structured facts about the subject, the same kind of
thing the infobox holds, so they belong where the reader already looks for facts.

Follows `PageHistory`'s conventions: renders nothing in view mode when there are
no relations; editors appear only when `editing`.

```
Relations
  Parent of   ● Arthur                    ×
  Spouse of   ● Igraine   m. 1042–1067    ×
  Enemy of    ● Gorlois   until the Siege ×
  ─────────────────────────────────────
  [ Spouse of ▾ ] [ find a page… ] [ note ]  ＋
```

Rows reuse the type-dot and hover-preview treatment from `DocumentLinks`'
`DocRow` (`showPageHover` / `scheduleWikiHoverClose`), so a relation behaves like
every other page reference in the app.

The target picker is the existing `PagePicker` with `multiple={false}` over a
transient value. `DocumentLinks` rolled its own local `DocPicker` because
`PagePicker` did not exist yet; there is no reason to grow a third.

As UI, this component reaches data through `relationshipRepo` only — never the
`db` singleton. Lint enforces it.

### `/templates` — Relationship types section

A second section below the existing page-type list: label / inverse / group /
colour per row, with edit and delete controls and an `＋ Add type` button.
Built-ins offer *reset* instead of delete.

When label and inverse are typed identically the editor shows a quiet "symmetric"
hint, so the derived rule is visible rather than mysterious.

The route already exists to manage the world's other user-definable vocabulary
(page types), so this needs no new nav entry and reuses the same seeding and
reset idiom.

An earlier draft also put a `＋ New type…` shortcut in the aside's type
dropdown, so a type could be invented without leaving the page. It is cut: a
type needs a label, an inverse and a group, which is a form rather than a menu
item, and the six built-ins cover the common cases. Revisit if creating types
turns out to be frequent enough that the trip to `/templates` grates.

---

## 4. Integration surface

A new table touches more places than the feature suggests. All of these are
required for the feature to be correct, not optional polish:

| Where | What |
|---|---|
| `db/types.ts` | the two interfaces |
| `db/schema.ts` | two tables in a new **v15** block: `relationshipTypes: 'id, order'`, `relationships: 'id, fromId, toId, typeId'`. New tables ⇒ no data migration |
| `db/relationshipTypes.ts`, `db/relationships.ts` | new modules |
| `db/index.ts` | barrel re-export — `barrel.test.ts` fails otherwise |
| `db/repositories.ts` | `relationshipRepo`, so the aside never reaches past the seam |
| `db/pages.ts` `deletePage` | cascade **both** directions (`fromId` and `toId`), as `docLinks` does at :109–110. Already uses the array form of `transaction`, so the 5-table varargs cap is not in play |
| `db/backup.ts` | payload type · `counts` · `exportAll` · `parseBackup` counts · `importAll` · `importBackupInto` · `MIGRATIONS[14]` defaulting both new tables to `[]` via `asArray` (the same shape as `MIGRATIONS[9]` for `docLinks`) · `CURRENT_SCHEMA_VERSION` → 15 |
| `worldMirrorSync.ts` | join the `count()` group in `mirrorChangeTime()` |
| `App.tsx` | `seedRelationshipTypes()` beside `seedTemplates()` |

**Mirror caveat, inherited not introduced:** relationship rows carry no
`updatedAt`, so they join the nine tables `mirrorChangeTime()` detects only by
`count()`. An in-place edit — changing a row's note or type — is invisible to the
poll between adds and deletes. This is the documented, accepted shape of the
mirror; `flushWorldMirror()` on close is the backstop for exactly this.

**No sanitization needed.** `note` is plain text rendered as text, which React
escapes; nothing in this feature reaches a raw HTML sink. Stated explicitly so a
future reader does not wonder whether it was overlooked.

---

## 5. Out of scope

- **Graph edges stay untyped.** The issue's scope note is explicit; typed and
  coloured edges land with #137.
- **`htmlExport.ts` untouched.** It already omits `docLinks`, so relations follow
  the existing precedent rather than inventing a new one. Worth a follow-up issue
  covering both together.
- No tree layout (#136), no faction view (#137), no auto-generated infobox
  "Relations" section.

---

## 6. Testing

`src/relations.test.ts` (pure) carries the weight:

- `resolveRelation` from the `from` end and the `to` end
- symmetric vs asymmetric types
- `isSymmetric` across whitespace and case variants

`src/db/relationships.test.ts`:

- self-relation refused
- duplicate refused, **both orderings**, for a symmetric type
- duplicate refused for an asymmetric type in the same direction, allowed in the
  opposite direction
- `deletePage` cascades rows on both `fromId` and `toId`
- deleting a custom type cascades its relationships
- `getRelationsFor` merges both directions in `type.order` then title order

`src/db/relationshipTypes.test.ts`:

- `seedRelationshipTypes()` is idempotent under concurrent invocation, mirroring
  the existing templates concurrency test

`src/db/backup.test.ts`:

- round-trip: both new tables survive export → parse → import
- a pre-v15 backup imports cleanly, with the new tables defaulting to empty

`src/components/Relations.test.tsx`:

- renders nothing in view mode with no relations
- editors appear only in edit mode
- a row renders the inverse label when the viewer is the `to` end

---

## 7. Verification

`npm run lint && npm run build && npm run test:run` all green before the PR.
Label the PR `version:minor` — this is a new feature.
