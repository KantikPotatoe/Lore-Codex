import { categoryColor, statusColor, type GraphNode, type GraphLink } from './db'
import { matchesTags, type TagFilter } from './tagFilter'

/** Which dimension drives a graph node's fill colour. */
export type ColorBy = 'type' | 'status' | 'tag' | 'island'

// Accent for nodes carrying the highlighted tag; muted grey for the rest (and
// for tag mode with no tag chosen). Both read against the #15130f graph canvas.
// MUTED is a neutral grey kept a touch brighter than the ghost colour (#8a8270)
// and desaturated to stay distinct from it, so a de-emphasised real node still
// reads as more present than a "missing page" ghost — important in 3D where both
// are solid spheres. The saturated accent still dominates by hue, not brightness.
export const TAG_ACCENT = '#4fc3d9'
export const MUTED = '#8a8a84'

// The shortest-path highlight. Applied to link strokes and endpoint rings only —
// never to node fills — so a highlighted chain still shows each page's type or
// island colour, and the accent can't collide with an island fill.
export const PATH_ACCENT = '#f0c060'

// Distinct hues for connected-component ("island") colouring, ordered so the
// first few are the most visually separable. Chosen to read on the #15130f
// canvas; colours cycle when a world has more clusters than entries.
export const ISLAND_PALETTE = [
  '#4fc3d9', // cyan
  '#e0607e', // rose
  '#7bd672', // green
  '#e8a13a', // amber
  '#9b8cf0', // violet
  '#e57ac0', // magenta
  '#d9c04f', // gold
  '#5b9bd9', // blue
  '#7bd6a8', // teal
  '#c98a5a', // clay
]

/** Map each node id to its island colour: MUTED for lone pages (size-1
 *  components) so clusters stand out, otherwise a palette colour keyed by the
 *  component's size rank (0 = largest). */
export function islandColorOf(
  componentOf: Map<string, number>,
  sizes: number[],
): Map<string, string> {
  const colors = new Map<string, string>()
  for (const [id, rank] of componentOf) {
    colors.set(id, sizes[rank] === 1 ? MUTED : ISLAND_PALETTE[rank % ISLAND_PALETTE.length])
  }
  return colors
}

/** Fill colour for a NON-ghost graph node under the active colour mode. Ghost
 *  nodes keep their own dashed/muted rendering in the callers, so this is only
 *  ever called for real pages. */
export function nodeFill(
  node: GraphNode,
  colorBy: ColorBy,
  tagFilter: TagFilter,
  islandColors?: Map<string, string>,
): string {
  if (colorBy === 'status') return statusColor(node.status)
  if (colorBy === 'tag') {
    // The explicit length check matters: `matchesTags` treats an empty
    // selection as "passes", but an empty selection here must leave the whole
    // graph muted — there is nothing to highlight yet.
    return tagFilter.tags.length > 0 && matchesTags(node.tags, tagFilter) ? TAG_ACCENT : MUTED
  }
  if (colorBy === 'island') return islandColors?.get(node.id) ?? MUTED
  return categoryColor(node.category)
}

