import { describe, it, expect } from 'vitest'
import { buildGraphData, nodesWithinHops, connectedComponents, shortestPath, findPath, edgeKey, type GraphLink, type LorePage } from '../db'
import type { Infobox, InfoboxField } from './types'

// buildGraphData is a pure function over a page array, so these tests pass pages
// in directly (no DB). They pin the documented edge rules: a node per page
// (link-less pages included), self-links dropped, A↔B collapsed to one undirected
// edge, degree = distinct neighbours, case-insensitive title resolution, and
// links read from both the body and the infobox.

let seq = 0
function field(value: string): InfoboxField {
  return { id: `f${seq++}`, label: 'Ref', value, fieldType: 'ref' }
}
function infobox(fields: InfoboxField[]): Infobox {
  return { template: 'X', image: null, caption: '', fields }
}
function page(id: string, title: string, opts: Partial<LorePage> = {}): LorePage {
  return {
    id,
    title,
    category: 'Character',
    content: '',
    summary: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  }
}
/** A body anchor linking to the given title. */
function link(title: string): string {
  return `<a data-wikilink data-title="${title}">${title}</a>`
}

describe('buildGraphData', () => {
  it('makes a node per page, including link-less pages (lone dots)', () => {
    const data = buildGraphData([page('a', 'A'), page('b', 'B')])
    expect(data.nodes.map((n) => n.id).sort()).toEqual(['a', 'b'])
    expect(data.links).toEqual([])
    expect(data.nodes.every((n) => n.degree === 0)).toBe(true)
  })

  it('creates one edge for a resolved link and raises both degrees', () => {
    const data = buildGraphData([
      page('a', 'A', { content: link('B') }),
      page('b', 'B'),
    ])
    expect(data.links).toEqual([{ source: 'a', target: 'b', mutual: false }])
    expect(data.nodes.find((n) => n.id === 'a')!.degree).toBe(1)
    expect(data.nodes.find((n) => n.id === 'b')!.degree).toBe(1)
  })

  it('creates a ghost node (not a real edge) for a link to a missing target', () => {
    const data = buildGraphData([page('a', 'A', { content: link('Ghost') })])
    // The real node has no real neighbours.
    expect(data.nodes.find((n) => n.id === 'a')!.degree).toBe(0)
    // A ghost node and a ghost link are emitted instead of being silently dropped.
    expect(data.nodes.some((n) => n.ghost)).toBe(true)
    expect(data.links).toEqual([{ source: 'a', target: 'ghost:ghost', mutual: false }])
  })

  it('drops self-links', () => {
    const data = buildGraphData([page('a', 'A', { content: link('A') })])
    expect(data.links).toEqual([])
    expect(data.nodes[0].degree).toBe(0)
  })

  it('collapses A→B and B→A into a single undirected edge, marked mutual', () => {
    const data = buildGraphData([
      page('a', 'A', { content: link('B') }),
      page('b', 'B', { content: link('A') }),
    ])
    expect(data.links).toHaveLength(1)
    expect(data.links[0].mutual).toBe(true)
    expect(data.nodes.find((n) => n.id === 'a')!.degree).toBe(1)
    expect(data.nodes.find((n) => n.id === 'b')!.degree).toBe(1)
  })

  it('marks a one-way link as not mutual', () => {
    const data = buildGraphData([
      page('a', 'A', { content: link('B') }),
      page('b', 'B'),
    ])
    expect(data.links[0].mutual).toBe(false)
  })

  it('reports each page status on its node (defaulting older/unknown values)', () => {
    const data = buildGraphData([
      page('a', 'A', { status: 'Complete' }),
      page('b', 'B', { status: 'WIP' }), // retired status → default
      page('c', 'C'), // no status → default
    ])
    expect(data.nodes.find((n) => n.id === 'a')!.status).toBe('Complete')
    expect(data.nodes.find((n) => n.id === 'b')!.status).toBe('Draft')
    expect(data.nodes.find((n) => n.id === 'c')!.status).toBe('Draft')
  })

  it('counts distinct neighbours for degree', () => {
    const data = buildGraphData([
      page('hub', 'Hub', { content: link('A') + link('B') + link('A') }),
      page('a', 'A'),
      page('b', 'B'),
    ])
    expect(data.nodes.find((n) => n.id === 'hub')!.degree).toBe(2)
    // The duplicate A link does not produce a second edge.
    expect(data.links).toHaveLength(2)
  })

  it('resolves titles case-insensitively', () => {
    const data = buildGraphData([
      page('a', 'A', { content: link('gOnDoR') }),
      page('g', 'Gondor'),
    ])
    expect(data.links).toEqual([{ source: 'a', target: 'g', mutual: false }])
  })

  it('reads links from infobox ref fields too', () => {
    const data = buildGraphData([
      page('a', 'A', { infobox: infobox([field('[[B]]')]) }),
      page('b', 'B'),
    ])
    expect(data.links).toEqual([{ source: 'a', target: 'b', mutual: false }])
  })
})

