# Full-quality map import — design

**Issue:** #246 · **Date:** 2026-07-23 · **Status:** approved, not yet implemented

`MapRoute.handleUpload` runs every uploaded map through
`compressImage(file, 8192, 0.92)`. That call does two lossy things, and only one
of them was ever intended:

1. **Re-encodes to JPEG, unconditionally.** `compressImage` is hardcoded to
   `'image/jpeg'` (`imageUtils.ts:33,55`), so a 900×600 lossless PNG is still
   thrown through a lossy codec. Maps are hard edges — borders, coastlines, text
   labels — which is precisely the content JPEG degrades worst. **This is the
   quality loss.**
2. **Downscales above 8192px.** Only bites on unusually large sources, and it
   protects against a real failure: Leaflet decodes the full raster, so 8192² is
   already ~268 MB of RGBA in the webview.

The cap is doing useful work. The re-encode is not. This spec removes the second
without weakening the first.

**Scope:** `MapRoute` only. The other five `compressImage` call sites
(`ImageGallery` 1600, `LoreEditor` 1600, `Infobox` 800, `HomeRoute` 1600,
`LoreSelectorRoute` 1200) are unchanged, and `compressImage` itself is untouched.
Galleries were considered and deliberately excluded: there is a handful of maps
per world but potentially hundreds of gallery images, so full-res there would
multiply the world-mirror payload by page count.

---

## 1. The rule

**Verbatim below the cap; format-preserving downscale above it.**

| Source | Within 8192px | Over 8192px |
|---|---|---|
| PNG | original bytes, untouched | downscale → PNG (lossless resample) |
| WebP | original bytes, untouched | downscale → PNG |
| JPEG | original bytes, untouched | downscale → JPEG q0.92 |
| anything else (incl. SVG) | rejected | rejected |

Two properties matter here. **Verbatim means no canvas at all** — the bytes go
straight from the `File` to a data URL, so an under-cap import is bit-identical
to the source file. And **format is preserved on the resize path**: a downscaled
PNG does not silently become a JPEG, and a JPEG is not re-encoded into a
different codec and back. A JPEG over the cap does take one generation of loss,
which is unavoidable if it is being resampled at all.

---

## 2. Pure core — `src/imageImport.ts` (new)

The decision is separated from the pixel work, following the pure-core idiom
already used by `autolink.ts`, `calendar.ts`, `worldMirror.ts`, and
`graphColor.ts`:

```ts
export const IMPORTABLE_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export type ImportPlan =
  | { kind: 'reject'; reason: 'type' }
  | { kind: 'verbatim' }
  | { kind: 'resize'; width: number; height: number; mime: string; quality?: number }

export function planImageImport(
  type: string,
  width: number,
  height: number,
  maxDim: number,
): ImportPlan
```

Rules, in order:

1. `type` not in `IMPORTABLE_IMAGE_TYPES` → `{ kind: 'reject', reason: 'type' }`.
2. `max(width, height) <= maxDim` → `{ kind: 'verbatim' }`.
3. Otherwise → `{ kind: 'resize', … }` with `scale = maxDim / max(width, height)`,
   dimensions rounded, `mime` = `'image/jpeg'` + `quality: 0.92` for a JPEG
   source, `'image/png'` (no quality) otherwise.

**This module carries the test weight.** happy-dom provides neither a real canvas
nor `createImageBitmap`, so the executor in §3 cannot be meaningfully unit-tested;
the decision table can be, exhaustively and with no DOM at all.

`src/imageImport.ts` lives at `src/`, not `src/db/`, because it has no runtime
`db` import — consistent with the pure-module placement rule.

---

## 3. Executor — `src/imageUtils.ts`

One new export alongside the existing `compressImage`, which is **not modified**:

```ts
export class UnsupportedImageError extends Error {}

export interface ImportedImage {
  dataUrl: string
  width: number
  height: number
  /** Set only when the source exceeded the cap; the original dimensions. */
  downscaledFrom: { width: number; height: number } | null
}

export async function importImage(file: File, maxDim: number): Promise<ImportedImage>
```

Flow:

1. Decode once to get true rendered dimensions — `createImageBitmap(file, {
   imageOrientation: 'from-image' })`, falling back to the `<img>` + `FileReader`
   path where unavailable, mirroring `compressImage`'s existing two-path
   structure.
2. `planImageImport(file.type, width, height, maxDim)`.
3. `reject` → throw `UnsupportedImageError`.
4. `verbatim` → `blobToDataUrl(file)` (the existing private helper). No canvas is
   constructed. `downscaledFrom: null`, dimensions from step 1.
