import { radiusFor } from './graphGeometry'
import { nodeFill, type ColorBy } from './graphColor'
import { saveFile } from './platform'
import type { GraphData, GraphNode, GraphLink } from './db'
import type { TagFilter } from './tagFilter'

// Solid dark background matching the live graph canvas, so the light labels and
// edges stay readable when the image is pasted onto any surface.
export const EXPORT_BG = '#15130f'
export const LABEL_COLOR = '#e9e1d2'
export const GHOST_COLOR = '#8a8270'

// Padding around the node bounding box (graph units) — enough for the largest
// node radius plus a line of label text below it.
const PAD = 48

// Rough px-per-character estimate for the 12px sans-serif label font, used to
// reserve horizontal room for a node's label (which is center-anchored and can
// be wider than the node itself). Not exact glyph metrics — buildScene stays
// pure (no canvas/measureText) — just enough to keep long titles from clipping.
const LABEL_CHAR_W = 7

// Rest-state link styling, mirrored from GraphView.linkColor / linkWidth (the
// no-focus branch) so an exported image matches the graph at rest.
const MUTUAL_LINK = { color: 'rgba(150,180,255,0.5)', width: 2.5 }
const ONEWAY_LINK = { color: 'rgba(160,160,160,0.28)', width: 1 }

export interface SceneNode {
  x: number
  y: number
  r: number
  /** Fill colour for real pages; null for ghosts (drawn as a dashed stroke). */
  fill: string | null
  ghost: boolean
  title: string
  labelColor: string
}

export interface SceneLink {
  x1: number
  y1: number
  x2: number
  y2: number
  color: string
  width: number
}

export interface GraphScene {
  minX: number
  minY: number
  width: number
  height: number
  background: string
  nodes: SceneNode[]
  links: SceneLink[]
}

// The sim augments nodes with x/y in place; accept that richer shape.
type Positioned = GraphNode & { x?: number; y?: number }

// A link end is an id string before the sim runs and the resolved node object
// after; recover the id either way (mirrors GraphView.endId).
function endId(end: string | Positioned): string {
  return typeof end === 'object' ? String(end.id) : end
}

/**
 * Build a serialisable scene from the *filtered* graph. Nodes are expected to
 * carry x/y from the running force simulation. Un-positioned nodes are skipped
 * (and any link touching them dropped). Returns null when no node has settled
 * yet, so callers can show a "still settling" message instead of a blank image.
 */
