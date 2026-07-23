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
