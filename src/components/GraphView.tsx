import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ForceGraph2D, {
  type ForceGraphMethods,
  type NodeObject,
  type LinkObject,
} from 'react-force-graph-2d'
import { type GraphData, type GraphNode, type GraphLink, edgeKey } from '../db'
import { nodeFill, PATH_ACCENT, type ColorBy } from '../graphColor'
import { radiusFor } from '../graphGeometry'
import type { GraphCam } from '../useGraphPrefs'
import type { TagFilter } from '../tagFilter'
import GraphMinimap from './GraphMinimap'

// The force simulation augments our plain nodes/links in place (adds x/y and
// swaps link source/target from an id string to the resolved node object), so
// the canvas callbacks see these richer shapes.
type GNode = NodeObject<GraphNode>
type GLink = LinkObject<GraphNode, GraphLink>

// A link end is an id string before the simulation runs and the resolved node
// object after, so accept either shape.
function endId(end: string | GNode): string {
  return typeof end === 'object' ? String(end.id) : end
}

// The focus id (hover or selection) plus its direct neighbours. Everything else
// is dimmed.
function neighboursOf(id: string, links: GLink[]): Set<string> {
  const set = new Set<string>([id])
  for (const l of links) {
    const s = endId(l.source)
    const t = endId(l.target)
    if (s === id) set.add(t)
    if (t === id) set.add(s)
  }
  return set
}

