import { categoryColor, statusColor, type GraphNode } from './db'

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
  highlightTag: string,
  islandColors?: Map<string, string>,
): string {
  if (colorBy === 'status') return statusColor(node.status)
  if (colorBy === 'tag') {
    return highlightTag !== '' && node.tags.includes(highlightTag) ? TAG_ACCENT : MUTED
  }
  if (colorBy === 'island') return islandColors?.get(node.id) ?? MUTED
  return categoryColor(node.category)
}
