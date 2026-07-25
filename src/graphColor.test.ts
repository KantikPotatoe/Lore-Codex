import { describe, it, expect } from 'vitest'
import { nodeFill, nodeTooltip, linkStyle, withAlpha, TAG_ACCENT, MUTED, ISLAND_PALETTE, islandColorOf } from './graphColor'
import { categoryColor, statusColor, type GraphNode, type GraphLink, type RelationEdge } from './db'
import { NO_TAG_FILTER, type TagFilter } from './tagFilter'

function node(overrides: Partial<GraphNode> = {}): GraphNode {
  return { id: 'p1', title: 'Page', category: 'Character', tags: [], status: 'Draft', degree: 0, ...overrides }
}

const filter = (tags: string[], mode: TagFilter['mode'] = 'any'): TagFilter => ({ tags, mode })

describe('nodeFill', () => {
  it('colours by category in type mode', () => {
    expect(nodeFill(node({ category: 'Character' }), 'type', NO_TAG_FILTER)).toBe(categoryColor('Character'))
  })

  it('colours by status in status mode', () => {
    expect(nodeFill(node({ status: 'Complete' }), 'status', NO_TAG_FILTER)).toBe(statusColor('Complete'))
  })

  it('accents a node carrying the highlighted tag', () => {
    expect(nodeFill(node({ tags: ['Faction', 'Magic'] }), 'tag', filter(['Magic']))).toBe(TAG_ACCENT)
  })

  it('mutes a node without the highlighted tag', () => {
    expect(nodeFill(node({ tags: ['Faction'] }), 'tag', filter(['Magic']))).toBe(MUTED)
  })

  it('mutes every node when no tag is chosen in tag mode', () => {
    expect(nodeFill(node({ tags: ['Faction'] }), 'tag', NO_TAG_FILTER)).toBe(MUTED)
  })

  it('accents on either selected tag in any mode', () => {
    expect(nodeFill(node({ tags: ['Magic'] }), 'tag', filter(['Magic', 'Norse'], 'any'))).toBe(TAG_ACCENT)
  })

  it('accents only the intersection in all mode', () => {
    expect(nodeFill(node({ tags: ['Magic', 'Norse'] }), 'tag', filter(['Magic', 'Norse'], 'all'))).toBe(TAG_ACCENT)
    expect(nodeFill(node({ tags: ['Magic'] }), 'tag', filter(['Magic', 'Norse'], 'all'))).toBe(MUTED)
  })
})

describe('nodeFill island mode', () => {
  it('returns the mapped island colour for a clustered node', () => {
    const colors = new Map([['p1', ISLAND_PALETTE[1]]])
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER, colors)).toBe(ISLAND_PALETTE[1])
  })

  it('mutes a node whose id is not in the island map', () => {
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER, new Map())).toBe(MUTED)
  })

  it('mutes when no island map is provided', () => {
    expect(nodeFill(node({ id: 'p1' }), 'island', NO_TAG_FILTER)).toBe(MUTED)
  })
})

describe('nodeTooltip', () => {
  it('returns the title unchanged when it holds no markup', () => {
    expect(nodeTooltip(node({ title: 'Aldric the Grey' }))).toBe('Aldric the Grey')
  })

  it('HTML-escapes the title, since the hover label reaches an innerHTML sink', () => {
    // Page titles are user-editable and, unlike page `content`, are written
    // verbatim by importAll — a crafted backup controls this string. GraphView3D
    // feeds it to react-force-graph's `nodeLabel`, which float-tooltip renders
    // via d3 `.html()`.
    expect(nodeTooltip(node({ title: '<img src=x onerror=alert(1)>' }))).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    )
  })

  it('escapes & before < and >, so the escaping cannot double-encode itself', () => {
    expect(nodeTooltip(node({ title: 'Foo & <bar>' }))).toBe('Foo &amp; &lt;bar&gt;')
  })
})

describe('islandColorOf', () => {
  it('assigns palette colours by rank and mutes singletons', () => {
    const componentOf = new Map([
      ['a', 0], ['b', 0], // rank 0, size 3
      ['c', 0],
      ['d', 1], ['e', 1], // rank 1, size 2
      ['x', 2],           // rank 2, size 1 → muted
    ])
    const sizes = [3, 2, 1]
    const colors = islandColorOf(componentOf, sizes)
    expect(colors.get('a')).toBe(ISLAND_PALETTE[0])
    expect(colors.get('d')).toBe(ISLAND_PALETTE[1])
    expect(colors.get('x')).toBe(MUTED)
  })

  it('cycles the palette when there are more clusters than colours', () => {
    const rank = ISLAND_PALETTE.length // one past the end
    const componentOf = new Map([['z', rank]])
    const sizes = new Array(rank + 1).fill(2) // all clusters (size >= 2)
    const colors = islandColorOf(componentOf, sizes)
    expect(colors.get('z')).toBe(ISLAND_PALETTE[rank % ISLAND_PALETTE.length])
  })
})

