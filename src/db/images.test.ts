import { describe, it, expect, beforeEach } from 'vitest'
import { db, addImage, addBodyImage, galleryImages, updateImageCaption, deleteImage, reorderImages, setAsPortrait, createPage, deletePage } from '../db'

// Gallery images live in their own table (not on LorePage) so editing page text
// never rewrites image bytes. This first test just proves the v8 table + its
// pageId/order indexes exist and round-trip a row.

beforeEach(async () => {
  await db.images.clear()
})

describe('images table (schema v8)', () => {
  it('stores and reads back an image row by pageId, sorted by order', async () => {
    await db.images.add({ id: 'i2', pageId: 'p1', dataUrl: 'data:image/png;base64,AAA', caption: 'b', order: 1, createdAt: 2 })
    await db.images.add({ id: 'i1', pageId: 'p1', dataUrl: 'data:image/png;base64,BBB', caption: 'a', order: 0, createdAt: 1 })
    await db.images.add({ id: 'i3', pageId: 'p2', dataUrl: 'data:image/png;base64,CCC', caption: 'c', order: 0, createdAt: 3 })

    const forP1 = await db.images.where('pageId').equals('p1').sortBy('order')
    expect(forP1.map((i) => i.id)).toEqual(['i1', 'i2'])
  })
})

describe('images CRUD', () => {
  beforeEach(async () => {
    await db.images.clear()
  })

  it('addImage appends at the next order, starting at 0', async () => {
    await addImage('p1', 'data:image/png;base64,A')
    await addImage('p1', 'data:image/png;base64,B')
    const rows = await db.images.where('pageId').equals('p1').sortBy('order')
    expect(rows.map((r) => r.order)).toEqual([0, 1])
    expect(rows.map((r) => r.caption)).toEqual(['', ''])
  })

  it('addImage uses max+1 so it never collides after a delete', async () => {
    const a = await addImage('p1', 'data:image/png;base64,A') // order 0
    const b = await addImage('p1', 'data:image/png;base64,B') // order 1
    await deleteImage(a)
    const c = await addImage('p1', 'data:image/png;base64,C') // must be order 2, not 1
    const orders = (await db.images.where('pageId').equals('p1').toArray())
      .sort((x, y) => x.order - y.order)
      .map((r) => `${r.id}:${r.order}`)
    expect(orders).toEqual([`${b}:1`, `${c}:2`])
  })

  it('updateImageCaption sets the caption', async () => {
    const id = await addImage('p1', 'data:image/png;base64,A')
    await updateImageCaption(id, 'a hero')
    expect((await db.images.get(id))?.caption).toBe('a hero')
  })

  it('reorderImages reassigns order to 0..n-1 in the given sequence', async () => {
    const a = await addImage('p1', 'data:image/png;base64,A')
    const b = await addImage('p1', 'data:image/png;base64,B')
    const c = await addImage('p1', 'data:image/png;base64,C')
    await reorderImages('p1', [c, a, b])
    const rows = await db.images.where('pageId').equals('p1').sortBy('order')
    expect(rows.map((r) => r.id)).toEqual([c, a, b])
    expect(rows.map((r) => r.order)).toEqual([0, 1, 2])
  })

  it('reorderImages ignores ids that do not belong to the page', async () => {
    const a = await addImage('p1', 'data:image/png;base64,A')
    const b = await addImage('p1', 'data:image/png;base64,B')
    const foreign = await addImage('p2', 'data:image/png;base64,X')
    // Pass a foreign id mixed in; it must not be reordered or throw.
    await reorderImages('p1', [b, foreign, a])
    const p1 = await db.images.where('pageId').equals('p1').sortBy('order')
    expect(p1.map((r) => r.id)).toEqual([b, a])
    expect(p1.map((r) => r.order)).toEqual([0, 1])
    // The foreign image keeps its own order, untouched.
    expect((await db.images.get(foreign))?.order).toBe(0)
  })
})

describe('body images (#182)', () => {
  beforeEach(async () => {
    await db.images.clear()
  })

  it('addBodyImage stores a kind:"body" row that the gallery does not list', async () => {
    await addImage('p1', 'data:image/png;base64,GALLERY')
    const bodyId = await addBodyImage('p1', 'data:image/png;base64,BODY')

    // Stored with kind 'body'.
    expect((await db.images.get(bodyId))?.kind).toBe('body')
    // The gallery lists only the gallery image, not the body image.
    const gallery = await galleryImages('p1')
    expect(gallery.map((i) => i.dataUrl)).toEqual(['data:image/png;base64,GALLERY'])
  })

  it('galleryImages returns gallery rows (kind gallery or legacy-undefined) sorted by order', async () => {
    await db.images.add({ id: 'g2', pageId: 'p1', dataUrl: 'data:image/png;base64,B', caption: '', order: 1, createdAt: 2 })
    await db.images.add({ id: 'g1', pageId: 'p1', dataUrl: 'data:image/png;base64,A', caption: '', order: 0, createdAt: 1, kind: 'gallery' })
    await addBodyImage('p1', 'data:image/png;base64,BODY')
    const gallery = await galleryImages('p1')
    expect(gallery.map((i) => i.id)).toEqual(['g1', 'g2'])
  })
})

describe('setAsPortrait', () => {
  beforeEach(async () => {
    await db.images.clear()
    await db.pages.clear()
  })

  it('writes the data URL into an existing infobox image', async () => {
    const pageId = await createPage({ title: 'Hero', category: 'Character' })
    const page = (await db.pages.get(pageId))!
    expect(page.infobox).toBeDefined() // createPage seeds a default infobox
    await setAsPortrait(page, 'data:image/png;base64,PORTRAIT')
    expect((await db.pages.get(pageId))?.infobox?.image).toBe('data:image/png;base64,PORTRAIT')
  })

  it('creates a default infobox first when the page has none', async () => {
    const pageId = await createPage({ title: 'Bare', category: 'Character' })
    await db.pages.update(pageId, { infobox: undefined })
    const page = (await db.pages.get(pageId))!
    expect(page.infobox).toBeUndefined()
    await setAsPortrait(page, 'data:image/png;base64,NEW')
    const after = await db.pages.get(pageId)
    expect(after?.infobox).toBeDefined()
    expect(after?.infobox?.image).toBe('data:image/png;base64,NEW')
  })
})

describe('deletePage cascade', () => {
  beforeEach(async () => {
    await db.images.clear()
    await db.pages.clear()
  })

  it('removes a page\'s gallery images when the page is deleted', async () => {
    const pageId = await createPage({ title: 'Doomed' })
    await addImage(pageId, 'data:image/png;base64,A')
    await addImage(pageId, 'data:image/png;base64,B')
    expect(await db.images.where('pageId').equals(pageId).count()).toBe(2)
    await deletePage(pageId)
    expect(await db.images.where('pageId').equals(pageId).count()).toBe(0)
  })
})
