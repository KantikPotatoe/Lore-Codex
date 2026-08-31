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
    group.children.sort((a, b) => a.category.localeCompare(b.category, undefined, { caseFirst: 'upper' }))
  }

  return top.sort((a, b) => sortName(a).localeCompare(sortName(b), undefined, { caseFirst: 'upper' }))
}
