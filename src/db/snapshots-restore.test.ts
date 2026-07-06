import { describe, it, expect, beforeEach } from 'vitest'
import { db, exportSnapshot, restoreSnapshotInto } from '../db'

// #183: snapshots store only text tables (no image/map bytes), and restoring one
// replaces the text tables while LEAVING the live images/maps untouched — so a
// snapshot no longer multiplies origin quota by its image payload, and a restore
// can't wipe images/maps that snapshots deliberately don't version.
beforeEach(async () => {
  await Promise.all([
    db.pages.clear(), db.images.clear(), db.maps.clear(), db.pins.clear(),
    db.regions.clear(), db.events.clear(),
  ])
})

const page = (id: string, title: string) => ({
  id, title, titleLc: title.toLowerCase(), category: 'Character',
  content: '<p>x</p>', summary: '', status: 'Draft', tags: [], createdAt: 1, updatedAt: 1,
})

describe('exportSnapshot', () => {
  it('captures text tables but omits image and map bytes', async () => {
    await db.pages.add(page('p1', 'Aragorn'))
    await db.images.add({ id: 'i1', pageId: 'p1', order: 0, dataUrl: 'data:image/png;base64,AAAA', caption: '', createdAt: 1 } as never)
    await db.maps.add({ id: 'm1', name: 'Map', image: 'data:image/png;base64,BBBB', width: 10, height: 10, createdAt: 1 } as never)

    const parsed = JSON.parse(await exportSnapshot())
    expect(parsed.pages).toHaveLength(1)
    expect(parsed.images).toEqual([])
    expect(parsed.maps).toEqual([])
    expect(parsed.pins).toEqual([])
    expect(parsed.regions).toEqual([])
  })
})

describe('restoreSnapshotInto', () => {
  it('replaces text tables but preserves live images and maps', async () => {
    // Live state at snapshot time: one page, one image, one map.
    await db.pages.add(page('A', 'Alpha'))
    await db.images.add({ id: 'i1', pageId: 'A', order: 0, dataUrl: 'data:image/png;base64,AAAA', caption: '', createdAt: 1 } as never)
    await db.maps.add({ id: 'm1', name: 'World', image: 'data:image/png;base64,BBBB', width: 10, height: 10, createdAt: 1 } as never)

    const snap = await exportSnapshot() // captures page A only

    // The world moves on: a new page is added after the snapshot.
    await db.pages.add(page('B', 'Beta'))

    await restoreSnapshotInto(db, snap)

    // Text tables rolled back to the snapshot (B gone, A present).
    expect((await db.pages.toArray()).map((p) => p.id).sort()).toEqual(['A'])
    // Images and maps are untouched by the restore.
    expect((await db.images.toArray()).map((i) => i.id)).toEqual(['i1'])
    expect((await db.maps.toArray()).map((m) => m.id)).toEqual(['m1'])
  })
})