// ---------------------------------------------------------------------------
// Ghost node tests (Task 1)
// ---------------------------------------------------------------------------

/** Minimal page factory for ghost-node tests — only fields buildGraphData reads. */
function ghostPage(partial: Partial<LorePage> & { id: string; title: string }): LorePage {
  return {
    category: 'General',
    content: '',
    summary: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  } as LorePage
}

describe('buildGraphData ghost nodes', () => {
  it('turns a link to a missing page into one ghost node', () => {
    const pages = [ghostPage({ id: 'a', title: 'Sam', content: `<p>${link('Mordor')}</p>` })]
    const { nodes, links } = buildGraphData(pages)

    const ghost = nodes.find((n) => n.ghost)
    expect(ghost).toBeDefined()
    expect(ghost!.id).toBe('ghost:mordor')
    expect(ghost!.degree).toBe(1)
    expect(links).toContainEqual({ source: 'a', target: 'ghost:mordor', mutual: false })
  })

  it('collapses two linkers to the same missing title into one ghost (degree 2)', () => {
    const pages = [
      ghostPage({ id: 'a', title: 'Sam', content: `<p>${link('Mordor')}</p>` }),
      ghostPage({ id: 'b', title: 'Frodo', content: `<p>${link('Mordor')}</p>` }),
    ]
    const ghosts = buildGraphData(pages).nodes.filter((n) => n.ghost)
    expect(ghosts).toHaveLength(1)
    expect(ghosts[0].degree).toBe(2)
  })

  it('prettifies the lowercased link text to a title-cased label', () => {
    const pages = [ghostPage({ id: 'a', title: 'Sam', content: `<p>${link('the shire')}</p>` })]
    const ghost = buildGraphData(pages).nodes.find((n) => n.ghost)!
    expect(ghost.title).toBe('The Shire')
  })

  it('does not create a ghost when the target page exists', () => {
    const pages = [
      ghostPage({ id: 'a', title: 'Sam', content: `<p>${link('Frodo')}</p>` }),
      ghostPage({ id: 'b', title: 'Frodo' }),
    ]
    expect(buildGraphData(pages).nodes.some((n) => n.ghost)).toBe(false)
  })

  it('leaves real-node degree unaffected by outgoing ghost links', () => {
    const pages = [
      ghostPage({ id: 'a', title: 'Sam', content: `<p>${link('Frodo')} ${link('Mordor')}</p>` }),
      ghostPage({ id: 'b', title: 'Frodo' }),
    ]
    const sam = buildGraphData(pages).nodes.find((n) => n.id === 'a')!
    expect(sam.degree).toBe(1) // only the real Frodo edge counts
  })
})

// ---------------------------------------------------------------------------
// Depth / neighbourhood traversal (degree/depth slider)
// ---------------------------------------------------------------------------

/** A path graph a—b—c—d, used to check hop distances. */
const PATH: Pick<GraphLink, 'source' | 'target'>[] = [
  { source: 'a', target: 'b' },
  { source: 'b', target: 'c' },
  { source: 'c', target: 'd' },
]

