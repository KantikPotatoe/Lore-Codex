# Full-Quality Map Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop map upload from re-encoding every image to JPEG — store the original bytes verbatim below the 8192px cap, and preserve the source format when an oversized image must be downscaled.

**Architecture:** A new pure module `src/imageImport.ts` decides what to do with a file (reject / verbatim / resize) as a total function of `(mimeType, width, height, maxDim)`. A new `importImage()` in `src/imageUtils.ts` executes that decision, mirroring `compressImage`'s existing two-path structure (`createImageBitmap` + `OffscreenCanvas`, falling back to `<img>` + `canvas`). `MapRoute` calls it instead of `compressImage`. The existing `compressImage` is **not modified** — the five other call sites keep today's behaviour.

**Tech Stack:** TypeScript (strict), React 19, Vite, Vitest + happy-dom, Dexie, Leaflet.

**Spec:** `docs/superpowers/specs/2026-07-23-full-quality-map-import-design.md` · **Issue:** #246 · **Branch:** `feat/246-full-quality-map-import` (already created from `origin/main`)

## Global Constraints

- **Scope is maps only.** Do not modify `compressImage`, and do not touch the `compressImage` calls in `ImageGallery.tsx` (1600), `LoreEditor.tsx` (1600), `Infobox.tsx` (800), `HomeRoute.tsx` (1600), or `LoreSelectorRoute.tsx` (1200).
- **Accepted types are exactly `image/png`, `image/jpeg`, `image/webp`.** SVG is excluded deliberately — it can embed `<script>`.
- **Cap stays 8192px.** It guards Leaflet's full-raster decode (8192² ≈ 268 MB of RGBA); this change is about format, not the cap.
- **No host `alert()`/`confirm()`** — use `ConfirmDialog` (`hideCancel` for notices). wry renders host dialogs unreliably.
- **TS `strict`.** Run `npm run lint`, `npm run build`, and `npm run test:run` before claiming done — CI runs all three.
- **`src/imageImport.ts` lives at `src/`, not `src/db/`** — it has no runtime `db` import. It does **not** get re-exported from the `db` barrel.
- Commit messages end with:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Pure import policy — `src/imageImport.ts`

The decision table, with no DOM. This is where all the real test coverage lives: happy-dom provides neither `createImageBitmap` nor a real 2D canvas context, so the executor in Task 2 cannot be meaningfully unit-tested.

**Files:**
- Create: `src/imageImport.ts`
- Test: `src/imageImport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `IMPORTABLE_IMAGE_TYPES`, `JPEG_RESIZE_QUALITY`, `type ImportPlan`, `isImportableType(type: string): boolean`, `planImageImport(type: string, width: number, height: number, maxDim: number): ImportPlan` — all used by Task 2.

- [ ] **Step 1: Write the failing test**

Create `src/imageImport.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  planImageImport, isImportableType, JPEG_RESIZE_QUALITY, type ImportPlan,
} from './imageImport'

const CAP = 8192

describe('isImportableType', () => {
  it('accepts the three raster formats we can safely store', () => {
    expect(isImportableType('image/png')).toBe(true)
    expect(isImportableType('image/jpeg')).toBe(true)
    expect(isImportableType('image/webp')).toBe(true)
  })

  it('rejects SVG, other formats, and a missing type', () => {
    // SVG can embed <script>; it must never reach the DB or a render path.
    expect(isImportableType('image/svg+xml')).toBe(false)
    expect(isImportableType('image/gif')).toBe(false)
    expect(isImportableType('application/pdf')).toBe(false)
    expect(isImportableType('')).toBe(false)
  })
})

describe('planImageImport — rejection', () => {
  it('rejects an unsupported type regardless of size', () => {
    expect(planImageImport('image/svg+xml', 10, 10, CAP)).toEqual({ kind: 'reject', reason: 'type' })
    expect(planImageImport('image/gif', 99999, 99999, CAP)).toEqual({ kind: 'reject', reason: 'type' })
    expect(planImageImport('', 10, 10, CAP)).toEqual({ kind: 'reject', reason: 'type' })
  })
})

