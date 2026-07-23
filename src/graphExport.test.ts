import { describe, it, expect } from 'vitest'
import { buildScene, sceneToSvg, svgBlob, EXPORT_BG, GHOST_COLOR, LABEL_COLOR } from './graphExport'
import { categoryColor, type GraphNode } from './db'
import { linkStyle, withAlpha, type DrawnGraphData, type DrawnLink } from './graphColor'
import { NO_TAG_FILTER } from './tagFilter'

// Nodes as the running sim leaves them: plain GraphNode + injected x/y.
function pos(n: Partial<GraphNode> & { id: string }, x: number, y: number) {
  return {
    title: n.id, category: 'Character', tags: [], status: 'Draft',
    degree: 0, ...n, x, y,
  } as GraphNode & { x: number; y: number }
}

/** A drawn link as GraphRoute's filter memo produces it: the plain link plus
 *  the presentation linkStyle computed for it. */
function drawn(link: Partial<DrawnLink> & { source: string; target: string }): DrawnLink {
  const base = { mutual: false, wiki: true, relations: [], ...link }
  return { ...base, ...linkStyle(base, new Set())! }
}

const OPTS = { colorBy: 'type' as const, tagFilter: NO_TAG_FILTER, islandColors: new Map<string, string>() }

describe('buildScene', () => {
  it('returns null when no node has coordinates', () => {
    const data: DrawnGraphData = {
      nodes: [{ id: 'a', title: 'A', category: 'Character', tags: [], status: 'Draft', degree: 0 }],
      links: [],
    }
    expect(buildScene(data, OPTS)).toBeNull()
  })

  it('computes a padded bounding box enclosing all positioned nodes', () => {
    const data = { nodes: [pos({ id: 'a' }, 0, 0), pos({ id: 'b' }, 100, 50)], links: [] } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene).not.toBeNull()
    // Box starts left/above the min node and extends right/below the max node.
    expect(scene.minX).toBeLessThan(0)
    expect(scene.minY).toBeLessThan(0)
    expect(scene.minX + scene.width).toBeGreaterThan(100)
    expect(scene.minY + scene.height).toBeGreaterThan(50)
    expect(scene.background).toBe(EXPORT_BG)
  })

  it('gives every node a label and a type-coloured fill', () => {
    const data = { nodes: [pos({ id: 'a', title: 'Alice', category: 'Character' }, 0, 0)], links: [] } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.nodes).toHaveLength(1)
    expect(scene.nodes[0].title).toBe('Alice')
    expect(scene.nodes[0].labelColor).toBe(LABEL_COLOR)
    expect(scene.nodes[0].fill).toBe(categoryColor('Character'))
    expect(scene.nodes[0].ghost).toBe(false)
  })

  it('renders ghost nodes as stroke-not-fill with the muted label colour', () => {
    const data = { nodes: [pos({ id: 'ghost:x', title: 'X', ghost: true, status: '' }, 0, 0)], links: [] } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.nodes[0].fill).toBeNull()
    expect(scene.nodes[0].ghost).toBe(true)
    expect(scene.nodes[0].labelColor).toBe(GHOST_COLOR)
  })

  it('styles mutual links thicker/bluer than one-way links', () => {
    const data = {
      nodes: [pos({ id: 'a', degree: 1 }, 0, 0), pos({ id: 'b', degree: 1 }, 10, 0), pos({ id: 'c', degree: 1 }, 20, 0)],
      links: [
        drawn({ source: 'a', target: 'b', mutual: true }),
        drawn({ source: 'b', target: 'c', mutual: false }),
      ],
    } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    const mutual = scene.links[0]
    const oneWay = scene.links[1]
    expect(mutual.width).toBeGreaterThan(oneWay.width)
    expect(mutual.color).not.toBe(oneWay.color)
    expect(mutual.x1).toBe(0)
    expect(mutual.x2).toBe(10)
  })

  it('draws a relationship edge in its type colour, not the wiki styling', () => {
    const data = {
      nodes: [pos({ id: 'a', degree: 1 }, 0, 0), pos({ id: 'b', degree: 1 }, 10, 0)],
      links: [
        drawn({
          source: 'a', target: 'b', wiki: false,
          relations: [{
            typeId: 'parent-of', group: 'kin', color: '#e0a458',
            label: 'Parent of', inverseLabel: 'Child of',
            directed: true, reversed: false, order: 0,
          }],
        }),
      ],
    } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.links[0].color).toBe(withAlpha('#e0a458', 0.75))
    expect(scene.links[0].width).toBe(2.5)
  })

  it('skips un-positioned nodes and drops links that touch them', () => {
    const data = {
      nodes: [pos({ id: 'a' }, 0, 0), { id: 'b', title: 'B', category: 'Character', tags: [], status: 'Draft', degree: 0 }],
      links: [drawn({ source: 'a', target: 'b', mutual: false })],
    } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.nodes).toHaveLength(1) // 'b' has no x/y → skipped
    expect(scene.links).toHaveLength(0) // link touches skipped 'b' → dropped
  })

  it('widens the bbox for a node with a long title vs a short title', () => {
    const shortData = { nodes: [pos({ id: 'a', title: 'A' }, 0, 0)], links: [] } as unknown as DrawnGraphData
    const longTitle = 'X'.repeat(40)
    const longData = { nodes: [pos({ id: 'a', title: longTitle }, 0, 0)], links: [] } as unknown as DrawnGraphData
    const shortScene = buildScene(shortData, OPTS)!
    const longScene = buildScene(longData, OPTS)!
    expect(longScene.width).toBeGreaterThan(shortScene.width)
  })

  it('resolves link endpoints whether source/target are ids or node objects', () => {
    const a = pos({ id: 'a' }, 0, 0)
    const b = pos({ id: 'b' }, 30, 40)
    // After the sim runs, react-force-graph swaps ids for node object refs.
    const data = { nodes: [a, b], links: [drawn({ source: a as unknown as string, target: b as unknown as string, mutual: false })] } as unknown as DrawnGraphData
    const scene = buildScene(data, OPTS)!
    expect(scene.links).toHaveLength(1)
    expect(scene.links[0].x2).toBe(30)
    expect(scene.links[0].y2).toBe(40)
  })
})