describe('nodesWithinHops', () => {
  it('returns just the start at 0 hops', () => {
    expect([...nodesWithinHops(PATH, 'a', 0)]).toEqual(['a'])
  })

  it('includes direct neighbours at 1 hop', () => {
    expect([...nodesWithinHops(PATH, 'b', 1)].sort()).toEqual(['a', 'b', 'c'])
  })

  it('reaches further nodes as hops grow, walking links undirected', () => {
    expect([...nodesWithinHops(PATH, 'a', 2)].sort()).toEqual(['a', 'b', 'c'])
    expect([...nodesWithinHops(PATH, 'a', 3)].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('does not exceed the reachable set when hops outrun the graph', () => {
    expect([...nodesWithinHops(PATH, 'a', 99)].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns just the start id when it is absent from the links', () => {
    expect([...nodesWithinHops(PATH, 'zzz', 3)]).toEqual(['zzz'])
  })

  it('handles a node with several branches', () => {
    const star: Pick<GraphLink, 'source' | 'target'>[] = [
      { source: 'hub', target: 'a' },
      { source: 'hub', target: 'b' },
      { source: 'hub', target: 'c' },
    ]
    expect([...nodesWithinHops(star, 'hub', 1)].sort()).toEqual(['a', 'b', 'c', 'hub'])
    // From a leaf, the other leaves are 2 hops away (via the hub).
    expect([...nodesWithinHops(star, 'a', 1)].sort()).toEqual(['a', 'hub'])
    expect([...nodesWithinHops(star, 'a', 2)].sort()).toEqual(['a', 'b', 'c', 'hub'])
  })
})

describe('connectedComponents', () => {
  it('groups two disjoint clusters plus a singleton', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const links = [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'd', target: 'e' },
    ]
    const { componentOf, sizes } = connectedComponents(ids, links)
    // Largest component (a,b,c) ranks 0; (d,e) ranks 1; nothing left over here.
    expect(componentOf.get('a')).toBe(0)
    expect(componentOf.get('b')).toBe(0)
    expect(componentOf.get('c')).toBe(0)
    expect(componentOf.get('d')).toBe(1)
    expect(componentOf.get('e')).toBe(1)
    expect(sizes).toEqual([3, 2])
  })

  it('ranks a lone node as its own component after the clusters', () => {
    const { componentOf, sizes } = connectedComponents(
      ['x', 'a', 'b'],
      [{ source: 'a', target: 'b' }],
    )
    expect(componentOf.get('a')).toBe(0)
    expect(componentOf.get('b')).toBe(0)
    expect(componentOf.get('x')).toBe(1)
    expect(sizes).toEqual([2, 1])
  })

  it('breaks equal-size ties by smallest node id', () => {
    // Two size-2 components: {m,n} and {c,d}. {c,d} has the smaller min id → rank 0.
    const { componentOf } = connectedComponents(
      ['m', 'n', 'c', 'd'],
      [{ source: 'm', target: 'n' }, { source: 'c', target: 'd' }],
    )
    expect(componentOf.get('c')).toBe(0)
    expect(componentOf.get('d')).toBe(0)
    expect(componentOf.get('m')).toBe(1)
    expect(componentOf.get('n')).toBe(1)
  })

  it('treats links as undirected and lets a shared node bridge two chains', () => {
    const { sizes } = connectedComponents(
      ['a', 'b', 'g', 'c'],
      // a→g and c→g (g is e.g. a ghost id both link to): all one component.
      [{ source: 'a', target: 'g' }, { source: 'c', target: 'g' }, { source: 'a', target: 'b' }],
    )
    expect(sizes).toEqual([4])
  })

  it('ignores link endpoints not present in nodeIds', () => {
    const { componentOf, sizes } = connectedComponents(
      ['a'],
      [{ source: 'a', target: 'missing' }],
    )
    expect(componentOf.get('a')).toBe(0)
    expect(componentOf.has('missing')).toBe(false)
    expect(sizes).toEqual([1])
  })

  it('coerces object endpoints from the mutated force simulation to ids', () => {
    // ForceGraph2D mutates link.source/target from id strings into node objects
    // once the sim runs. Island mode recomputes over those mutated links, so
    // connectedComponents must read the id off an object endpoint too — otherwise
    // every edge is ignored and each node becomes its own singleton island.
    const { componentOf, sizes } = connectedComponents(
      ['a', 'b'],
      [{ source: { id: 'a' }, target: { id: 'b' } } as never],
    )
    expect(componentOf.get('a')).toBe(0)
    expect(componentOf.get('b')).toBe(0)
    expect(sizes).toEqual([2])
  })

  it('returns empty results for no nodes', () => {
    const { componentOf, sizes } = connectedComponents([], [])
    expect(componentOf.size).toBe(0)
    expect(sizes).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Shortest path (Task 1)
// ---------------------------------------------------------------------------

// A link array in the shape buildGraphData emits (mutual is irrelevant to
// traversal, so these helpers omit it via the Pick<> parameter type).
function edge(source: string, target: string) {
  return { source, target }
}

describe('edgeKey', () => {
  it('is the same key regardless of endpoint order', () => {
    expect(edgeKey('a', 'b')).toBe(edgeKey('b', 'a'))
  })

  it('distinguishes different pairs', () => {
    expect(edgeKey('a', 'b')).not.toBe(edgeKey('a', 'c'))
  })
})

describe('shortestPath', () => {
  it('finds a directly linked pair (1 hop)', () => {
    expect(shortestPath([edge('a', 'b')], 'a', 'b')).toEqual(['a', 'b'])
  })

  it('finds a multi-hop chain', () => {
    const links = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')]
    expect(shortestPath(links, 'a', 'd')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('walks links against their direction (links are undirected)', () => {
    // Every link points *away* from the target, so a directed search would fail.
    const links = [edge('b', 'a'), edge('c', 'b')]
    expect(shortestPath(links, 'a', 'c')).toEqual(['a', 'b', 'c'])
  })

  it('prefers the shorter of two chains', () => {
    const links = [
      edge('a', 'x'), edge('x', 'd'), // 2 hops
      edge('a', 'p'), edge('p', 'q'), edge('q', 'd'), // 3 hops
    ]
    expect(shortestPath(links, 'a', 'd')).toEqual(['a', 'x', 'd'])
  })

  it('returns null when the pages are not connected', () => {
    expect(shortestPath([edge('a', 'b'), edge('c', 'd')], 'a', 'd')).toBeNull()
  })

  it('returns null for an isolated endpoint (a page with no links)', () => {
    // 'lonely' appears in no link, so it never enters the adjacency map.
    expect(shortestPath([edge('a', 'b')], 'a', 'lonely')).toBeNull()
  })

  it('returns a single-element chain when both endpoints are the same page', () => {
    expect(shortestPath([edge('a', 'b')], 'a', 'a')).toEqual(['a'])
  })

  it('routes through a ghost node when ghost links are present', () => {
    // Two real pages both link [[Mordor]], which has no page yet — a real
    // connection through a page that does not exist.
    const links = [edge('a', 'ghost:mordor'), edge('b', 'ghost:mordor')]
    expect(shortestPath(links, 'a', 'b')).toEqual(['a', 'ghost:mordor', 'b'])
  })

  it('is deterministic — link array order does not change the chain', () => {
    // Two equally short chains a→x→d and a→y→d exist; the answer must not
    // depend on the order links happen to arrive in.
    const links = [edge('a', 'x'), edge('x', 'd'), edge('a', 'y'), edge('y', 'd')]
    const reversed = [...links].reverse()
    const first = shortestPath(links, 'a', 'd')
    expect(shortestPath(reversed, 'a', 'd')).toEqual(first)
    expect(first).toEqual(['a', 'x', 'd']) // 'x' < 'y', so 'x' wins the tie
  })

  it('handles links whose endpoints the force sim resolved to node objects', () => {
    // ForceGraph2D mutates a drawn link's source/target from an id string into
    // the resolved node object in place, so the same links this runs over in the
    // live app carry {id} objects, not strings. Must find the same chain either
    // way — otherwise a path over the drawn graph silently fails post-render.
    const resolved = [
      { source: { id: 'a' }, target: { id: 'b' } },
      { source: { id: 'b' }, target: { id: 'c' } },
    ]
    expect(shortestPath(resolved, 'a', 'c')).toEqual(['a', 'b', 'c'])
  })
})

describe('findPath', () => {
  const full = [edge('a', 'b'), edge('b', 'c')]

  it('reports a chain that exists in the drawn graph', () => {
    expect(findPath(full, full, 'a', 'c')).toEqual({ kind: 'path', nodes: ['a', 'b', 'c'] })
  })

  it('reports "hidden" when only the filters break the chain', () => {
    // The drawn graph is missing b→c, but the full graph still connects a and c.
    const drawn = [edge('a', 'b')]
    expect(findPath(drawn, full, 'a', 'c')).toEqual({ kind: 'hidden' })
  })

  it('reports "none" when the pages are unconnected even unfiltered', () => {
    expect(findPath(full, full, 'a', 'zz')).toEqual({ kind: 'none' })
  })

  it('reports a real chain when the drawn links carry resolved node objects', () => {
    // The drawn links are the ones the force sim has mutated to {id} objects; a
    // path plainly exists, so the answer must be 'path', never a false 'hidden'.
    const drawn = [
      { source: { id: 'a' }, target: { id: 'b' } },
      { source: { id: 'b' }, target: { id: 'c' } },
    ]
    expect(findPath(drawn, full, 'a', 'c')).toEqual({ kind: 'path', nodes: ['a', 'b', 'c'] })
  })
})
