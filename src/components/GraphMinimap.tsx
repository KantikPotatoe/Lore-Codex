import { useEffect, useRef } from 'react'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import type { GraphNode, GraphLink } from '../db'
import { nodeBounds, fitMapping, toMini, toGraph, viewportRect, type MiniMapping } from '../graphMinimap'

type GNode = NodeObject<GraphNode>
type GLink = LinkObject<GraphNode, GraphLink>

const W = 180
const H = 130

/** Always-on overview in the graph's corner: every node as a dot, plus a gold
 *  rectangle for the current viewport. Click / drag pans the main camera.
 *  Redraws on a rAF loop — node counts are wiki-scale, so a full repaint per
 *  frame is far cheaper than trying to diff simulation state. */
export default function GraphMinimap({
  nodes,
  fgRef,
  viewW,
  viewH,
}: {
  nodes: GNode[]
  /** The main view's force-graph ref (shared, not owned). */
  fgRef: { current: ForceGraphMethods<GNode, GLink> | undefined }
  viewW: number
  viewH: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // Last mapping used to draw, so pointer events invert the same projection.
  const mappingRef = useRef<MiniMapping | null>(null)

  useEffect(() => {
    let raf = 0
    const dpr = window.devicePixelRatio || 1
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const fg = fgRef.current
      if (!canvas || !fg) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W, H)

      const bounds = nodeBounds(nodes)
      if (!bounds) return
      const m = fitMapping(bounds, W, H)
      mappingRef.current = m

      for (const n of nodes) {
        if (n.x == null || n.y == null) continue
        const p = toMini(m, n.x, n.y)
        ctx.beginPath()
        ctx.arc(p.x, p.y, 1.5, 0, 2 * Math.PI)
        if (n.ghost) {
          ctx.strokeStyle = 'rgba(138, 130, 112, 0.7)'
          ctx.stroke()
        } else {
          ctx.fillStyle = 'rgba(233, 225, 210, 0.75)'
          ctx.fill()
        }
      }

      // Viewport rectangle from the live camera transform (zoom()/centerAt()
      // are getter-setters when called with no arguments).
      const k = fg.zoom()
      const c = fg.centerAt() as { x: number; y: number }
      const r = viewportRect(m, { k, cx: c.x, cy: c.y }, viewW, viewH)
      ctx.strokeStyle = 'rgba(201, 162, 75, 0.9)'
      ctx.lineWidth = 1
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [nodes, fgRef, viewW, viewH])

  function panTo(e: React.MouseEvent<HTMLCanvasElement>) {
    const m = mappingRef.current
    const fg = fgRef.current
    if (!m || !fg) return
    const rect = e.currentTarget.getBoundingClientRect()
    const g = toGraph(m, e.clientX - rect.left, e.clientY - rect.top)
    fg.centerAt(g.x, g.y, 200)
  }

  return (
    <canvas
      ref={canvasRef}
      className="graph-minimap"
      width={W * (window.devicePixelRatio || 1)}
      height={H * (window.devicePixelRatio || 1)}
      style={{ width: W, height: H }}
      onMouseDown={panTo}
      onMouseMove={(e) => { if (e.buttons === 1) panTo(e) }}
    />
  )
}
