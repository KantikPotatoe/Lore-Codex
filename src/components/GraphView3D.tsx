import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph3D, {
  type NodeObject,
  type LinkObject,
} from 'react-force-graph-3d'
import { type GraphData, type GraphNode, type GraphLink } from '../db'
import { nodeFill, type ColorBy } from '../graphColor'
import type { TagFilter } from '../tagFilter'

// The 3D view is a "wow" companion to the 2D canvas: same data, simpler
// interaction. Nodes are coloured by category (ghosts muted), sized by degree;
// mutual links draw thicker and bluer. A single click opens a real page or
// offers to create a ghost — no focus/pulse choreography like the 2D view.
type GNode = NodeObject<GraphNode>
type GLink = LinkObject<GraphNode, GraphLink>

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
  data: GraphData
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
  const linkColor = useCallback(
    (link: GLink) => (link.mutual ? 'rgba(150,180,255,0.8)' : 'rgba(160,160,160,0.4)'),
    [],
  )
  const linkWidth = useCallback((link: GLink) => (link.mutual ? 1.4 : 0.5), [])

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%' }}>
      <ForceGraph3D<GraphNode, GraphLink>
        width={size.width}
        height={size.height}
        graphData={data}
        nodeId="id"
        nodeLabel="title"
        nodeColor={nodeColor}
        nodeVal={(node: GNode) => radiusFor(node.degree)}
        nodeOpacity={0.9}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkDirectionalArrowColor={linkColor}
        linkDirectionalArrowLength={showArrows ? 3 : 0}
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