// react-force-graph's `nodeLabel`/`linkLabel` props reach float-tooltip's
// `state.tooltipEl.html(content)` — d3's `.html()`, i.e. innerHTML — so every
// string this module emits for a hover tooltip bypasses React's escaping and
// must be escaped here. Both sinks are fed attacker-reachable text: relationship
// type labels and page titles are free text, editable in the UI and, critically,
// written verbatim by `importAll` (which scrubs page `content` and event
// `description`, but not titles or relationship types). `&` must be escaped
// first, or the entities introduced by the other replacements would themselves
// get escaped.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Hover-tooltip text for a graph node — the title, escaped for the innerHTML
 *  sink described above (#244). Renderers pass this as a `nodeLabel` accessor
 *  rather than naming the raw `title` property. */
export function nodeTooltip(node: GraphNode): string {
  return escapeHtml(node.title)
}

// ---------------------------------------------------------------------------
// Link styling (#137) — the single authority
// ---------------------------------------------------------------------------
// GraphView and graphExport used to derive rest-state link colour separately,
// with graphExport carrying hand-copied constants and a comment admitting it.
// A third styling dimension would have been the copy that drifted, so all
// three consumers — GraphView, GraphView3D and graphExport — now read what
// this computes once, in GraphRoute's filter memo.

/** When a link's arrow is drawn. A relationship's direction is meaning (parent
 *  vs child), so it is not the user's to toggle; a wiki link's direction is
 *  trivia about who typed the link, so it is. */
export type ArrowMode = 'always' | 'never' | 'toggle'

/** Whether a link draws its arrowhead. The mode is data (`linkStyle` decides
 *  it from the relationship type); this is its one interpretation, shared so a
 *  new ArrowMode member cannot silently mean "no arrow" in one view only. Each
 *  view keeps its own arrow *length* — that is per-view calibration. */
export function drawsArrow(arrow: ArrowMode, showArrows: boolean): boolean {
  if (arrow === 'always') return true
  if (arrow === 'never') return false
  return showArrows
}

export interface LinkStyle {
  /** Orientation after the visible primary relation is applied — may swap the
   *  input's ends so the arrow can always be drawn at the target. */
  source: string
  target: string
  /** At rest. */
  color: string
  /** Inside the hover/selection focus neighbourhood. */
  activeColor: string
  width: number
  /** Rest colour on the 3D canvas. 3D is calibrated separately — see the
   *  constants block below. */
  color3d: string
  /** 3D line width, in three.js world units rather than pixels. */
  width3d: number
  arrow: ArrowMode
  /** Hover tooltip text; '' for a wiki-only edge. */
  labels: string
}

/** A filtered link carrying its own presentation. */
export type DrawnLink = GraphLink & LinkStyle

/** The filtered graph as the renderers receive it. */
export interface DrawnGraphData {
  nodes: GraphNode[]
  links: DrawnLink[]
}

// Rest and lit styling for wiki links, unchanged from what GraphView drew
// before — now stated once. The `3d` pair is a second calibration of the same
// edge, not drift: 3D links are thin lines over a dark WebGL scene at varying
// depth, so they need more alpha to read, and three.js line widths are world
// units rather than pixels, so 2D's 2.5 would render as a slab. Both tiers sit
// on adjacent lines so that changing one and forgetting the other is visible in
// the diff. There is no `active3d`: 3D has no hover, focus or path machinery,
// so it has no lit state.
const MUTUAL = {
  color: 'rgba(150,180,255,0.5)', active: 'rgba(190,210,255,0.95)', width: 2.5,
  color3d: 'rgba(150,180,255,0.8)', width3d: 1.4,
}
const ONEWAY = {
  color: 'rgba(160,160,160,0.28)', active: 'rgba(170,185,225,0.7)', width: 1,
  color3d: 'rgba(160,160,160,0.4)', width3d: 0.5,
}

// A typed edge is the strongest statement on the canvas, so it draws at the
// mutual width; the type's hue is what separates it from a mutual wiki link.
const RELATION_WIDTH = MUTUAL.width
const RELATION_REST_ALPHA = 0.75
// Width matches the 3D mutual width, for the same reason RELATION_WIDTH
// matches the 2D one.
const RELATION_WIDTH_3D = MUTUAL.width3d

/** '#rrggbb' + alpha → 'rgba(r, g, b, a)'. Input that isn't six-digit hex is
 *  returned unchanged: a relationship type's colour is user-editable, and a
 *  hand-entered 'tomato' should render as tomato rather than blank the edge. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return hex
  const n = parseInt(m[1], 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Rest-state presentation for one link, or null when it should not be drawn at
 * all — every relationship on it is filtered out and there is no wiki link
 * underneath.
 *
 * `link.relations` arrives sorted lowest-`order`-first from buildGraphData, so
 * the first visible entry is the primary: it supplies the colour, the arrow
 * mode, and the orientation.
 */
export function linkStyle(link: GraphLink, hiddenRelTypes: Set<string>): LinkStyle | null {
  const visible = link.relations.filter((r) => !hiddenRelTypes.has(r.typeId))

  if (visible.length === 0) {
    if (!link.wiki) return null
    const s = link.mutual ? MUTUAL : ONEWAY
    return {
      source: link.source,
      target: link.target,
      color: s.color,
      activeColor: s.active,
      width: s.width,
      color3d: s.color3d,
      width3d: s.width3d,
      arrow: 'toggle',
      labels: '',
    }
  }

  // Hiding the type that oriented the edge can promote one stored the other way
  // round. Swapping here keeps the arrow drawable at the target end, which is
  // the only position react-force-graph offers.
  const primary = visible[0]
  const swap = primary.reversed
  return {
    source: swap ? link.target : link.source,
    target: swap ? link.source : link.target,
    color: withAlpha(primary.color, RELATION_REST_ALPHA),
    activeColor: primary.color,
    width: RELATION_WIDTH,
    // Full opacity, not RELATION_REST_ALPHA: the ~1.5x alpha boost the wiki
    // pair gets going into 3D would put 0.75 past 1, so the typed edge skips
    // the rest-state fade in 3D rather than clip.
    color3d: primary.color,
    width3d: RELATION_WIDTH_3D,
    arrow: primary.directed ? 'always' : 'never',
    // Per-edge, not per-relation: once the orientation flips, every label on
    // the edge reads the other way.
    labels: visible.map((r) => escapeHtml(swap ? r.inverseLabel : r.label)).join(' · '),
  }
}
