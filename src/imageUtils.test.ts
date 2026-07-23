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
