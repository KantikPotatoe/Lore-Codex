# Hierarchical Sidebar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group the 19 built-in page types under six collapsible sidebar groups, so the sidebar stops being a flat 19-item alphabetical list.

**Architecture:** An optional `group?: string` on `InfoboxTemplate` (the page type), backfilled onto built-ins by `seedTemplates()`. A new pure module `src/sidebarTree.ts` turns pages + templates into a two-level node list; `Sidebar.tsx` renders it. `page.category` is never touched, so no page migration and no change to the ~20 sites that render a category chip.

**Tech Stack:** React 19, TypeScript (strict), Dexie 4 + dexie-react-hooks, Vitest + happy-dom + fake-indexeddb, React Router 7.

**Spec:** [`docs/superpowers/specs/2026-08-31-hierarchical-navigation-design.md`](../specs/2026-08-31-hierarchical-navigation-design.md) · **Issue:** [#115](https://github.com/KantikPotatoe/Lore-Codex/issues/115)

## Global Constraints

- **Branch:** `feat/115-hierarchical-navigation`, already created from `origin/main`. The spec is already committed on it.
- **Never edit `page.category`.** It is the page-type key: `defaultInfobox` matches `t.name === category` (`templates.ts:249`) and `CategoryRoute.tsx:15` resolves the pin glyph the same way. Grouping lives on the template only.
- **No Dexie `version()` change, no `CURRENT_SCHEMA_VERSION` bump, no `MIGRATIONS` step.** `group` is non-indexed; store stays v12. See spec §3.2.
- **`undefined` vs `''` is load-bearing.** `group === undefined` means "never set" (eligible for backfill); `group === ''` means "user deliberately ungrouped" and must survive every reseed forever.
- **Backfill runs inside the existing `rw` transaction** in `seedTemplates()` — it is what keeps the seed safe under StrictMode's double-invoked startup effect (#95).
- **Custom types (`builtin: false`) are never assigned a group** by any automated pass.
- TS `strict`. Run `npm run lint`, `npm run build`, and `npm run test:run` before claiming done — all three are CI-gated on `verify`.
- Imports in UI code go through the repository seam (`templateRepo`, `pageRepo`), never the `db` singleton. Tests are exempt.

---

### Task 1: `group` field, defaults map, and seed backfill

**Files:**
- Modify: `src/db/types.ts:182-190` (the `InfoboxTemplate` interface)
- Modify: `src/db/templates.ts:63` (add `BUILTIN_GROUPS` after `BUILTIN_SECTIONS`)
- Modify: `src/db/templates.ts:229-234` (add a fourth backfill pass inside the existing transaction)
- Test: `src/db/templates.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `InfoboxTemplate.group?: string`; `BUILTIN_GROUPS: Record<string, string>` exported from `src/db/templates.ts`. Both reach call sites via `'../db'` — the barrel already does `export * from './templates'`, so **no edit to `src/db/index.ts` is needed**.

- [ ] **Step 1: Write the failing tests**

Add to `src/db/templates.test.ts`. Import `BUILTIN_GROUPS` alongside the existing `BUILTIN_SECTIONS` import at the top of the file. Place this block next to the existing sections-backfill test (~line 141), inside the `describe('seedTemplates')` block:

```ts
  it('backfills a default group on a built-in that has none, leaving a cleared one alone', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => t.name === 'Settlement')!
    await db.templates.add({ ...a, group: undefined })
    const b = BUILTIN_TEMPLATES.find((t) => t.name === 'Spell')!
    await db.templates.add({ ...b, group: '' }) // user deliberately ungrouped

    await seedTemplates()

    expect((await db.templates.get(a.id))!.group).toBe(BUILTIN_GROUPS[a.name])
    expect((await db.templates.get(b.id))!.group).toBe('')
  })

  it('never assigns a group to a custom type', async () => {
    await db.templates.add({
      id: 'custom-1', name: 'Heraldry', color: '#abc', builtin: false, items: [],
    })

    await seedTemplates()

    expect((await db.templates.get('custom-1'))!.group).toBeUndefined()
  })

  it('assigns a group to every shipped built-in', async () => {
    await seedTemplates()

    const all = await db.templates.toArray()
    const builtins = all.filter((t) => t.builtin)
    expect(builtins.length).toBe(19)
    for (const t of builtins) {
      expect(t.group, `${t.name} has no group`).toBeTruthy()
    }
  })

  it('does not use a group name that collides with a type name', () => {
    const typeNames = new Set(BUILTIN_TEMPLATES.map((t) => t.name))
    for (const group of new Set(Object.values(BUILTIN_GROUPS))) {
      expect(typeNames.has(group), `group "${group}" collides with a type name`).toBe(false)
    }
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/db/templates.test.ts
```

Expected: FAIL — `BUILTIN_GROUPS` is not exported (TypeScript/import error).

- [ ] **Step 3: Add the `group` field to the type**

In `src/db/types.ts`, inside `interface InfoboxTemplate`, after the `sections?: string[]` line:

```ts
  /** Sidebar group this type belongs to (#115). Absent ⇒ never set, so
   *  seedTemplates() may backfill it; '' ⇒ deliberately ungrouped by the
   *  user, and never re-backfilled. */
  group?: string
```

- [ ] **Step 4: Add the defaults map**

In `src/db/templates.ts`, immediately after the `BUILTIN_SECTIONS` object closes (line 63):

```ts
// Default sidebar groups for the shipped page types (#115). Backfilled onto
// built-ins by seedTemplates() without overwriting a user's choice (mirrors the
// icon/colour/sections backfill). Two levels only: group → type → pages.
// No group name equals a type name, so the sidebar never shows a "Culture"
// group whose only distinct child is "Language".
export const BUILTIN_GROUPS: Record<string, string> = {
  Country: 'Places', Geography: 'Places', Settlement: 'Places',
  Character: 'People', Organization: 'People', Species: 'People',
  Deity: 'Belief', Religion: 'Belief', Myth: 'Belief',
  Culture: 'Society', Language: 'Society', Tradition: 'Society',
  Item: 'Things', Material: 'Things', Technology: 'Things', Spell: 'Things',
  Conflict: 'Events & Records', Document: 'Events & Records',
  Condition: 'Events & Records',
}
```

- [ ] **Step 5: Add the backfill pass**

In `src/db/templates.ts`, inside `seedTemplates()`'s `db.transaction('rw', ...)` callback, directly after the `needSections` `await Promise.all(...)` (line 234) and before the callback closes:

```ts
    // Backfill default sidebar groups the same way. `group: ''` means the user
    // deliberately ungrouped the type, so `=== undefined` (never set) is the
    // only state eligible for backfill.
    const needGroup = afterSeed.filter(
      (t) => t.builtin && t.group === undefined && BUILTIN_GROUPS[t.name],
    )
    await Promise.all(
      needGroup.map((t) => db.templates.update(t.id, { group: BUILTIN_GROUPS[t.name] })),
    )
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx vitest run src/db/templates.test.ts
```

Expected: PASS, including the pre-existing seed tests (the double-`seedTemplates()` StrictMode test must still pass — it proves the new pass is inside the transaction).

- [ ] **Step 7: Commit**

```bash
git add src/db/types.ts src/db/templates.ts src/db/templates.test.ts
git commit -m "feat: group page types and backfill defaults onto built-ins (#115)"
```

---

### Task 2: Pure `buildSidebarTree`

**Files:**
- Create: `src/sidebarTree.ts`
- Test: `src/sidebarTree.test.ts` (create)

**Interfaces:**
- Consumes: `InfoboxTemplate.group` from Task 1.
- Produces: `buildSidebarTree(pages, templates): SidebarNode[]`, plus exported types `SidebarNode`, `SidebarTypeNode`, `SidebarGroupNode`. Task 3 imports all four from `'../sidebarTree'`.

**Placement note:** this lives at `src/`, not `src/db/`, because it imports **types only** from `'./db'`. A runtime `db` import would drag in the Dexie singleton and would have to move under `src/db/`. Use `import type`.

- [ ] **Step 1: Write the failing tests**

Create `src/sidebarTree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSidebarTree } from './sidebarTree'
import type { LorePage, InfoboxTemplate } from './db'

const page = (title: string, category: string): LorePage =>
  ({ id: title, title, category, content: '', tags: [] }) as unknown as LorePage

const tpl = (name: string, group?: string): InfoboxTemplate =>
  ({ id: name, name, color: '#000', builtin: true, items: [], group }) as InfoboxTemplate

describe('buildSidebarTree', () => {
  it('nests types under their group and sums the count', () => {
    const tree = buildSidebarTree(
      [page('Eldoria', 'Settlement'), page('Karth', 'Settlement'), page('Valmara', 'Country')],
      [tpl('Settlement', 'Places'), tpl('Country', 'Places')],
    )

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ kind: 'group', name: 'Places', count: 3 })
    const group = tree[0] as Extract<typeof tree[0], { kind: 'group' }>
    expect(group.children.map((c) => c.category)).toEqual(['Country', 'Settlement'])
  })

  it('interleaves groups and ungrouped types in one alphabetical sort', () => {
    const tree = buildSidebarTree(
      [page('A', 'Settlement'), page('B', 'Heraldry'), page('C', 'Ship')],
      [tpl('Settlement', 'Places'), tpl('Heraldry'), tpl('Ship')],
    )

    expect(tree.map((n) => (n.kind === 'group' ? n.name : n.category))).toEqual([
      'Heraldry', 'Places', 'Ship',
    ])
  })

  it('keeps a page whose category has no template, ungrouped', () => {
    const tree = buildSidebarTree([page('Orphan', 'Ghost')], [])

    expect(tree).toEqual([
      { kind: 'type', category: 'Ghost', pages: [expect.objectContaining({ title: 'Orphan' })] },
    ])
  })

  it('treats empty and whitespace-only groups as ungrouped', () => {
    const tree = buildSidebarTree(
      [page('A', 'Spell'), page('B', 'Item')],
      [tpl('Spell', ''), tpl('Item', '   ')],
    )

    expect(tree.every((n) => n.kind === 'type')).toBe(true)
  })

  it('returns the flat alphabetical list when nothing is grouped', () => {
    const pages = [page('A', 'Item'), page('B', 'Character')]
    const tree = buildSidebarTree(pages, [tpl('Item'), tpl('Character')])

    expect(tree).toEqual([
      { kind: 'type', category: 'Character', pages: [pages[1]] },
      { kind: 'type', category: 'Item', pages: [pages[0]] },
    ])
  })

  it('trims a group name and groups case-sensitively', () => {
    const tree = buildSidebarTree(
      [page('A', 'Settlement'), page('B', 'Country')],
      [tpl('Settlement', '  Places  '), tpl('Country', 'places')],
    )

    expect(tree.map((n) => (n.kind === 'group' ? n.name : n.category))).toEqual([
      'Places', 'places',
    ])
  })

  it('preserves page order within a type', () => {
    const pages = [page('Zed', 'Item'), page('Abe', 'Item')]
    const tree = buildSidebarTree(pages, [tpl('Item')])

    expect((tree[0] as { pages: LorePage[] }).pages.map((p) => p.title)).toEqual(['Zed', 'Abe'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/sidebarTree.test.ts
```

Expected: FAIL — cannot resolve `./sidebarTree`.

- [ ] **Step 3: Write the implementation**

Create `src/sidebarTree.ts`:

```ts
import type { LorePage, InfoboxTemplate } from './db'

// Pure shaping of the sidebar's two-level page tree (#115). No React, no Dexie
// — it imports types only, which is why it lives at src/ rather than src/db/.
//
// The tree is driven by the categories actually present on pages, exactly as
// the flat sidebar was: a page whose category has no matching template still
// appears (ungrouped). Templates only supply the grouping.

export interface SidebarTypeNode {
  kind: 'type'
  category: string
  pages: LorePage[]
}

export interface SidebarGroupNode {
  kind: 'group'
  name: string
  count: number
  children: SidebarTypeNode[]
}

export type SidebarNode = SidebarTypeNode | SidebarGroupNode

/** Display name a node sorts under: groups and lone types sort as one list. */
const sortName = (node: SidebarNode): string =>
  node.kind === 'group' ? node.name : node.category

export function buildSidebarTree(
  pages: LorePage[],
  templates: InfoboxTemplate[],
): SidebarNode[] {
  // Bucket pages by category, preserving the order they arrive in.
  const byCategory = new Map<string, LorePage[]>()
  for (const p of pages) {
    const list = byCategory.get(p.category) ?? []
    list.push(p)
    byCategory.set(p.category, list)
  }

  // Group name per type name. A missing template, or a blank group, is
  // ungrouped. Compared case-sensitively after trimming — the datalist in the
  // page-type editor is what prevents "places"/"Places" splintering.
  const groupOf = new Map<string, string>()
  for (const t of templates) {
    const group = t.group?.trim()
    if (group) groupOf.set(t.name, group)
  }

  const top: SidebarNode[] = []
  const groups = new Map<string, SidebarGroupNode>()

  for (const [category, list] of byCategory) {
    const node: SidebarTypeNode = { kind: 'type', category, pages: list }
    const groupName = groupOf.get(category)

    if (!groupName) {
      top.push(node)
      continue
    }

    let group = groups.get(groupName)
    if (!group) {
      group = { kind: 'group', name: groupName, count: 0, children: [] }
      groups.set(groupName, group)
      top.push(group)
    }
    group.children.push(node)
    group.count += list.length
  }

  for (const group of groups.values()) {
    group.children.sort((a, b) => a.category.localeCompare(b.category))
  }

  return top.sort((a, b) => sortName(a).localeCompare(sortName(b)))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/sidebarTree.test.ts
```

Expected: PASS, all 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/sidebarTree.ts src/sidebarTree.test.ts
git commit -m "feat: pure two-level sidebar tree builder (#115)"
```

---

### Task 3: Render the tree in the sidebar

**Files:**
- Modify: `src/sidebarPrefs.ts` (add the `group:` key helper)
- Modify: `src/components/Sidebar.tsx:48-57` (replace the `grouped` memo) and `:156-179` (replace the category render block)
- Modify: `src/index.css:219` (add the nested-group rule)
- Test: `src/sidebarPrefs.test.ts`, `src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `buildSidebarTree`, `SidebarNode`, `SidebarTypeNode` from Task 2.
- Produces: `groupCollapseKey(name: string): string` exported from `src/sidebarPrefs.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `src/sidebarPrefs.test.ts`:

```ts
it('namespaces group collapse keys so a group and a type of the same name differ', () => {
  expect(groupCollapseKey('Places')).toBe('group:Places')
  expect(groupCollapseKey('Places')).not.toBe('Places')
})
```

Import `groupCollapseKey` from `./sidebarPrefs` in that file's existing import.

Add to `src/components/Sidebar.test.tsx` (the file already calls `afterEach(cleanup)` at the top, which this relies on):

```ts
describe('Sidebar type groups', () => {
  beforeEach(async () => {
    await db.pages.clear()
    await db.templates.clear()
    await seedTemplates()
  })

  it('nests a grouped type under its group header with a total count', async () => {
    await createPage({ title: 'Eldoria', category: 'Settlement' })
    await createPage({ title: 'Valmara', category: 'Country' })

    renderSidebar()

    // "Places" groups Country + Settlement, so its total is 2. Matched by regex
    // because the header's text content is "Places 2" (label + count span).
    const group = await screen.findByText(/^Places/)
    expect(group.textContent).toContain('2')

    // A group header is not a link; the type header still is.
    expect(group.closest('a')).toBeNull()
    const typeLink = await screen.findByRole('link', { name: /Settlement/ })
    expect(typeLink.getAttribute('href')).toBe('/browse/Settlement')
  })

  it('collapsing a group hides its child types', async () => {
    await createPage({ title: 'Eldoria', category: 'Settlement' })

    renderSidebar()
    await screen.findByText('Eldoria')

    // Target the "Places" group's own toggle, not whichever button happens to
    // be first — Recent and Tags are collapsible too.
    const header = (await screen.findByText(/^Places/)).closest('.group-head')!
    fireEvent.click(header.querySelector('button')!)

    await waitFor(() => expect(screen.queryByText('Eldoria')).toBeNull())
    // The type header went with it.
    expect(screen.queryByRole('link', { name: /Settlement/ })).toBeNull()
  })
})
```

Add `seedTemplates` to that file's `'../db'` import.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/sidebarPrefs.test.ts src/components/Sidebar.test.tsx
```

Expected: FAIL — `groupCollapseKey` is not exported; no "Places" text in the sidebar.

- [ ] **Step 3: Add the collapse-key helper**

In `src/sidebarPrefs.ts`, after the `TAGS_GROUP` constant:

```ts
/** Collapse-state key for a type group (#115). Prefixed so a group named
 *  "Places" and a page type named "Places" never share a collapse state.
 *  Bare names stay reserved for types, so existing stored keys keep working. */
export const groupCollapseKey = (name: string): string => `group:${name}`
```

- [ ] **Step 4: Replace the sidebar memo**

In `src/components/Sidebar.tsx`, add to the imports:

```ts
import { buildSidebarTree, type SidebarNode, type SidebarTypeNode } from '../sidebarTree'
import { getCollapsedGroups, toggleCollapsedGroup, groupCollapseKey, RECENT_GROUP, TAGS_GROUP } from '../sidebarPrefs'
```

(that replaces the existing `sidebarPrefs` import line), then replace the `grouped` memo at lines 48-57 with:

```ts
  // Two-level tree: groups and ungrouped types interleaved alphabetically.
  const tree = useMemo(() => buildSidebarTree(pages, templates), [pages, templates])
```

- [ ] **Step 5: Extract the type-group markup into a component**

Still in `Sidebar.tsx`, add above the `Sidebar` component (beside `PageLink`). This is the existing per-category markup lifted verbatim so grouped and ungrouped types render identically:

```tsx
function TypeGroup({
  node, collapsed, onToggle, browseCategory, currentId,
}: {
  node: SidebarTypeNode
  collapsed: Set<string>
  onToggle: (key: string) => void
  browseCategory: string | null
  currentId: string | null
}) {
  const isCollapsed = collapsed.has(node.category)
  return (
    <div className="page-group">
      <div className="group-head">
        <button
          className="group-toggle"
          aria-expanded={!isCollapsed}
          onClick={() => onToggle(node.category)}
        >
          <span className={isCollapsed ? 'chev' : 'chev chev--open'}>▸</span>
        </button>
        <Link
          to={`/browse/${encodeURIComponent(node.category)}`}
          className={`group-label${browseCategory === node.category ? ' active' : ''}`}
          style={{ color: categoryColor(node.category) }}
        >
          {node.category} <span className="group-count">{node.pages.length}</span>
        </Link>
      </div>
      {!isCollapsed &&
        node.pages.map((p) => <PageLink key={p.id} page={p} active={p.id === currentId} />)}
    </div>
  )
}
```

- [ ] **Step 6: Replace the render block**

Replace lines 155-179 (the `grouped.length === 0` hint and the `grouped.map(...)` block) with:

```tsx
        {tree.length === 0 && <p className="empty-hint">No pages yet. Create your first one!</p>}
        {tree.map((node: SidebarNode) =>
          node.kind === 'type' ? (
            <TypeGroup
              key={`type:${node.category}`}
              node={node}
              collapsed={collapsed}
              onToggle={toggle}
              browseCategory={browseCategory}
              currentId={currentId}
            />
          ) : (
            <div key={`group:${node.name}`} className="page-group">
              <div className="group-head">
                <button
                  className="group-toggle"
                  aria-expanded={!collapsed.has(groupCollapseKey(node.name))}
                  onClick={() => toggle(groupCollapseKey(node.name))}
                >
                  <span
                    className={
                      collapsed.has(groupCollapseKey(node.name)) ? 'chev' : 'chev chev--open'
                    }
                  >
                    ▸
                  </span>
                </button>
                <span className="group-label group-label-static">
                  {node.name} <span className="group-count">{node.count}</span>
                </span>
              </div>
              {!collapsed.has(groupCollapseKey(node.name)) && (
                <div className="page-subgroup">
                  {node.children.map((child) => (
                    <TypeGroup
                      key={child.category}
                      node={child}
                      collapsed={collapsed}
                      onToggle={toggle}
                      browseCategory={browseCategory}
                      currentId={currentId}
                    />
                  ))}
                </div>
              )}
            </div>
          ),
        )}
```

- [ ] **Step 7: Add the indent rule**

In `src/index.css`, after the `.page-group` rule (line 219):

```css
.page-subgroup { margin-left: 10px; padding-left: 8px; border-left: 1px solid var(--border); }
```

Use `var(--border)` (defined at `src/index.css:11`), not `var(--rule)` — the latter is a `color-mix` derived from `--accent` and is declared in a narrower scope.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npx vitest run src/sidebarPrefs.test.ts src/components/Sidebar.test.tsx
```

Expected: PASS, including the pre-existing tags-group and navigation tests in `Sidebar.test.tsx`.

- [ ] **Step 9: Commit**

```bash
git add src/sidebarPrefs.ts src/sidebarPrefs.test.ts src/components/Sidebar.tsx src/components/Sidebar.test.tsx src/index.css
git commit -m "feat: render grouped page types in the sidebar (#115)"
```

---

### Task 4: Group field in the page-type editor

**Files:**
- Modify: `src/routes/TemplatesRoute.tsx:176-191` (add a group row after the icon row)
- Test: `src/routes/TemplatesRoute.test.tsx`

**Interfaces:**
- Consumes: `InfoboxTemplate.group` (Task 1). Uses the existing `updateTemplate(id, patch)` already imported in this file.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Add to `src/routes/TemplatesRoute.test.tsx` (the file exists, already calls `afterEach(cleanup)`, and renders via `render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)` — there is no `renderTemplates` helper). Add `seedTemplates` to its existing `'../db'` import, and add this as a new `describe` block:

```tsx
describe('TemplatesRoute — sidebar group', () => {
  beforeEach(async () => {
    await db.templates.clear()
    await seedTemplates()
  })

  it('saves a group onto the selected type and suggests existing groups', async () => {
    render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)

    fireEvent.click(await screen.findByText('Settlement'))

    // Task 1 backfilled Settlement into "Places".
    const input = await screen.findByLabelText('Group')
    expect((input as HTMLInputElement).value).toBe('Places')

    fireEvent.change(input, { target: { value: 'Realms' } })

    await waitFor(async () => {
      const all = await db.templates.toArray()
      expect(all.find((t) => t.name === 'Settlement')!.group).toBe('Realms')
    })

    // The datalist offers the groups currently in use.
    expect(document.querySelectorAll('#template-groups option').length).toBeGreaterThan(0)
  })

  it('clearing the field stores the deliberately-ungrouped sentinel', async () => {
    render(<MemoryRouter><TemplatesRoute /></MemoryRouter>)

    fireEvent.click(await screen.findByText('Spell'))
    fireEvent.change(await screen.findByLabelText('Group'), { target: { value: '' } })

    await waitFor(async () => {
      const all = await db.templates.toArray()
      expect(all.find((t) => t.name === 'Spell')!.group).toBe('')
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/routes/TemplatesRoute.test.tsx
```

Expected: FAIL — no element labelled "Group".

- [ ] **Step 3: Add the group row**

In `src/routes/TemplatesRoute.tsx`, immediately after the icon `template-color-row` block (closing `</div>` at line 191), add:

```tsx
            <div className="template-color-row">
              <label className="template-color-label" htmlFor="template-group">Group</label>
              <input
                id="template-group"
                className="template-icon-input"
                list="template-groups"
                value={selected.group ?? ''}
                placeholder="None"
                onChange={(e) => updateTemplate(selected.id, { group: e.target.value })}
              />
              <datalist id="template-groups">
                {[...new Set(
                  templates.map((t) => t.group?.trim()).filter((g): g is string => !!g),
                )]
                  .sort((a, b) => a.localeCompare(b))
                  .map((g) => <option key={g} value={g} />)}
              </datalist>
            </div>
```

The `<label htmlFor>` is what makes `findByLabelText('Group')` work; the existing icon row uses a `<span>`, so do not copy that part.

Clearing the input stores `''` — the "deliberately ungrouped" sentinel that `seedTemplates()` will never overwrite.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/routes/TemplatesRoute.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/TemplatesRoute.tsx src/routes/TemplatesRoute.test.tsx
git commit -m "feat: edit a page type's sidebar group (#115)"
```

---

### Task 5: Documentation and full verification

**Files:**
- Modify: `CLAUDE.md` (the page-types sentence in the Data layer section, and the Sidebar sentence in the Routing section)

**Interfaces:**
- Consumes: everything above. Produces: nothing.

- [ ] **Step 1: Update the page-type description**

In `CLAUDE.md`, find the sentence describing `InfoboxTemplate` ("a **page type**: named coloured category + starter rows + optional `sections` starter body headings") and extend it:

```
+ optional `group` (#115 — the sidebar group this type nests under; absent ⇒
backfillable, `''` ⇒ deliberately ungrouped)
```

- [ ] **Step 2: Update the sidebar description**

In `CLAUDE.md`, replace "The route table is in `App.tsx`. Sidebar groups pages by category (headers link to `/browse/:category`)" with a note that the sidebar renders a two-level tree from the pure `src/sidebarTree.ts` — groups and ungrouped types interleaved alphabetically — and that collapse keys for groups are `group:`-prefixed in `sidebarPrefs` so a group and a type of the same name don't collide.

- [ ] **Step 3: Run the full verification gate**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: lint clean, build clean (the pre-existing >500 kB chunk warning is not a failure), all tests pass with the new `sidebarTree` file added to the count.

- [ ] **Step 4: Commit and push**

```bash
git add CLAUDE.md
git commit -m "docs: record page-type groups and the sidebar tree (#115)"
git push -u origin feat/115-hierarchical-navigation
```

- [ ] **Step 5: Open the PR**

Label `version:minor` — this is a new feature, and the repo's `version-bump.yml` reads the label to decide the release bump. Reference `Closes #115` in the body, and call out the accepted risk from spec §9: **every existing world's sidebar visibly reorganises on upgrade**, reversible per-type by clearing the group field.

```bash
gh pr create --base main --label "version:minor" --title "feat: hierarchical sidebar navigation (#115)"
```

- [ ] **Step 6: Manual verification**

Run `npm run dev` and confirm in the browser at `http://localhost:5174`:

1. The sidebar shows six group headers plus any ungrouped custom types, interleaved alphabetically.
2. Collapsing a group hides its types; each type still collapses independently.
3. A type header still navigates to `/browse/<Type>`; a group header does not navigate.
4. Clearing a type's group in Settings → Page types moves it to top level, and it stays there after a reload (the `''` sentinel surviving `seedTemplates()`).

---

## Notes for the implementer

- **`page.category` is never written.** If a task seems to need it, stop — the design deliberately avoids it (spec §2).
- **Don't "fix" the `undefined` vs `''` distinction** into a single falsy check. `!t.group` would re-backfill a type the user deliberately ungrouped on every startup.
- **Keep `buildSidebarTree` pure.** No React, no Dexie runtime import — a runtime `db` import would force the module under `src/db/`.
- The sidebar's `templates` live query already exists at `Sidebar.tsx:35`; do not add a second one.
