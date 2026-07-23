/**
 * Import policy for map images, kept pure so it is testable without a canvas —
 * happy-dom provides neither `createImageBitmap` nor a real 2D context, so the
 * executor (`imageUtils.importImage`) can only be verified by hand. This module
 * is the part that can be proved.
 *
 * The rule is verbatim-below-the-cap, format-preserving-above-it. Map upload
 * used to run every file through `compressImage`, which is hardcoded to JPEG,
 * so even a small lossless PNG was thrown through a lossy codec — and maps are
 * hard edges (borders, coastlines, labels), exactly what JPEG degrades worst.
 * The dimension cap is kept: Leaflet decodes the full raster, so 8192² is
 * already ~268 MB of RGBA in the webview (#246).
 */

/** Raster formats accepted on import. SVG is excluded deliberately: it can
 *  embed <script>, so it must never reach the DB or a render path. Same
 *  reasoning as `isCleanImageDataUrl` in db/backup.ts. */
export const IMPORTABLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

/** Quality for the one case that must re-encode: an over-cap JPEG being
 *  resampled. Matches the value map upload used before #246. */
export const JPEG_RESIZE_QUALITY = 0.92

export type ImportPlan =
  | { kind: 'reject'; reason: 'type' }
  | { kind: 'verbatim' }
  | { kind: 'resize'; width: number; height: number; mime: string; quality?: number }

export function isImportableType(type: string): boolean {
  return (IMPORTABLE_IMAGE_TYPES as readonly string[]).includes(type)
}

/**
 * Decide how to store `file` given its type and natural dimensions.
 * Total over every input: an unsupported type rejects whatever its size.
 */
export function planImageImport(
  type: string,
  width: number,
  height: number,
  maxDim: number,
): ImportPlan {
  if (!isImportableType(type)) return { kind: 'reject', reason: 'type' }

  const longest = Math.max(width, height)
  if (longest <= maxDim) return { kind: 'verbatim' }

  // Scale on the long edge. Clamp to >= 1: an extreme aspect ratio (a 100000x1
  // strip) rounds the short edge to 0, which is a zero-area canvas.
  const scale = maxDim / longest
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))

  // Preserve the codec family. A JPEG is already lossy, so re-encoding it as
  // JPEG costs one generation; promoting it to PNG would only inflate it. A
  // lossless source resamples to PNG so the downscale itself stays lossless.
  return type === 'image/jpeg'
    ? { kind: 'resize', width: w, height: h, mime: 'image/jpeg', quality: JPEG_RESIZE_QUALITY }
    : { kind: 'resize', width: w, height: h, mime: 'image/png' }
}