export default function GraphView({
  data,
  showArrows,
  colorBy,
  tagFilter,
  islandColors,
  selectedId,
  path,
  onSelect,
  onGhostClick,
  onPinNode,
  initialCam,
  onCamChange,
}: {
  data: GraphData
  showArrows: boolean
  colorBy: ColorBy
  tagFilter: TagFilter
  islandColors: Map<string, string>
  selectedId: string | null
  path: string[] | null
  onSelect: (id: string | null) => void
  onGhostClick: (title: string) => void
  onPinNode: (id: string, x: number, y: number) => void
  initialCam: GraphCam | null
  onCamChange: (cam: GraphCam) => void
}) {
  const navigate = useNavigate()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined)

  // react-force-graph sizes itself to the window unless given explicit
  // width/height, which overflows our container (clipped, off-centre, and the
  // graph fails to reflow when the side panel opens). Track the container's own
  // size and feed it in instead.
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

  // Timestamp of the most recent selection, for the one-shot pulse.
  const pulseStart = useRef<number>(0)
  const pulseId = useRef<string | null>(null)
  // Eased focus strength 0..1 and the last frame time, for the dim fade.
  const focusAmt = useRef<number>(0)
  const lastFrame = useRef<number>(0)

  // react-force-graph only emits single clicks; disambiguate a double-click
  // (navigate) from a single click (focus) with a short timer.
  const clickTimer = useRef<number | null>(null)

  // Cancel a pending single-click focus if the component unmounts mid-window.
  useEffect(() => () => {
    if (clickTimer.current != null) window.clearTimeout(clickTimer.current)
  }, [])

  // A path is an explicit, sticky query, so it wins over hover and selection —
  // otherwise a stray mouse move across the canvas would wipe out the answer.
  const pathIds = useMemo(() => (path ? new Set(path) : null), [path])
  const pathEdges = useMemo(() => {
    if (!path) return null
    const keys = new Set<string>()
    for (let i = 0; i < path.length - 1; i++) keys.add(edgeKey(path[i], path[i + 1]))
    return keys
  }, [path])
  const pathEnds = useMemo(
    () => (path && path.length > 0 ? [path[0], path[path.length - 1]] : null),
    [path],
  )

  const focusId = pathIds ? null : (hoverId ?? selectedId)
  const neighbourIds = useMemo(
    () => (focusId ? neighboursOf(focusId, data.links as GLink[]) : null),
    [focusId, data.links],
  )
  // What stays lit; everything else fades out. The path supersedes the
  // hover/selection neighbourhood.
  const activeIds = pathIds ?? neighbourIds

  useEffect(() => {
    if (selectedId) {
      pulseId.current = selectedId
      pulseStart.current = performance.now()
    }
  }, [selectedId])

  const paintNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0
      const y = node.y ?? 0

      // Ease focusAmt toward 1 when something is focused, else back to 0.
      const now = performance.now()
      const dt = lastFrame.current ? now - lastFrame.current : 16
      lastFrame.current = now
      const target = activeIds != null ? 1 : 0
      const step = dt / 200 // ~200ms full fade
      focusAmt.current += Math.sign(target - focusAmt.current) * step
      focusAmt.current = Math.max(0, Math.min(1, focusAmt.current))

      const isDim = activeIds != null && !activeIds.has(String(node.id))
      const baseAlpha = isDim ? 1 - 0.85 * focusAmt.current : 1

      let r = radiusFor(node.degree)
      // One-shot pop on the just-selected node.
      if (pulseId.current === String(node.id)) {
        const t = (now - pulseStart.current) / 300
        if (t < 1) {
          const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
          r *= 1 + 0.4 * (1 - ease) // starts ~1.4x, settles to 1x
        }
      }

      ctx.globalAlpha = baseAlpha
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      if (node.ghost) {
        // Dashed muted outline, no fill — a "page doesn't exist yet" marker.
        ctx.setLineDash([3 / globalScale, 3 / globalScale])
        ctx.lineWidth = 1.5 / globalScale
        ctx.strokeStyle = '#8a8270'
        ctx.stroke()
        ctx.setLineDash([])
        ctx.lineWidth = 1
      } else {
        ctx.fillStyle = nodeFill(node, colorBy, tagFilter, islandColors)
        ctx.fill()
      }

      // Ring the two endpoints so they read as the question, not just waypoints.
      if (pathEnds && (String(node.id) === pathEnds[0] || String(node.id) === pathEnds[1])) {
        ctx.beginPath()
        ctx.arc(x, y, r + 3 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = PATH_ACCENT
        ctx.lineWidth = 2 / globalScale
        ctx.stroke()
        ctx.lineWidth = 1
      }

      // Draw the title under the node once zoomed in, or for focused nodes.
      if (globalScale > 1.2 || (activeIds != null && !isDim)) {
        const fontSize = 12 / globalScale
        ctx.font = `${fontSize}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.fillStyle = node.ghost ? '#8a8270' : '#e9e1d2'
        ctx.fillText(node.title, x, y + r + 1)
      }
      ctx.globalAlpha = 1
    },
    [activeIds, pathEnds, colorBy, tagFilter, islandColors],
  )

  // Restore the saved camera once, after the container has a real size. The
  // force-graph auto-fits the view only while the zoom is still its own default
  // (see force-graph's onFinishUpdate "re-zoom if not user modified"), so a
  // single programmatic zoom/centerAt both restores the saved view and disables
  // that auto-fit for good — later filter rebuilds keep the user's camera.
  const restoredCam = useRef(false)
  useEffect(() => {
    if (restoredCam.current || !initialCam || size.width === 0) return
    const fg = fgRef.current
    if (!fg) return
    restoredCam.current = true
    // rAF so we land after the library's own initial fit on this frame.
    const raf = requestAnimationFrame(() => {
      fg.zoom(initialCam.k, 0)
      fg.centerAt(initialCam.x, initialCam.y, 0)
    })
    return () => cancelAnimationFrame(raf)
  }, [initialCam, size.width])

  // Ease the camera to the selected node. Coordinates are populated on the
  // node objects by the running simulation.
  useEffect(() => {
    if (!selectedId || !fgRef.current) return
    const node = (data.nodes as GNode[]).find((n) => String(n.id) === selectedId)
    if (node?.x == null || node?.y == null) return
    fgRef.current.centerAt(node.x, node.y, 450)
    fgRef.current.zoom(2.5, 450)
  }, [selectedId, data.nodes])

  // Frame the whole chain when a new path arrives — its endpoints are usually
  // far apart. Keyed on the chain's contents, not the array identity, so an
  // unrelated filter change that rebuilds an identical array does not re-zoom.
  // JSON, not join('>'), because a path can run through a ghost node whose id
  // is `ghost:<title>` and a title may contain any character.
  const pathKey = path ? JSON.stringify(path) : ''
  useEffect(() => {
    if (!pathKey || !fgRef.current) return
    const ids = new Set<string>(JSON.parse(pathKey))
    fgRef.current.zoomToFit(450, 60, (n: GNode) => ids.has(String(n.id)))
  }, [pathKey])

  const linkColor = useCallback(
    (link: GLink) => {
      const onPath = pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))
      if (pathEdges) return onPath ? PATH_ACCENT : 'rgba(160,160,160,0.08)'
      // Mutual (A↔B) links read as the stronger ties: brighter and bluer at rest
      // than the greyer one-way links.
      if (neighbourIds == null) return link.mutual ? 'rgba(150,180,255,0.5)' : 'rgba(160,160,160,0.28)'
      const active = neighbourIds.has(endId(link.source)) && neighbourIds.has(endId(link.target))
      if (!active) return 'rgba(160,160,160,0.08)'
      return link.mutual ? 'rgba(190,210,255,0.95)' : 'rgba(170,185,225,0.7)'
    },
    [pathEdges, neighbourIds],
  )

  // Mutual links also draw thicker, so reciprocity reads even without colour;
  // a path hop draws thicker still.
  const linkWidth = useCallback(
    (link: GLink) => {
      if (pathEdges?.has(edgeKey(endId(link.source), endId(link.target)))) return 4
      return link.mutual ? 2.5 : 1
    },
    [pathEdges],
  )

  return (
    <div ref={wrapRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ForceGraph2D<GraphNode, GraphLink>
        ref={fgRef}
        width={size.width}
        height={size.height}
        graphData={data}
        nodeId="id"
      nodeCanvasObject={paintNode}
      nodePointerAreaPaint={(node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, radiusFor(node.degree) + 2, 0, 2 * Math.PI)
        ctx.fill()
      }}
      linkColor={linkColor}
      linkWidth={linkWidth}
      linkDirectionalArrowColor={linkColor}
      linkDirectionalArrowLength={showArrows ? 4 : 0}
      linkDirectionalArrowRelPos={1}
      onNodeHover={(node) => setHoverId(node ? String(node.id) : null)}
      onNodeClick={(node: GNode) => {
        if (node.ghost) {
          onGhostClick(node.title)
          return
        }
        const id = String(node.id)
        if (clickTimer.current != null) {
          window.clearTimeout(clickTimer.current)
          clickTimer.current = null
          navigate(`/page/${id}`)
        } else {
          clickTimer.current = window.setTimeout(() => {
            clickTimer.current = null
            onSelect(id)
          }, 250)
        }
      }}
      onNodeDragEnd={(node: GNode) => {
        // Stick the node where it was dropped; persist real pages only
        // (ghost ids are ephemeral, so their pins would not survive a rebuild).
        node.fx = node.x
        node.fy = node.y
        if (!node.ghost && node.x != null && node.y != null) {
          onPinNode(String(node.id), node.x, node.y)
        }
      }}
      onBackgroundClick={() => onSelect(null)}
      onZoomEnd={(t: { k: number; x: number; y: number }) => {
        // force-graph reports the gesture-end transform merged with the current
        // graph-space centre, so x/y are already in the form centerAt() expects.
        onCamChange({ k: t.k, x: t.x, y: t.y })
      }}
      backgroundColor="#15130f"
      />
      {size.width > 0 && (
        <GraphMinimap
          nodes={data.nodes as GNode[]}
          fgRef={fgRef}
          viewW={size.width}
          viewH={size.height}
        />
      )}
    </div>
  )
}
