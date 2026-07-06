import { describe, it, expect } from 'vitest'
import { BODY_IMAGE_ATTR, bodyImageIds, resolveBodyImages } from './bodyImage'

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