describe('planImageImport — verbatim below the cap', () => {
  it('stores original bytes for every accepted format under the cap', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      expect(planImageImport(type, 4000, 3000, CAP)).toEqual({ kind: 'verbatim' })
    }
  })

  it('treats exactly-at-the-cap as within it', () => {
    expect(planImageImport('image/png', CAP, 100, CAP)).toEqual({ kind: 'verbatim' })
    expect(planImageImport('image/png', 100, CAP, CAP)).toEqual({ kind: 'verbatim' })
  })

  it('never upscales a small image', () => {
    expect(planImageImport('image/png', 32, 32, CAP)).toEqual({ kind: 'verbatim' })
  })
})

describe('planImageImport — format-preserving resize above the cap', () => {
  it('keeps a lossless source lossless', () => {
    const png = planImageImport('image/png', 16384, 8192, CAP) as Extract<ImportPlan, { kind: 'resize' }>
    expect(png.kind).toBe('resize')
    expect(png.mime).toBe('image/png')
    expect(png.quality).toBeUndefined()

    // WebP has no lossless canvas round-trip we rely on, so it lands on PNG too.
    const webp = planImageImport('image/webp', 16384, 8192, CAP) as Extract<ImportPlan, { kind: 'resize' }>
    expect(webp.mime).toBe('image/png')
    expect(webp.quality).toBeUndefined()
  })

  it('keeps a JPEG source JPEG rather than switching codec', () => {
    const plan = planImageImport('image/jpeg', 16384, 8192, CAP) as Extract<ImportPlan, { kind: 'resize' }>
    expect(plan.mime).toBe('image/jpeg')
    expect(plan.quality).toBe(JPEG_RESIZE_QUALITY)
  })

  it('scales on the long edge and holds aspect ratio', () => {
    // Landscape: 16384x8192 halves to 8192x4096.
    expect(planImageImport('image/png', 16384, 8192, CAP)).toMatchObject({ width: CAP, height: 4096 })
    // Portrait: the long edge is the height.
    expect(planImageImport('image/png', 8192, 16384, CAP)).toMatchObject({ width: 4096, height: CAP })
  })

  it('never rounds a dimension down to zero on an extreme aspect ratio', () => {
    // 100000x1 would scale the height to 0.08 -> Math.round gives 0, which
    // would make an unusable zero-area canvas.
    const plan = planImageImport('image/png', 100000, 1, CAP) as Extract<ImportPlan, { kind: 'resize' }>
    expect(plan.width).toBe(CAP)
    expect(plan.height).toBe(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/imageImport.test.ts
```

Expected: FAIL — `Failed to resolve import "./imageImport"`.

- [ ] **Step 3: Write the implementation**

Create `src/imageImport.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- src/imageImport.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/imageImport.ts src/imageImport.test.ts
git commit -m "feat: pure import policy for map images (#246)

Decides reject/verbatim/resize from (type, width, height, maxDim).
Verbatim below the cap so a lossless source stays byte-identical;
format-preserving above it so a downscaled PNG does not become JPEG.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Executor — `importImage()` in `src/imageUtils.ts`

Runs the plan. Type-checks **before** decoding, which is both a cheap early exit and the reason the rejection path is unit-testable without a canvas.

**Files:**
- Modify: `src/imageUtils.ts` (append; leave `compressImage` and its two private helpers untouched)
- Test: `src/imageUtils.test.ts` (create)

**Interfaces:**
- Consumes: `isImportableType`, `planImageImport` from `./imageImport` (Task 1); the existing private `blobToDataUrl(blob: Blob): Promise<string>` at `src/imageUtils.ts:63`.
- Produces: `UnsupportedImageError`, `interface ImportedImage { dataUrl: string; width: number; height: number; downscaledFrom: { width: number; height: number } | null }`, `importImage(file: File, maxDim: number): Promise<ImportedImage>` — used by Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/imageUtils.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { importImage, UnsupportedImageError } from './imageUtils'

// Only the rejection path is testable here: happy-dom has no real canvas and no
// createImageBitmap, so verbatim/resize cannot decode. Those are covered by the
// pure decision table in imageImport.test.ts plus the manual checks in Task 5.
// The point of this test is that rejection happens BEFORE any decode.
describe('importImage — type rejection', () => {
  it('rejects an SVG without attempting to decode it', async () => {
    const file = new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'map.svg', {
      type: 'image/svg+xml',
    })
    await expect(importImage(file, 8192)).rejects.toBeInstanceOf(UnsupportedImageError)
  })

  it('rejects a file with no type at all', async () => {
    const file = new File(['whatever'], 'map', { type: '' })
    await expect(importImage(file, 8192)).rejects.toBeInstanceOf(UnsupportedImageError)
  })

  it('rejects a non-image renamed to look like one', async () => {
    const file = new File(['%PDF-1.4'], 'map.png', { type: 'application/pdf' })
    await expect(importImage(file, 8192)).rejects.toBeInstanceOf(UnsupportedImageError)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/imageUtils.test.ts
```

Expected: FAIL — `importImage` / `UnsupportedImageError` are not exported from `./imageUtils`.

- [ ] **Step 3: Write the implementation**

Add the import at the **top** of `src/imageUtils.ts`, above the existing file comment:

```ts
import { isImportableType, planImageImport } from './imageImport'
```

Then append to the **end** of `src/imageUtils.ts` (after `blobToDataUrl`):

```ts
/** Thrown by `importImage` when the picked file is not a format we store. */
export class UnsupportedImageError extends Error {
  constructor(public readonly type: string) {
    super(`Unsupported image type: ${type || 'unknown'}`)
    this.name = 'UnsupportedImageError'
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
  try {
    const { width, height } = bitmap
    const plan = planImageImport(file.type, width, height, maxDim)
    if (plan.kind !== 'resize') {
      // 'reject' is unreachable — importImage checked the type already.
      return { dataUrl: await blobToDataUrl(file), width, height, downscaledFrom: null }
    }
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
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- src/imageUtils.test.ts src/imageImport.test.ts
```

Expected: PASS — 12 tests across both files.

- [ ] **Step 5: Commit**

```bash
git add src/imageUtils.ts src/imageUtils.test.ts
git commit -m "feat: importImage stores map bytes verbatim below the cap (#246)

Executes planImageImport: no canvas at all when the source fits, so a
lossless import is bit-identical. Type-checks before decoding, which is
what makes the rejection path testable without a canvas.

compressImage is unchanged — the five thumbnail/inline call sites keep
their current behaviour.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Wire `MapRoute` to `importImage`

**Files:**
- Modify: `src/routes/MapRoute.tsx` (line 13 import; lines 274–283 `handleUpload`; lines 329 + 368 `accept`; lines 615–622 delete `imageSize`; new state + notice UI)
- Modify: `src/index.css` (after line 1174, `.map-hint`)

**Interfaces:**
- Consumes: `importImage`, `UnsupportedImageError` from `../imageUtils` (Task 2); existing `mapRepo.addMap(name, image, width, height)`; existing `ConfirmDialog` (props: `open`, `title`, `confirmLabel`, `hideCancel`, `onConfirm`, `onCancel`, `children`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Swap the import**

In `src/routes/MapRoute.tsx`, replace line 13:

```ts
import { compressImage } from '../imageUtils'
```

with:

```ts
import { importImage, UnsupportedImageError } from '../imageUtils'
```

- [ ] **Step 2: Add the cap constant and the two new state values**

Immediately **above** `export default function MapRoute() {` (line 16), add:

```ts
// Leaflet decodes the full raster, so this caps decode memory (8192² is already
// ~268 MB of RGBA), not file size. Anything within it is stored untouched.
const MAP_MAX_DIM = 8192
```

Then after the `const [findQuery, setFindQuery] = useState('')` line (line 32), add:

```ts
  // Upload feedback: a downscale used to be entirely silent, and an unusable
  // file used to fail with nothing shown at all.
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
```

- [ ] **Step 3: Rewrite `handleUpload`**

Replace the whole function at lines 274–283:

```ts
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await compressImage(file, 8192, 0.92)
    const { width, height } = await imageSize(dataUrl)
    const name = file.name.replace(/\.[^.]+$/, '')
    const id = await mapRepo.addMap(name, dataUrl, width, height)
    setActiveId(id)
    e.target.value = ''
  }
```

with:

```ts
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset the input up front, not on the success path: a throw used to leave
    // the old value in place, so re-picking the same file fired no change event.
    e.target.value = ''
    if (!file) return
    setImportNotice(null)
    try {
      const { dataUrl, width, height, downscaledFrom } = await importImage(file, MAP_MAX_DIM)
      const name = file.name.replace(/\.[^.]+$/, '')
      const id = await mapRepo.addMap(name, dataUrl, width, height)
      setActiveId(id)
      if (downscaledFrom) {
        setImportNotice(
          `Resized ${downscaledFrom.width}×${downscaledFrom.height} → ${width}×${height} ` +
          `(${MAP_MAX_DIM}px limit). Images within that limit are stored at full quality.`,
        )
      }
    } catch (err) {
      setImportError(
        err instanceof UnsupportedImageError
          ? 'That file type is not supported. Use a PNG, JPEG, or WebP image.'
          : 'That image could not be read. It may be corrupt, or a variant this app cannot decode.',
      )
    }
  }
```

- [ ] **Step 4: Delete the now-unused `imageSize` helper**

Delete lines 615–622 of `src/routes/MapRoute.tsx` entirely — `importImage` returns the dimensions, so the second decode is gone:

```ts
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}
```

- [ ] **Step 5: Build the shared error dialog and tighten both file inputs**

Immediately **above** the `// ---- No maps yet` comment (line 320), add:

```ts
  // Rendered in both the empty-state and main branches: an unsupported file can
  // be picked before any map exists, and the early return would otherwise
  // swallow the dialog.
  const importErrorDialog = (
    <ConfirmDialog
      open={importError !== null}
      title="Could not import that image"
      confirmLabel="OK"
      hideCancel
      onConfirm={() => setImportError(null)}
      onCancel={() => setImportError(null)}
    >
      <p>{importError}</p>
    </ConfirmDialog>
  )
```

In the empty-state branch, replace line 329:

```tsx
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleUpload} />
```

with (note the added dialog):

```tsx
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={handleUpload}
        />
        {importErrorDialog}
```

In the toolbar, replace line 368 with the same input (no dialog here — it goes in the main tree in Step 6):

```tsx
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={handleUpload}
        />
```

- [ ] **Step 6: Render the notice bar and the dialog in the main tree**

In the main `return`, immediately **after** the closing `</div>` of `.map-toolbar`, add:

```tsx
      {importNotice && (
        <div className="map-import-notice">
          <span>{importNotice}</span>
          <button className="ghost-btn" onClick={() => setImportNotice(null)}>Dismiss</button>
        </div>
      )}
```

And immediately **before** the final `</div>` that closes `.map-page` (after the existing delete-map `</ConfirmDialog>` at line 610), add:

```tsx
      {importErrorDialog}
```

- [ ] **Step 7: Add the notice-bar CSS**

In `src/index.css`, after line 1174 (`.map-hint { … }`), add:

```css
.map-import-notice {
  display: flex; align-items: center; gap: 10px; padding: 8px 16px;
  border-bottom: 1px solid var(--border); background: var(--bg-2);
  color: var(--ink-faint); font-size: 13px; flex-shrink: 0;
}
.map-import-notice span { flex: 1; }
```

- [ ] **Step 8: Verify lint, types, and the full suite**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass. In particular the build must report **no** "declared but never read" error — if it names `imageSize` or `compressImage`, Step 4 or Step 1 was missed.

- [ ] **Step 9: Commit**

```bash
git add src/routes/MapRoute.tsx src/index.css
git commit -m "feat: map upload keeps full quality, reports what it did (#246)

Uses importImage instead of compressImage, so a map within 8192px is
stored as its original bytes. The second decode (imageSize) is gone —
importImage returns the dimensions.

Also: accept= no longer admits SVG, a downscale is now announced instead
of silent, an unreadable file shows a dialog instead of failing silently,
and the file input resets before the work so a retry of the same file
fires a change event.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Close the `maps` sanitizer gap and guard the blank overlay

`sanitizeBackup` validates `images` and `infobox.image` through `isCleanImageDataUrl` but lets `maps` through unchecked. Upload-time laundering into JPEG was that path's only de-facto cover, and Task 2 removed it — so this must land in the same change.

**Files:**
- Modify: `src/db/backup.ts` (inside `sanitizeBackup`, line 374 onward)
- Modify: `src/components/MapView.tsx` (line 105, and the `return` at line 377)
- Modify: `src/index.css` (after the `.map-import-notice` rules from Task 3)
- Test: `src/db/import-sanitize.test.ts` (append)

**Interfaces:**
- Consumes: existing `isCleanImageDataUrl(v: unknown): v is string` (`src/db/backup.ts:365`), existing `asArray`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the failing test**

Append to `src/db/import-sanitize.test.ts`:

```ts
describe('sanitizeBackup — map images', () => {
  const mapRow = (image: string) => ({
    id: 'm1', name: 'Known World', image, width: 100, height: 80, createdAt: 1,
  })

  it('blanks an SVG map image but keeps the map and its pins', async () => {
    // Blank, don't drop: pins/regions are keyed by mapId, so dropping the map
    // row would strand them as unreachable data.
    await importAll(JSON.stringify({
      maps: [mapRow('data:image/svg+xml,<svg onload="alert(1)"/>')],
      pins: [{ id: 'pin1', mapId: 'm1', lat: 1, lng: 2, label: 'Keep me', pageId: null }],
    }))
    const m = await db.maps.get('m1')
    expect(m).toBeTruthy()
    expect(m?.image).toBe('')
    expect(m?.name).toBe('Known World')
    expect(await db.pins.get('pin1')).toBeTruthy()
  })

  it('blanks a non-data-URL and anything that could break out of src="…"', async () => {
    await importAll(JSON.stringify({ maps: [mapRow('https://evil.example/x.png')] }))
    expect((await db.maps.get('m1'))?.image).toBe('')

    await importAll(JSON.stringify({ maps: [mapRow('data:image/png;base64,AA" onerror="alert(1)')] }))
    expect((await db.maps.get('m1'))?.image).toBe('')
  })

  it('leaves a clean raster data-URL untouched', async () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    await importAll(JSON.stringify({ maps: [mapRow(png)] }))
    expect((await db.maps.get('m1'))?.image).toBe(png)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:run -- src/db/import-sanitize.test.ts
```

Expected: FAIL — the first two cases get the original hostile string back instead of `''`.

- [ ] **Step 3: Sanitize `maps` in `sanitizeBackup`**

In `src/db/backup.ts`, inside the object returned by `sanitizeBackup`, add this entry directly **after** the `events:` line (line 396) and before `scenes:`:

```ts
    // Map images feed L.imageOverlay and the HTML export's raw markup. Upload
    // used to launder every map through a JPEG re-encode; #246 removed that, so
    // this is now the only check on the path. Blank rather than drop (the
    // treatment `images` gets below): pins and regions are keyed by mapId, so
    // dropping the map row would strand them as unreachable data. A blanked map
    // keeps its pins and is repaired by re-uploading the image.
    maps: asArray(data.maps).map((m) => ({
      ...m,
      image: isCleanImageDataUrl(m.image) ? m.image : '',
    })),
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm run test:run -- src/db/import-sanitize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Guard the Leaflet overlay**

In `src/components/MapView.tsx`, replace line 105:

```ts
    L.imageOverlay(map.image, bounds).addTo(lmap)
```

with:

```ts
    // A map whose image failed import sanitization is stored with image: ''
    // (see sanitizeBackup). L.imageOverlay('') renders a blank tile with pins
    // floating over nothing, so skip it and let the render show why. The effect
    // is keyed on map.image, so a re-upload restores the overlay without a remount.
    if (map.image) L.imageOverlay(map.image, bounds).addTo(lmap)
```

- [ ] **Step 6: Explain the blank map in the render**

In `src/components/MapView.tsx`, replace the `return` block at lines 377–384:

```tsx
  return (
    <>
      <div ref={containerRef} className="map-canvas" />
      {previewCard && (
        <div ref={overlayRef} className="map-preview-anchor">{previewCard}</div>
      )}
    </>
  )
```

with:

```tsx
  return (
    <>
      <div ref={containerRef} className="map-canvas" />
      {!map.image && (
        <div className="map-image-missing" role="status">
          This map’s image could not be restored from the backup. Its pins and regions
          are intact — upload a replacement image to see them in place.
        </div>
      )}
      {previewCard && (
        <div ref={overlayRef} className="map-preview-anchor">{previewCard}</div>
      )}
    </>
  )
```

- [ ] **Step 7: Add the missing-image CSS**

In `src/index.css`, after the `.map-import-notice span` rule added in Task 3, add:

```css
.map-image-missing {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  z-index: 500; max-width: 420px; padding: 14px 18px; text-align: center;
  background: var(--panel); border: 1px solid var(--border); border-radius: 9px;
  color: var(--ink-faint); font-size: 13px; line-height: 1.5;
}
```

- [ ] **Step 8: Verify lint, types, and the full suite**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass.

- [ ] **Step 9: Commit**

```bash
git add src/db/backup.ts src/components/MapView.tsx src/index.css src/db/import-sanitize.test.ts
git commit -m "fix: sanitize map images on backup import (#246)

sanitizeBackup validated images and infobox.image but not maps; the
upload-time JPEG re-encode was that path's only cover, and #246 removed
it. Blank rather than drop — pins and regions are keyed by mapId, so
dropping the row would strand them.

MapView skips L.imageOverlay on a blank image and says why, instead of
showing pins floating over nothing.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Manual verification in the Tauri shell, and docs

None of the pixel behaviour is reachable under happy-dom, so this task is where the feature is actually proved. **Do not skip it and do not claim the feature works from the unit tests alone.**

**Files:**
- Modify: `docs/remaining-roadmap.md:55-57`
- Modify: `CLAUDE.md` (the "Other" section, near the `HTML export` / `Shared HTML` bullets)

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces: nothing.

- [ ] **Step 1: Run the app**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify the verbatim path — the actual point of the change**

Import a **PNG under 8192px** on the `/map` route, then confirm the stored bytes
are still PNG. The app does not expose `db` globally, so read it from IndexedDB
directly in the DevTools console:

```js
// Logs the data-URL prefix of every stored map. Expect "data:image/png;base64,"
// for the one just imported — NOT "data:image/jpeg;base64,".
await new Promise((resolve) => {
  const req = indexedDB.open('lore-app')
  req.onsuccess = () => {
    const tx = req.result.transaction('maps', 'readonly')
    tx.objectStore('maps').getAll().onsuccess = (e) => {
      console.table(e.target.result.map((m) => ({ name: m.name, prefix: m.image.slice(0, 24) })))
      resolve()
    }
  }
})
```

(If the active world is not the default, the DB name is `lore-app-<loreId>` — see
`dbNameFor` in `src/loreId.ts`.)

Then confirm it visually as well: open a map with **fine text labels or
hard-edged borders**, zoom in fully, and check there is no JPEG ringing or
mosquito noise around the edges. If a map imported before this change is still
in the world, compare the two directly — that contrast is the whole point of the
issue. Record the result.

- [ ] **Step 3: Verify the resize path**

Import a PNG **larger than 8192px** on its long edge. Expected: the notice bar appears naming both sizes (e.g. `Resized 12000×9000 → 8192×6144`), and it dismisses on click.

- [ ] **Step 4: Verify EXIF orientation — the one behaviour this change alters mechanically**

Import a **JPEG photo shot in portrait on a phone** (one carrying an EXIF orientation flag other than 1). Expected: it renders upright, and pins dropped on it land where clicked. A sideways map or pins offset from the cursor means the measured dimensions and the rendered orientation disagree — stop and report it rather than working around it.

- [ ] **Step 5: Verify rejection**

- Open the file picker: SVG should no longer be offered.
- Rename an SVG to `map.png` and pick it: expected is the "Could not import that image" dialog, not a stored map and not a silent failure.
- Do this from the **empty state** (a world with no maps) as well as the toolbar, since those are two separate render branches.

- [ ] **Step 6: Verify the blank-map recovery path**

Export a backup, hand-edit one map's `image` to `data:image/svg+xml,<svg/>`, and import it. Expected: the map still exists in the selector, its pins are intact, and the "could not be restored" notice shows over the canvas. Re-upload an image and confirm the overlay returns without a page reload.

- [ ] **Step 7: Update the roadmap entry**

In `docs/remaining-roadmap.md`, replace lines 55–57:

```markdown
- 🔴 `blocked` **Map resolution** — quality is capped by browser-storage compression;
  unblocks at desktop-transition **Phase 3a** (assets stored as real files instead of
  data-URLs in IndexedDB — see `desktop-transition-investigation.md` §9). _roadmap #13._
```

with:

```markdown
- 🔴 `blocked` **Map resolution** — still capped, but by *storage*, not quality: #246
  removed the unconditional JPEG re-encode, so a map within 8192px is now stored as
  its original bytes. What remains is that images are data-URLs in IndexedDB, which
  `exportAll()` re-serializes into the world mirror on every write. Unblocks at
  desktop-transition **Phase 3a** (assets as real files, `.lore` as a zip container —
  see `desktop-transition-investigation.md` §9). _roadmap #13._
```

- [ ] **Step 8: Document the split in `CLAUDE.md`**

In the **Other** section of `CLAUDE.md`, after the `**Shared HTML (`src/html.ts`)**` bullet, add:

```markdown
- **Image import (`src/imageImport.ts` + `imageUtils.ts`):** two different policies, deliberately. `compressImage(file, maxDim, quality)` always re-encodes to JPEG — right for thumbnails and inline art (infobox 800, gallery/editor/home 1600, world banner 1200), where the image is displayed small. **Maps use `importImage(file, maxDim)` instead**, which stores the original bytes verbatim below the cap and preserves the source format above it, because a map is zoomed into and is full of hard edges that JPEG wrecks (#246). The decision is pure (`planImageImport`) precisely so it can be tested — happy-dom has no canvas, so the executor is manual-verification-only. `importImage` type-checks **before** decoding; that check is the only thing keeping SVG out of the DB now that the JPEG re-encode no longer launders every upload, and `sanitizeBackup` blanks (never drops) an unsafe map image so its pins survive.
```

- [ ] **Step 9: Final verification and commit**

```bash
npm run lint && npm run build && npm run test:run
```

Expected: all three pass.

```bash
git add docs/remaining-roadmap.md CLAUDE.md
git commit -m "docs: record the map-import policy split (#246)

Roadmap #13 stays blocked but is re-scoped from quality to storage.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 10: Open the PR**

```bash
git push -u origin feat/246-full-quality-map-import
gh pr create --title "Store map images at full quality (#246)" --label version:minor --body "$(cat <<'EOF'
Closes #246.

Map upload ran every image through `compressImage(file, 8192, 0.92)`, which is
hardcoded to JPEG — so even a small lossless PNG was thrown through a lossy
codec. Maps are hard edges (borders, coastlines, text labels), exactly what
JPEG degrades worst.

**The fix is the format preservation, not removing the cap.** The 8192px cap
guards Leaflet's full-raster decode (8192² ≈ 268 MB of RGBA) and stays.

- Within the cap: original bytes, no canvas involved, bit-identical.
- Above it: format-preserving downscale — PNG stays PNG, JPEG stays JPEG.
- The decision lives in a pure `planImageImport()` so it is testable at all;
  happy-dom has no canvas, so the executor is manual-verification-only.

Two things rode along because the JPEG re-encode was silently covering them:
`accept="image/*"` admitted SVG, and `sanitizeBackup` validated `images` and
`infobox.image` but not `maps`. The sanitizer blanks rather than drops, so a
map with an unsafe image keeps its pins.

Also now visible to the user: a downscale is announced instead of silent, and
an unreadable file shows a dialog instead of failing with nothing on screen.

**Does not unblock #13.** Images are still data-URLs that `exportAll()`
re-serializes into the world mirror on every write; the roadmap entry is
re-scoped from quality to storage. That ceiling is Phase 3a.

Manual verification performed in the Tauri shell: verbatim PNG import,
over-cap downscale notice, EXIF-rotated JPEG orientation, SVG rejection from
both render branches, and blank-map recovery.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1 The rule (verbatim / format-preserving table) | Task 1 Step 3 |
| §2 Pure core `planImageImport` + `isImportableType` | Task 1 |
| §2 "carries the test weight" | Task 1 Step 1 (9 tests) |
| §2 `src/` not `src/db/`, no barrel export | Global Constraints |
| §3 `importImage` / `ImportedImage` / `UnsupportedImageError` | Task 2 Step 3 |
| §3 decode-once, two-path structure | Task 2 Step 3 |
| §3 orientation via `from-image` | Task 2 Step 3 (code + comment), Task 5 Step 4 (proof) |
| §4 single call, `imageSize` deleted | Task 3 Steps 3–4 |
| §4 `accept` tightened | Task 3 Step 5 |
| §4 downscale notice | Task 3 Steps 3, 6, 7 |
| §4 `UnsupportedImageError` → `ConfirmDialog` `hideCancel` | Task 3 Steps 5–6 |
| §5 sanitize `maps`, blank-don't-drop | Task 4 Steps 1–4 |
| §5 `MapView` guard + effect key | Task 4 Steps 5–7 |
| §6 `imageImport.test.ts` decision table | Task 1 Step 1 |
| §6 `import-sanitize.test.ts` map case | Task 4 Step 1 |
| §6 manual shell checks (4 listed) | Task 5 Steps 2–6 |
| §7 roadmap marker stays, re-scoped | Task 5 Step 7 |

No gaps.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code. No "similar to Task N" — the `<input>` JSX is written out at both call sites rather than cross-referenced. No "add appropriate error handling": the two error branches and their exact copy are spelled out in Task 3 Step 3.

**Type consistency:** `planImageImport(type, width, height, maxDim)` and `isImportableType(type)` are defined in Task 1 Step 3 and called with those exact arities in Task 2 Step 3. `ImportPlan`'s `resize` variant carries `width`/`height`/`mime`/`quality?`, and Task 2 reads exactly those four. `ImportedImage`'s four fields (`dataUrl`, `width`, `height`, `downscaledFrom`) are destructured identically in Task 3 Step 3. `JPEG_RESIZE_QUALITY` is defined in Task 1 and asserted in Task 1's test only — Task 2 never hardcodes 0.92. `isCleanImageDataUrl` and `asArray` in Task 4 Step 3 match their existing signatures at `db/backup.ts:365` and are already in scope in that file. `ConfirmDialog` is passed `open`/`title`/`confirmLabel`/`hideCancel`/`onConfirm`/`onCancel`/`children`, matching `ConfirmDialogProps` at `ConfirmDialog.tsx:3-16`. `MAP_MAX_DIM` is defined once in Task 3 Step 2 and used in Steps 3 and 3's notice copy.

**One deliberate divergence from the spec:** the spec described a single `planImageImport` handling rejection. The plan adds `isImportableType` alongside it so `importImage` can reject *before* decoding — which is what makes the rejection path unit-testable without a canvas. `planImageImport` still returns `reject` for a bad type, keeping the decision table total; the branch is simply unreachable from `importImage`, and Task 2's code comments say so.
