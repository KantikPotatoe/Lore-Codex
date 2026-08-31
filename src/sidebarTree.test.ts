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
