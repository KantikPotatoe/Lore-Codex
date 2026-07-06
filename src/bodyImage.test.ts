import { describe, it, expect } from 'vitest'
import { BODY_IMAGE_ATTR, bodyImageIds, resolveBodyImages, planBodyImageMigration } from './bodyImage'

describe('bodyImageIds', () => {
  it('collects the ids referenced by body-image nodes, in order, deduped', () => {
    const html = `<p><img ${BODY_IMAGE_ATTR}="a"></p><p><img ${BODY_IMAGE_ATTR}="b"><img ${BODY_IMAGE_ATTR}="a"></p>`
    expect(bodyImageIds(html)).toEqual(['a', 'b'])
  })

  it('ignores ordinary inline data-URL images (legacy bodies)', () => {
    expect(bodyImageIds('<p><img src="data:image/png;base64,AAA"></p>')).toEqual([])
  })
})

describe('resolveBodyImages', () => {
  it('inlines the data URL for each ref, resolving id -> bytes', () => {
    const html = `<p><img ${BODY_IMAGE_ATTR}="a"></p>`
    const out = resolveBodyImages(html, (id) => (id === 'a' ? 'data:image/png;base64,AAA' : null))
    expect(out).toContain('src="data:image/png;base64,AAA"')
    expect(out).not.toContain(BODY_IMAGE_ATTR)
  })

  it('drops a ref whose image is missing rather than leaving a broken node', () => {
    const html = `<p>before<img ${BODY_IMAGE_ATTR}="gone">after</p>`
    const out = resolveBodyImages(html, () => null)
    expect(out).not.toContain('gone')
    expect(out).not.toContain('<img')
    expect(out).toContain('before')
    expect(out).toContain('after')
  })

  it('leaves ordinary inline images untouched', () => {
    const html = '<p><img src="data:image/png;base64,ZZZ" alt=""></p>'
    expect(resolveBodyImages(html, () => null)).toContain('src="data:image/png;base64,ZZZ"')
  })
})

describe('planBodyImageMigration', () => {
  const seqIds = () => {
    let n = 0
    return () => `id-${n++}`
  }

  it('extracts each inline data-URL image into a ref, preserving document order', () => {
    const html = `<p><img src="data:image/png;base64,AAA"></p><p>t<img src="data:image/jpeg;base64,BBB"></p>`
    const plan = planBodyImageMigration(html, seqIds())
    expect(plan).not.toBeNull()
    expect(plan!.added).toEqual([
      { id: 'id-0', dataUrl: 'data:image/png;base64,AAA' },
      { id: 'id-1', dataUrl: 'data:image/jpeg;base64,BBB' },
    ])
    expect(plan!.html).toContain(`${BODY_IMAGE_ATTR}="id-0"`)
    expect(plan!.html).toContain(`${BODY_IMAGE_ATTR}="id-1"`)
    expect(plan!.html).not.toContain('data:image') // bytes no longer inline in the body
  })

  it('returns null when there is nothing to migrate (no images, or only refs)', () => {
    expect(planBodyImageMigration('<p>plain</p>', seqIds())).toBeNull()
    expect(planBodyImageMigration(`<p><img ${BODY_IMAGE_ATTR}="x"></p>`, seqIds())).toBeNull()
  })

  it('migrates an inline image while leaving an existing ref node untouched', () => {
    const html = `<p><img ${BODY_IMAGE_ATTR}="keep"><img src="data:image/png;base64,NEW"></p>`
    const plan = planBodyImageMigration(html, seqIds())
    expect(plan!.added).toEqual([{ id: 'id-0', dataUrl: 'data:image/png;base64,NEW' }])
    expect(plan!.html).toContain(`${BODY_IMAGE_ATTR}="keep"`)
    expect(plan!.html).toContain(`${BODY_IMAGE_ATTR}="id-0"`)
  })

  it('ignores non-data-URL images (external src), migrating nothing', () => {
    expect(planBodyImageMigration('<p><img src="https://example.com/x.png"></p>', seqIds())).toBeNull()
  })
})