export function buildScene(
  data: GraphData,
  opts: { colorBy: ColorBy; tagFilter: TagFilter; islandColors: Map<string, string> },
): GraphScene | null {
  const positioned = new Map<string, Positioned>()
  const sceneNodes: SceneNode[] = []

  for (const n of data.nodes as Positioned[]) {
    if (n.x == null || n.y == null) continue
    positioned.set(String(n.id), n)
    const ghost = !!n.ghost
    sceneNodes.push({
      x: n.x,
      y: n.y,
      r: radiusFor(n.degree),
      fill: ghost ? null : nodeFill(n, opts.colorBy, opts.tagFilter, opts.islandColors),
      ghost,
      title: n.title,
      labelColor: ghost ? GHOST_COLOR : LABEL_COLOR,
    })
  }

  if (sceneNodes.length === 0) return null

  const sceneLinks: SceneLink[] = []
  for (const l of data.links as Array<GraphLink & { source: string | Positioned; target: string | Positioned }>) {
    const s = positioned.get(endId(l.source))
    const t = positioned.get(endId(l.target))
    if (!s || !t) continue
    const style = l.mutual ? MUTUAL_LINK : ONEWAY_LINK
    sceneLinks.push({ x1: s.x!, y1: s.y!, x2: t.x!, y2: t.y!, color: style.color, width: style.width })
  }

  // Bounding box over node centres expanded by each node's radius, then padded.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of sceneNodes) {
    const halfLabelW = (n.title.length * LABEL_CHAR_W) / 2
    const rx = Math.max(n.r, halfLabelW)
    minX = Math.min(minX, n.x - rx)
    minY = Math.min(minY, n.y - n.r)
    maxX = Math.max(maxX, n.x + rx)
    maxY = Math.max(maxY, n.y + n.r)
  }
  minX -= PAD
  minY -= PAD
  maxX += PAD
  maxY += PAD

  return {
    minX,
    minY,
    width: maxX - minX,
    height: maxY - minY,
    background: EXPORT_BG,
    nodes: sceneNodes,
    links: sceneLinks,
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Fixed label size in graph units (the live view uses 12/scale; a static export
// has no zoom, so a constant reads consistently against node radii).
const LABEL_FONT = 12

/** Render a scene to a standalone SVG document string. */
export function sceneToSvg(scene: GraphScene): string {
  const parts: string[] = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${scene.minX} ${scene.minY} ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}">`,
  )
  parts.push(
    `<rect x="${scene.minX}" y="${scene.minY}" width="${scene.width}" height="${scene.height}" fill="${scene.background}"/>`,
  )

  for (const l of scene.links) {
    parts.push(
      `<line x1="${l.x1}" y1="${l.y1}" x2="${l.x2}" y2="${l.y2}" stroke="${l.color}" stroke-width="${l.width}"/>`,
    )
  }

  for (const n of scene.nodes) {
    if (n.ghost) {
      parts.push(
        `<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="none" stroke="${GHOST_COLOR}" stroke-width="1.5" stroke-dasharray="3 3"/>`,
      )
    } else {
      parts.push(`<circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.fill}"/>`)
    }
  }

  for (const n of scene.nodes) {
    parts.push(
      `<text x="${n.x}" y="${n.y + n.r + 1}" fill="${n.labelColor}" font-family="sans-serif" font-size="${LABEL_FONT}" text-anchor="middle" dominant-baseline="hanging">${escapeXml(n.title)}</text>`,
    )
  }

  parts.push('</svg>')
  return parts.join('')
}

/** Wrap an SVG string as a downloadable Blob. */
export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: 'image/svg+xml' })
}

// Retina scale for the raster export so labels stay crisp.
const PNG_SCALE = 2

/** Rasterise a scene to a PNG Blob via an offscreen canvas. */
export function sceneToPng(scene: GraphScene): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.ceil(scene.width * PNG_SCALE))
    canvas.height = Math.max(1, Math.ceil(scene.height * PNG_SCALE))
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('2D canvas context unavailable'))
      return
    }

    ctx.scale(PNG_SCALE, PNG_SCALE)
    ctx.translate(-scene.minX, -scene.minY)

    // Background.
    ctx.fillStyle = scene.background
    ctx.fillRect(scene.minX, scene.minY, scene.width, scene.height)

    // Links.
    for (const l of scene.links) {
      ctx.beginPath()
      ctx.moveTo(l.x1, l.y1)
      ctx.lineTo(l.x2, l.y2)
      ctx.strokeStyle = l.color
      ctx.lineWidth = l.width
      ctx.stroke()
    }

    // Nodes.
    for (const n of scene.nodes) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, n.r, 0, 2 * Math.PI)
      if (n.ghost) {
        ctx.setLineDash([3, 3])
        ctx.lineWidth = 1.5
        ctx.strokeStyle = GHOST_COLOR
        ctx.stroke()
        ctx.setLineDash([])
      } else {
        ctx.fillStyle = n.fill as string
        ctx.fill()
      }
    }

    // Labels.
    ctx.font = `${LABEL_FONT}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    for (const n of scene.nodes) {
      ctx.fillStyle = n.labelColor
      ctx.fillText(n.title, n.x, n.y + n.r + 1)
    }

    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob returned null'))
    }, 'image/png')
  })
}

/** Save a Blob to a user-visible file via the platform seam (browser
 *  download, or a native Save-As dialog in the desktop shell). */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  await saveFile(blob, filename)
}

/** Build a filename-safe export name: graph-<slug>-YYYY-MM-DD.<ext>. */
export function graphFilename(loreName: string, ext: 'png' | 'svg'): string {
  const slug =
    loreName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'world'
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `graph-${slug}-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.${ext}`
}
