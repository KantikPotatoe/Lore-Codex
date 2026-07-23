import { isImportableType, planImageImport } from './imageImport'

/**
 * Resize an image to fit within maxDim × maxDim and re-encode as JPEG.
 * If the image is already smaller, it is not upscaled — only quality-converted.
 * Returns a compressed data URL.
 *
 * Prefers the off-main-thread path: `createImageBitmap` decodes off-thread and
 * `OffscreenCanvas.convertToBlob` encodes asynchronously, so a large (e.g. 20MP)
 * photo no longer freezes the editor on the synchronous `toDataURL` encode (#187).
 * Falls back to the classic `<img>` + `canvas.toDataURL` path where those APIs
 * aren't available or fail.
 */
export async function compressImage(file: File, maxDim: number, quality = 0.85): Promise<string> {
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    try {
      return await compressOffThread(file, maxDim, quality)
    } catch {
      // Fall through to the DOM path on any failure (codec quirk, worker denied, …).
    }
  }
  return compressWithImageElement(file, maxDim, quality)
}

async function compressOffThread(file: File, maxDim: number, quality: number): Promise<string> {
  // `imageOrientation: 'from-image'` matches the <img> path, which honours EXIF
  // orientation — without it, phone photos can come out rotated.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = new OffscreenCanvas(w, h)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
    return await blobToDataUrl(blob)
  } finally {
    bitmap.close()
  }
}

function compressWithImageElement(file: File, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.round(img.naturalWidth * scale)
        const h = Math.round(img.naturalHeight * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => resolve(reader.result as string)
    reader.readAsDataURL(blob)
  })
}

/** Thrown by `importImage` when the picked file is not a format we store. */
export class UnsupportedImageError extends Error {
  readonly type: string

  constructor(type: string) {
    super(`Unsupported image type: ${type || 'unknown'}`)
    this.name = 'UnsupportedImageError'
    this.type = type
  }
}

export interface ImportedImage {
  dataUrl: string
  /** Rendered dimensions of what was stored (post-resize where one happened). */
  width: number
  height: number
  /** The original dimensions, set only when the source exceeded `maxDim`. */
  downscaledFrom: { width: number; height: number } | null
}

/**
 * Store an image at full quality: original bytes verbatim when it fits within
 * `maxDim`, a format-preserving downscale when it does not. Unlike
 * `compressImage` this never re-encodes an image that fits, so a lossless
 * source round-trips bit-identically (#246).
 *
 * Mirrors `compressImage`'s two-path structure: `createImageBitmap` +
 * `OffscreenCanvas` where available, `<img>` + `canvas` otherwise.
 * Throws `UnsupportedImageError` for a type we refuse to store.
 */
export async function importImage(file: File, maxDim: number): Promise<ImportedImage> {
  // Checked before any decode: a cheap early exit, and the only part of this
  // function that can be unit-tested (happy-dom has no canvas).
  if (!isImportableType(file.type)) throw new UnsupportedImageError(file.type)

  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
    try {
      return await importOffThread(file, maxDim)
    } catch {
      // Fall through to the DOM path on any decode/encode failure (codec quirk,
      // worker denied, …), exactly as compressImage does.
    }
  }
  return importWithImageElement(file, maxDim)
}

async function importOffThread(file: File, maxDim: number): Promise<ImportedImage> {
  // `imageOrientation: 'from-image'` makes the measured size match what an
  // <img> will render — CSS image-orientation defaults to from-image — so an
  // EXIF-rotated JPEG stored verbatim still lays out correctly.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const { width, height } = bitmap
  const plan = planImageImport(file.type, width, height, maxDim)
  if (plan.kind !== 'resize') {
    // Verbatim path: the bitmap was only needed to measure width/height, both
    // already read above. Close it now — before the FileReader base64-encodes
    // the file — instead of holding up to 268 MB of decoded RGBA retained for
    // the duration of an ~80 MB encode it no longer contributes to.
    bitmap.close()
    // 'reject' is unreachable — importImage checked the type already.
    return { dataUrl: await blobToDataUrl(file), width, height, downscaledFrom: null }
  }
  try {
    const canvas = new OffscreenCanvas(plan.width, plan.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, plan.width, plan.height)
    const blob = await canvas.convertToBlob({ type: plan.mime, quality: plan.quality })
    return {
      dataUrl: await blobToDataUrl(blob),
      width: plan.width,
      height: plan.height,
      downscaledFrom: { width, height },
    }
  } finally {
    bitmap.close()
  }
}

function importWithImageElement(file: File, maxDim: number): Promise<ImportedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      // FileReader already produced the verbatim data URL; the no-resize path
      // reuses it rather than reading the file a second time.
      const original = reader.result as string
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const width = img.naturalWidth
        const height = img.naturalHeight
        const plan = planImageImport(file.type, width, height, maxDim)
        if (plan.kind !== 'resize') {
          resolve({ dataUrl: original, width, height, downscaledFrom: null })
          return
        }
        const canvas = document.createElement('canvas')
        canvas.width = plan.width
        canvas.height = plan.height
        canvas.getContext('2d')!.drawImage(img, 0, 0, plan.width, plan.height)
        resolve({
          dataUrl: canvas.toDataURL(plan.mime, plan.quality),
          width: plan.width,
          height: plan.height,
          downscaledFrom: { width, height },
        })
      }
      img.src = original
    }
    reader.readAsDataURL(file)
  })
}
