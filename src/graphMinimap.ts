/** Pure coordinate math for the graph minimap: fit the simulation's node
 *  cloud into a small canvas, and project the main view's camera onto it.
 *  Kept React/canvas-free so it's trivially unit-testable. */

export interface Bounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/** graph-space → minimap-px affine map: mini = graph * scale + offset. */
export interface MiniMapping {
  scale: number
  offsetX: number
  offsetY: number
}

/** Bounding box of all positioned nodes; null until the simulation has coords. */
export function nodeBounds(nodes: Array<{ x?: number; y?: number }>): Bounds | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    if (n.x == null || n.y == null) continue
    if (n.x < minX) minX = n.x
    if (n.x > maxX) maxX = n.x
    if (n.y < minY) minY = n.y
    if (n.y > maxY) maxY = n.y
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY }
}

/** Fit `bounds` into a miniW×miniH canvas with `pad` px of breathing room,
 *  preserving aspect ratio and centring the loose axis. Degenerate bounds
 *  (single node) are clamped to a 1×1 span so the mapping stays finite. */
export function fitMapping(bounds: Bounds, miniW: number, miniH: number, pad = 8): MiniMapping {
  const w = Math.max(bounds.maxX - bounds.minX, 1)
  const h = Math.max(bounds.maxY - bounds.minY, 1)
  const scale = Math.min((miniW - pad * 2) / w, (miniH - pad * 2) / h)
  const offsetX = pad + (miniW - pad * 2 - w * scale) / 2 - bounds.minX * scale
  const offsetY = pad + (miniH - pad * 2 - h * scale) / 2 - bounds.minY * scale
  return { scale, offsetX, offsetY }
}

export function toMini(m: MiniMapping, x: number, y: number): { x: number; y: number } {
  return { x: x * m.scale + m.offsetX, y: y * m.scale + m.offsetY }
}

export function toGraph(m: MiniMapping, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - m.offsetX) / m.scale, y: (my - m.offsetY) / m.scale }
}

/** The main viewport (viewW×viewH at zoom k, centred on cx,cy) in minimap px. */
export function viewportRect(
  m: MiniMapping,
  cam: { k: number; cx: number; cy: number },
  viewW: number,
  viewH: number,
): { x: number; y: number; w: number; h: number } {
  const gw = viewW / cam.k
  const gh = viewH / cam.k
  const tl = toMini(m, cam.cx - gw / 2, cam.cy - gh / 2)
  return { x: tl.x, y: tl.y, w: gw * m.scale, h: gh * m.scale }
}
