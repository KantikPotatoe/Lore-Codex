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
