import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph3D, {
  type NodeObject,
  type LinkObject,
} from 'react-force-graph-3d'
import { type GraphNode } from '../db'
import {
  nodeFill,
  nodeTooltip,
  type ColorBy,
  type DrawnLink,
  type DrawnGraphData,
} from '../graphColor'
import type { TagFilter } from '../tagFilter'

// The 3D view is a "wow" companion to the 2D canvas: same data, simpler
// interaction. Nodes are coloured by category (ghosts muted), sized by degree;
// links carry their relationship type's colour, or the wiki mutual/one-way
// styling when untyped. A single click opens a real page or
// offers to create a ghost — no focus/pulse choreography like the 2D view.
type GNode = NodeObject<GraphNode>
type GLink = LinkObject<GraphNode, DrawnLink>

const GHOST_COLOR = '#8a8270'

function radiusFor(degree: number): number {
  return Math.min(16, 4 + degree * 1.5)
}

export default function GraphView3D({
  data,
  showArrows,
  colorBy,
  tagFilter,
  islandColors,
  onGhostClick,
}: {
  data: DrawnGraphData
  showArrows: boolean
  colorBy: ColorBy
  tagFilter: TagFilter
  islandColors: Map<string, string>
  onGhostClick: (title: string) => void
}) {
  const navigate = useNavigate()

  // Match the 2D view: size to the container rather than the window so the graph
  // reflows when the side panel opens/closes.
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const nodeColor = useCallback(
    (node: GNode) => (node.ghost ? GHOST_COLOR : nodeFill(node, colorBy, tagFilter, islandColors)),
    [colorBy, tagFilter, islandColors],
  )
  // Colour and width are precomputed by linkStyle in GraphRoute's filter memo,
  // on the 3D tier. Unlike the 2D view there is no lit state to layer on top:
  // 3D has no hover/focus dimming, so `activeColor` goes unused here.
  const linkColor = useCallback((link: GLink) => link.color3d, [])
  const linkWidth = useCallback((link: GLink) => link.width3d, [])

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph3D<GraphNode, DrawnLink>
        width={size.width}
        height={size.height}
        graphData={data}
        nodeId="id"
        // Not `nodeLabel="title"`: the hover label lands in an innerHTML sink
        // (see `nodeTooltip`), and page titles arrive unsanitized from backup
        // import.
        nodeLabel={(node: GNode) => nodeTooltip(node)}
        nodeColor={nodeColor}
        nodeVal={(node: GNode) => radiusFor(node.degree)}
        nodeOpacity={0.9}
        linkColor={linkColor}
        linkWidth={linkWidth}
        // Same escaped string the 2D view shows, and the same float-tooltip
        // innerHTML sink (#244). Wiki-only edges carry '' and render nothing.
        linkLabel={(link: GLink) => link.labels}
        linkDirectionalArrowColor={linkColor}
        // Asymmetric relationship types are always arrowed and symmetric ones
        // never are — direction is meaning, not the user's to toggle. Only
        // wiki-only edges follow the toggle. Length 3, not 2D's 4: the 3D
        // arrowhead sits on a thinner line.
        linkDirectionalArrowLength={(link: GLink) =>
          link.arrow === 'always' || (link.arrow === 'toggle' && showArrows) ? 3 : 0}
        linkDirectionalArrowRelPos={1}
        onNodeClick={(node: GNode) => {
          if (node.ghost) onGhostClick(node.title)
          else navigate(`/page/${String(node.id)}`)
        }}
        backgroundColor="#15130f"
      />
    </div>
  )
}
