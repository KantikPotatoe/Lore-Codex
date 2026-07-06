import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '../db'
import { migrateInlineBodyImages, BODY_IMAGES_MIGRATED_KEY } from './bodyImageMigration'
import { BODY_IMAGE_ATTR } from '../bodyImage'

const page = (id: string, content: string) => ({
  id, title: id, titleLc: id, category: 'Character', content,
  summary: '', status: 'Draft', tags: [], createdAt: 1, updatedAt: 1,
})
const inline = (b64: string) => `<img src="data:image/png;base64,${b64}">`

beforeEach(async () => {
  await db.pages.clear()
  await db.images.clear()
  await db.meta.delete(BODY_IMAGES_MIGRATED_KEY)
})

describe('migrateInlineBodyImages (#182 phase 2)', () => {
  it('lifts inline body images into kind:body rows and leaves a ref in the content', async () => {
    await db.pages.add(page('P1', `<p>${inline('AAA')}</p>`))

    const count = await migrateInlineBodyImages()
    expect(count).toBe(1)

    // The bytes now live in a kind:'body' image row owned by the page.
    const rows = await db.images.where('pageId').equals('P1').toArray()
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('body')
    expect(rows[0].dataUrl).toBe('data:image/png;base64,AAA')

    // The content references it and no longer carries the bytes.
    const content = (await db.pages.get('P1'))!.content
    expect(content).toContain(`${BODY_IMAGE_ATTR}="${rows[0].id}"`)
    expect(content).not.toContain('data:image')
  })

  it('does not bump updatedAt (a format migration, not a user edit)', async () => {
    await db.pages.add(page('P1', `<p>${inline('AAA')}</p>`))
    await migrateInlineBodyImages()
    expect((await db.pages.get('P1'))!.updatedAt).toBe(1)
  })

  it('is idempotent: a second run migrates nothing and adds no rows', async () => {
    await db.pages.add(page('P1', `<p>${inline('AAA')}</p>`))
    await migrateInlineBodyImages()
    const afterFirst = await db.images.count()

    const second = await migrateInlineBodyImages()
    expect(second).toBe(0)
    expect(await db.images.count()).toBe(afterFirst)
  })

  it('skips pages with nothing to migrate and leaves existing refs alone', async () => {
    await db.pages.add(page('plain', '<p>just text</p>'))
    await db.pages.add(page('ref', `<p><img ${BODY_IMAGE_ATTR}="keep"></p>`))
    await db.pages.add(page('mixed', `<p><img ${BODY_IMAGE_ATTR}="keep"> and ${inline('NEW')}</p>`))

    const count = await migrateInlineBodyImages()
    expect(count).toBe(1) // only 'mixed' had an inline image
    expect((await db.pages.get('mixed'))!.content).toContain(`${BODY_IMAGE_ATTR}="keep"`)
    expect((await db.pages.get('mixed'))!.content).not.toContain('data:image')
  })

  it('respects the done flag: a preset flag short-circuits the scan', async () => {
    await db.meta.put({ key: BODY_IMAGES_MIGRATED_KEY, value: true })
    await db.pages.add(page('P1', `<p>${inline('AAA')}</p>`))
    expect(await migrateInlineBodyImages()).toBe(0)
    expect(await db.images.count()).toBe(0) // untouched
  })
})