function relation(overrides: Partial<RelationEdge> = {}): RelationEdge {
  return {
    typeId: 'parent-of', group: 'kin', color: '#e0a458',
    label: 'Parent of', inverseLabel: 'Child of',
    directed: true, reversed: false, order: 0, ...overrides,
  }
}

function graphLink(overrides: Partial<GraphLink> = {}): GraphLink {
  return { source: 'a', target: 'b', mutual: false, wiki: true, relations: [], ...overrides }
}

const NONE_HIDDEN = new Set<string>()

describe('withAlpha', () => {
  it('converts a six-digit hex to rgba', () => {
    expect(withAlpha('#e0a458', 0.75)).toBe('rgba(224, 164, 88, 0.75)')
  })

  it('returns non-hex input unchanged, so a hand-edited colour cannot blank an edge', () => {
    expect(withAlpha('tomato', 0.5)).toBe('tomato')
  })
})

describe('linkStyle', () => {
  it('styles a wiki-only one-way link as today, arrows following the toggle', () => {
    const s = linkStyle(graphLink(), NONE_HIDDEN)!
    expect(s.width).toBe(1)
    expect(s.arrow).toBe('toggle')
    expect(s.labels).toBe('')
  })

  it('styles a mutual wiki link thicker and bluer than a one-way one', () => {
    const mutual = linkStyle(graphLink({ mutual: true }), NONE_HIDDEN)!
    const oneWay = linkStyle(graphLink(), NONE_HIDDEN)!
    expect(mutual.width).toBeGreaterThan(oneWay.width)
    expect(mutual.color).not.toBe(oneWay.color)
  })

  it('takes the primary relation colour, at full strength when lit', () => {
    const s = linkStyle(graphLink({ relations: [relation()] }), NONE_HIDDEN)!
    expect(s.color).toBe(withAlpha('#e0a458', 0.75))
    expect(s.activeColor).toBe('#e0a458')
    expect(s.width).toBe(2.5)
  })

  it('always arrows an asymmetric relation and never a symmetric one', () => {
    expect(linkStyle(graphLink({ relations: [relation()] }), NONE_HIDDEN)!.arrow).toBe('always')
    expect(
      linkStyle(graphLink({ relations: [relation({ directed: false })] }), NONE_HIDDEN)!.arrow,
    ).toBe('never')
  })

  it('joins every visible label for the hover tooltip', () => {
    const link = graphLink({
      relations: [relation(), relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Ally of', order: 3 })],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('Parent of · Ally of')
  })

  it('falls back to wiki styling when every relation is hidden', () => {
    const link = graphLink({ mutual: true, relations: [relation()] })
    const s = linkStyle(link, new Set(['parent-of']))!
    expect(s.color).toBe(linkStyle(graphLink({ mutual: true }), NONE_HIDDEN)!.color)
    expect(s.arrow).toBe('toggle')
    expect(s.labels).toBe('')
  })

  it('drops the edge when every relation is hidden and no wiki link is underneath', () => {
    const link = graphLink({ wiki: false, relations: [relation()] })
    expect(linkStyle(link, new Set(['parent-of']))).toBeNull()
  })

  it('promotes the next visible relation, swapping the edge so the arrow reads forward', () => {
    // parent-of orients the edge a→b; ally-of is stored the other way. Hiding
    // parent-of promotes ally-of, whose row runs b→a.
    const link = graphLink({
      relations: [
        relation(),
        relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Allied with', order: 3, reversed: true }),
      ],
    })
    const s = linkStyle(link, new Set(['parent-of']))!
    expect(s.source).toBe('b')
    expect(s.target).toBe('a')
    expect(s.labels).toBe('Allied with')
  })

  it('flips every label on the edge when the orientation swaps, not just the primary', () => {
    const link = graphLink({
      relations: [
        relation({ typeId: 'ally-of', label: 'Ally of', inverseLabel: 'Allied with', order: 3, reversed: true }),
        relation({ typeId: 'rival-of', label: 'Rival of', inverseLabel: 'Rivalled by', order: 4 }),
      ],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('Allied with · Rivalled by')
  })

  it('HTML-escapes relationship-type labels, since `labels` reaches an innerHTML sink', () => {
    // Relationship types are free text, editable in the admin UI and imported
    // from backup files verbatim (importAll bulkAdds relationshipTypes
    // unsanitized). GraphView feeds `labels` to react-force-graph's
    // `linkLabel`, which float-tooltip renders via d3 `.html()`.
    const link = graphLink({
      relations: [relation({ label: '<img src=x onerror=alert(1)>', inverseLabel: 'Child of' })],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('escapes & before < and >, so the escaping cannot double-encode itself', () => {
    const link = graphLink({
      relations: [relation({ label: 'Foo & <bar>', inverseLabel: 'x' })],
    })
    expect(linkStyle(link, NONE_HIDDEN)!.labels).toBe('Foo &amp; &lt;bar&gt;')
  })
})