function scene1() {
  const data = {
    nodes: [
      { title: 'Alice & Bob', category: 'Character', tags: [], status: 'Draft', degree: 1, id: 'a', x: 0, y: 0 },
      { title: 'Ghosttown', category: '', tags: [], status: '', degree: 1, id: 'g', ghost: true, x: 20, y: 0 },
    ],
    links: [drawn({ source: 'a', target: 'g', mutual: false })],
  } as unknown as DrawnGraphData
  return buildScene(data, { colorBy: 'type', tagFilter: NO_TAG_FILTER, islandColors: new Map() })!
}

describe('sceneToSvg', () => {
  it('emits a viewBox matching the scene bounds', () => {
    const s = scene1()
    const svg = sceneToSvg(s)
    expect(svg).toContain(`viewBox="${s.minX} ${s.minY} ${s.width} ${s.height}"`)
  })

  it('emits one circle, one line, and one text per node/link', () => {
    const svg = sceneToSvg(scene1())
    expect((svg.match(/<circle/g) ?? []).length).toBe(2)
    expect((svg.match(/<line/g) ?? []).length).toBe(1)
    expect((svg.match(/<text/g) ?? []).length).toBe(2)
  })

  it('draws ghost nodes with a dashed stroke and no fill', () => {
    const svg = sceneToSvg(scene1())
    expect(svg).toContain('stroke-dasharray')
    expect(svg).toContain(`stroke="${'#8a8270'}"`)
  })

  it('XML-escapes label text', () => {
    const svg = sceneToSvg(scene1())
    expect(svg).toContain('Alice &amp; Bob')
    expect(svg).not.toContain('Alice & Bob')
  })

  it('svgBlob wraps a string as an image/svg+xml Blob', () => {
    const blob = svgBlob('<svg/>')
    expect(blob.type).toBe('image/svg+xml')
    expect(blob.size).toBeGreaterThan(0)
  })
})

import { graphFilename, sceneToPng } from './graphExport'

describe('graphFilename', () => {
  it('slugifies the lore name and appends the extension', () => {
    const name = graphFilename('My Grand World!', 'svg')
    expect(name).toMatch(/^graph-my-grand-world-\d{4}-\d{2}-\d{2}\.svg$/)
  })

  it('falls back to "world" for an empty name', () => {
    expect(graphFilename('   ', 'png')).toMatch(/^graph-world-\d{4}-\d{2}-\d{2}\.png$/)
  })
})

describe('sceneToPng', () => {
  it('resolves to a non-empty image/png Blob', async () => {
    const data = { nodes: [{ title: 'A', category: 'Character', tags: [], status: 'Draft', degree: 0, id: 'a', x: 0, y: 0 }], links: [] } as unknown as DrawnGraphData
    const scene = buildScene(data, { colorBy: 'type', tagFilter: NO_TAG_FILTER, islandColors: new Map() })!
    let blob: Blob
    try {
      blob = await sceneToPng(scene)
    } catch {
      // happy-dom's canvas may not implement toBlob; skip the assertion there.
      return
    }
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBeGreaterThan(0)
  })
})