5. `resize` → draw to canvas at the planned size, encode to the planned mime,
   `downscaledFrom` = the step-1 dimensions.

**Orientation.** Measuring with `imageOrientation: 'from-image'` and rendering
through an `<img>` — whose CSS `image-orientation` defaults to `from-image` in
modern Chromium — puts the same numbers on both sides, so an EXIF-rotated JPEG
stored verbatim still lays out correctly. This is the one behaviour that the
verbatim path changes mechanically rather than preserves, and it must be
confirmed in the shell with a real rotated photo rather than assumed.

Returning dimensions is what lets `MapRoute` stop decoding the image a second
time (§4).

---

## 4. `MapRoute`

`handleUpload` collapses from compress-then-measure to a single call:

```ts
const { dataUrl, width, height, downscaledFrom } = await importImage(file, 8192)
```

Consequences:

- The module-local `imageSize()` helper (`MapRoute.tsx:615`) is **deleted** — it
  existed only to re-decode the data URL that `compressImage` returned.
- Both `accept="image/*"` attributes (lines 329, 368) tighten to
  `"image/png,image/jpeg,image/webp"`. The wildcard admits SVG today; the
  re-encode was the only thing stopping it from reaching the DB.
- `downscaledFrom` set → an inline notice naming both sizes, e.g.
  *"Resized 12000×9000 → 8192×6144 (8192px limit)."* Today this downscale is
  entirely silent.
- `UnsupportedImageError` → a `ConfirmDialog` with `hideCancel`. **No host
  `alert()`** — wry renders those unreliably.

---

## 5. Adjacent fix — `sanitizeBackup` does not validate `maps`

`sanitizeBackup` (`db/backup.ts:374`) runs `images` and `infobox.image` through
`isCleanImageDataUrl`, but `maps` passes through unchecked. Upload-time
laundering into JPEG was that path's only de-facto cover, and §1 removes it, so
the gap must close in the same change.

**Blank, do not drop.** The `.filter()` treatment `images` receives is wrong
here: dropping a map row would orphan its pins and regions, which are keyed by
`mapId` and would survive as unreachable data. Since `WorldMap.image` is a
required `string`, a map failing validation keeps its row with `image: ''` — the
pins survive and the user can repair it by re-uploading.

`MapView` needs a matching guard: `L.imageOverlay(map.image, bounds)`
(`MapView.tsx:105`) given `''` produces a blank overlay with pins floating over
nothing and no explanation. Skip the overlay when `map.image` is empty and render
an "image missing — re-upload to restore" notice over the still-functional pin
layer. The effect is already keyed on `map.image` (line 128), so re-uploading
recovers without a remount.

---

## 6. Testing

**`src/imageImport.test.ts`** — pure, no DOM, exhaustive over the decision table:

- each of png/jpeg/webp under the cap → `verbatim`
- `image/svg+xml`, `image/gif`, `''`, and an arbitrary non-image type → `reject`
- over-cap PNG and WebP → `resize` with `mime: 'image/png'`, no `quality`
- over-cap JPEG → `resize` with `mime: 'image/jpeg'`, `quality: 0.92`
- landscape, portrait, and exactly-at-cap sources scale on the long edge, never
  upscale, and hold aspect ratio within a rounding pixel

**`src/db/backup.test.ts`** — a backup whose map `image` is
`data:image/svg+xml,…` imports with the map row present, `image === ''`, and its
pins intact.

**Manual, in the Tauri shell** (none of this is reachable under happy-dom):

- import an under-cap PNG → stored data URL is `data:image/png`, and the map
  renders with no JPEG ringing on label text
- import an over-cap PNG → notice appears with both sizes; result is still PNG
- import an EXIF-rotated JPEG photo → orientation and stored `width`/`height`
  agree with what Leaflet draws
- attempt an SVG → the file picker no longer offers it; a renamed SVG is rejected
  with the dialog, not silently stored

---

## 7. What this does not do

It does not change the world mirror. A world holding several lossless 8192px
PNGs will have a materially larger `.lore` file, re-serialized by `exportAll()`
and rewritten on the same cadence (30s floor, 10-minute staleness ceiling), and
carried at that size in every backup. That is the accepted cost of the trade.

The roadmap's 🔴 `blocked` marker on **Map resolution**
(`docs/remaining-roadmap.md:55`) therefore **stays**, re-scoped from quality to
storage: images remain data-URLs in IndexedDB, and only desktop **Phase 3a**
(assets as real files, `.lore` as a zip container) removes that ceiling. This
spec buys back the fidelity that was being discarded for no benefit; it does not
raise the ceiling.
