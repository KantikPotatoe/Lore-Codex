# Hierarchical sidebar navigation — grouped page types (#115)

**Status:** design · **Date:** 2026-08-31 · **Issue:** [#115](https://github.com/KantikPotatoe/Lore-Codex/issues/115)

---

## 1. The problem

The sidebar groups pages by `page.category` and renders one flat, alphabetically
sorted list of headers (`Sidebar.tsx:48-57`). The app ships **19 built-in page
types** (`templates.ts`, `builtin: true`), so a world that uses most of them
presents 19 sibling headers with no structure. Finding "Settlement" means
scanning a list in which it sits between "Religion" and "Species" for no reason
other than the alphabet.

## 2. What "nested categories" must *not* mean

`page.category` is overloaded. It is simultaneously:

1. the **page type** — `defaultInfobox` resolves the starter infobox by
   `t.name === category` (`templates.ts:249`), `CategoryRoute` resolves the
   map-pin glyph the same way (`CategoryRoute.tsx:15`), and `categoryColor()`
   keys the colour cache on it;
2. the **sidebar grouping key** (`Sidebar.tsx:52`);
3. the **`/browse/:category` collection** (`CategoryRoute`, `listByCategory`).

The obvious-looking approach — storing a path such as `"Places/Settlement"` in
`page.category` — is therefore **rejected**. It silently breaks every lookup in
(1), because no template is named `"Places/Settlement"`, and it prints the full
path into the ~20 sites that render the category as a chip or dot
(`SearchModal.tsx:154`, `WikiLinkPopover.tsx:92`, `Backlinks.tsx:33`,
`MapPreviewCard.tsx:31`, `htmlExport.ts:94`, graph nodes via `graphColor.ts:68`,
and others). It also forces a new page *type* for every folder.

**Instead, this groups the types themselves.** A page keeps exactly one type;
`page.category` is untouched; the grouping lives on the type. Nothing in (1) or
(3) changes, and no page record is migrated.

Per-page folders independent of type — where a Character and a Settlement share
a folder — are a genuinely different feature requiring a new `LorePage` field,
migration, backup and import handling. Out of scope; see §8.

## 3. Data model

One optional field on the page type:

```ts
export interface InfoboxTemplate {
  …
  /** Sidebar group this type belongs to. Absent ⇒ never set (eligible for
   *  backfill); '' ⇒ deliberately ungrouped by the user, never re-backfilled. */
  group?: string
}
```

Plus a defaults map beside `BUILTIN_SECTIONS`:

```ts
const BUILTIN_GROUPS: Record<string, string> = {
  Country: 'Places',      Geography: 'Places',       Settlement: 'Places',
  Character: 'People',    Organization: 'People',    Species: 'People',
  Deity: 'Belief',        Religion: 'Belief',        Myth: 'Belief',
  Culture: 'Society',     Language: 'Society',       Tradition: 'Society',
  Item: 'Things',         Material: 'Things',        Technology: 'Things',
  Spell: 'Things',
  Conflict: 'Events & Records', Document: 'Events & Records',
  Condition: 'Events & Records',
}
```

All 19 built-ins are assigned. No group name equals a type name — deliberate, so
the UI never shows a "Culture" group whose only distinct child is "Language".
(The code still handles that collision safely; see §5.)

### 3.1 Backfill

`seedTemplates()` gains a fourth backfill pass, mirroring the existing
colour/icon/sections passes and living **inside the same `rw` transaction** so
the seed stays concurrency-safe under StrictMode's double-invoked effect (#95):

```ts
const needGroup = afterSeed.filter(
  (t) => t.builtin && t.group === undefined && BUILTIN_GROUPS[t.name],
)
```

The `undefined` vs `''` sentinel is the whole point: it is what lets "I
deliberately ungrouped Spell" survive every future reseed, exactly as
`sections === undefined` protects a user's section choices today.

Custom types (`builtin: false`) are never touched, consistent with the rest of
`seedTemplates()`.

### 3.2 Why no schema-version bump

CLAUDE.md requires bumping `CURRENT_SCHEMA_VERSION` and adding a `MIGRATIONS`
step "when the exported shape changes", and states that the constant **mirrors
the Dexie store version**. `group` is not indexed, so no Dexie `version()` block
changes, and the store version stays at v15.

The field is additive and optional: an older backup simply lacks it, which reads
as `undefined` — the "never set" state the backfill already handles. `importAll()`
re-seeds built-ins after importing an older backup, so a v15 backup restored
into this build comes out grouped. A backup written by *this* build and restored
into an older one carries an unknown key that Dexie stores harmlessly.

No bump, no migration step. This reasoning is recorded here because the rule's
trigger is worded loosely enough to look violated.

## 4. Pure core — `src/sidebarTree.ts`

Following the established pure-core idiom (`autolink.ts`, `pageChronology.ts`,
`timelineDisplay.ts`, `graphMinimap.ts`): no React, no Dexie, fully unit-tested.

```ts
export type SidebarTypeNode  = { kind: 'type';  category: string; pages: LorePage[] }
export type SidebarGroupNode = { kind: 'group'; name: string; count: number
                                 children: SidebarTypeNode[] }
export type SidebarNode = SidebarTypeNode | SidebarGroupNode

export function buildSidebarTree(
  pages: LorePage[],
  templates: InfoboxTemplate[],
): SidebarNode[]
```

Rules, in order:

1. **Bucket pages by `page.category`**, exactly as `Sidebar.tsx:52` does today.
   The tree is driven by *the categories actually present on pages*, not by the
   template list. This preserves a behaviour that is easy to lose: a page whose
   category has no matching template still appears in the sidebar.
2. **Look up each category's group** from the template whose `name` matches. No
   template, or `group` absent/`''`/whitespace-only ⇒ the type is ungrouped.
   Group names are compared as trimmed strings, **case-sensitively** (§6).
3. **Emit groups and ungrouped types as siblings**, sorted together by
   `localeCompare` on display name — matching the current sort
   (`Sidebar.tsx:56`). Types inside a group sort the same way.
4. A group's `count` is the total pages across its child types.

An empty group cannot occur: groups are derived from the types present, so a
group with no pages is never emitted.

**The degradation property:** if every type is ungrouped, `buildSidebarTree`
returns exactly today's flat, alphabetical list. That makes the feature
reversible by the user and gives the tests a clean baseline.

## 5. Sidebar rendering

`templates` is **already** live-queried (`Sidebar.tsx:35`), so no new query is
needed — the memo gains a dependency.

- **Group header:** chevron + label + total count. A `button`, not a `Link` —
  there is no `/browse` route for a group (§8). Type headers keep their existing
  `/browse/:category` links unchanged, so nothing clickable today stops working.
- **Collapse state:** reuses `sidebarPrefs`, which already namespaces pseudo-groups
  via the `RECENT_GROUP` / `TAGS_GROUP` sentinels. Group entries are stored with a
  `group:` prefix (`group:Places`), so a group and a *type* of the same name
  cannot share a collapse state. Existing stored bare-name entries continue to
  work untouched — no migration of `localStorage`.
- A group and its child types collapse independently; collapsing a group hides
  its children entirely without disturbing their own states.

## 6. Editing a group

`TemplatesRoute.tsx` gains a group field beside name/colour: a text input backed
by a `<datalist>` of the group names currently in use.

Matching is on the **trimmed, case-sensitive** string. The datalist is what
prevents `places`/`Places` from splintering into two groups — chosen over
case-insensitive folding, which would then need a rule for which casing to
display and would make renaming a group's capitalisation impossible.

Clearing the field stores `''` — the "deliberately ungrouped" sentinel from §3.1,
which the backfill will never overwrite. Renaming a group means retyping the
label on each member type; with six default groups and a datalist this is
acceptable, and a first-class rename belongs with a first-class group entity
(§8).

## 7. Testing

The weight sits on pure tests of `buildSidebarTree`:

- Groups and ungrouped types interleave in one alphabetical sort.
- A custom type with no group appears at top level (the common case after
  backfill, which only touches built-ins).
- **A page whose category matches no template still appears**, ungrouped — the
  regression guard for rule 1 in §4.
- `group: ''` and whitespace-only `group` both read as ungrouped.
- All types ungrouped ⇒ output is identical to the flat list (the degradation
  property).
- Group `count` sums its child types.

In `src/db/templates.test.ts`:

- The backfill assigns groups to built-ins with `group === undefined`.
- A built-in with `group: ''` survives a reseed still ungrouped.
- A custom type is never assigned a group.
- Reseeding twice is idempotent.

One case added to the existing `src/components/Sidebar.test.tsx` for the `group:`
collapse-key namespacing: a group and a type sharing a name collapse
independently. Per the repo's `useLiveQuery` testing note, the file's
`afterEach(cleanup)` must cover it, or teardown throws "window is not defined".

## 8. Out of scope

- **A `/browse` route for a group.** Would need a `listByCategories` repo method
  and a decision about `CategoryRoute`'s "+ New {category}" action, which has no
  single type to create for a group. Deliberately deferred.
- **Group colours.** Type colours already carry the visual weight; a second
  colour axis competes with them.
- **Arbitrary nesting depth** (a `parentId` tree). Rejected for cycle detection,
  orphaned-parent handling on delete, and the "is a parent selectable as a page
  type?" question — none of which the two-level model has.
- **A first-class group entity** with id, ordering and drag-reorder. The `group?:
  string` label is the YAGNI choice; a real entity is the upgrade path if
  ordering or rename tooling is ever wanted.
- **Per-page folders independent of type** (§2). A separate issue if wanted.

## 9. Accepted risk

Backfilling groups **visibly reorganises the sidebar of every existing world on
upgrade**. This is intended — the alternative leaves the feature inert until 19
manual edits are made — and it is reversible per-type by clearing the group
field, which then sticks permanently via the `''` sentinel.
