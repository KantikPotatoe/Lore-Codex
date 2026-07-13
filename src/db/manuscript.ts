import { db, uid, now, TYPE_COLORS } from './schema'
import { stripHtml, wikiLinkTitles } from '../html'
import { structureDef } from '../manuscriptStructures'
import type { Book, Chapter, Scene, SceneStatus, StructureType, Plotline, Beat } from './types'

// ---------------------------------------------------------------------------
// Manuscript authoring — the author's real novel (Book → Chapter → Scene) plus a
// Plottr-style plotline grid. Distinct from wiki pages and from the in-world
// Document page type. All tables are per-lore, id-based, and cascade on delete.
// ---------------------------------------------------------------------------

/** Scene draft states, ordered least→most finished. Drives grid/scene colors.
 *  Deliberately separate from the page STATUSES. */
export const SCENE_STATUSES = [
  { name: 'outline', label: 'Outline', color: '#8a8175' },
  { name: 'draft', label: 'Draft', color: '#c98f5a' },
  { name: 'revised', label: 'Revised', color: '#6f9cc7' },
  { name: 'done', label: 'Done', color: '#5aa86b' },
] as const satisfies readonly { name: SceneStatus; label: string; color: string }[]

export function sceneStatusColor(status: SceneStatus): string {
  return SCENE_STATUSES.find((s) => s.name === status)?.color ?? '#8a8175'
}

/** Word count of rich-text HTML: strip tags, then count whitespace-separated runs. */
export function computeWordCount(html: string): number {
  const text = stripHtml(html).trim()
  if (!text) return 0
  return text.split(/\s+/).filter(Boolean).length
}

// --- Books -----------------------------------------------------------------

export async function createBook(title: string): Promise<Book> {
  const existing = await db.books.toArray()
  const order = existing.reduce((max, b) => Math.max(max, b.order + 1), 0)
  const book: Book = {
    id: uid(), title, synopsis: '', order, createdAt: now(), updatedAt: now(),
  }
  await db.books.add(book)
  return book
}

export async function updateBook(
  id: string,
  patch: Partial<Omit<Book, 'id' | 'createdAt'>>,
): Promise<void> {
  await db.books.update(id, { ...patch, updatedAt: now() })
}

export async function listBooks(): Promise<Book[]> {
  return db.books.orderBy('order').toArray()
}

export async function reorderBooks(orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    let index = 0
    for (const id of orderedIds) {
      const book = await db.books.get(id)
      if (book) {
        await db.books.update(id, { order: index })
        index++
      }
    }
  })
}

export async function deleteBook(id: string): Promise<void> {
  await db.transaction('rw', [db.books, db.chapters, db.scenes, db.plotlines, db.beats], async () => {
    await db.beats.where('bookId').equals(id).delete()
    await db.plotlines.where('bookId').equals(id).delete()
    await db.scenes.where('bookId').equals(id).delete()
    await db.chapters.where('bookId').equals(id).delete()
    await db.books.delete(id)
  })
}

// --- Beat cleanup helper (shared by scene/chapter delete) -------------------
// When a scene is removed, its plot beats are deleted, but a structure beat that
// was aligned to it reverts to unplaced (sceneId=null) rather than vanishing.
// Must run inside an rw transaction covering plotlines + beats.
async function detachBeatsForScene(sceneId: string): Promise<void> {
  const beats = await db.beats.where('sceneId').equals(sceneId).toArray()
  for (const beat of beats) {
    const lane = await db.plotlines.get(beat.plotlineId)
    if (lane?.kind === 'structure') {
      await db.beats.update(beat.id, { sceneId: null, updatedAt: now() })
    } else {
      await db.beats.delete(beat.id)
    }
  }
}

// --- Chapters ---------------------------------------------------------------

export async function createChapter(bookId: string, title: string): Promise<Chapter> {
  const existing = await db.chapters.where('bookId').equals(bookId).toArray()
  const order = existing.reduce((max, c) => Math.max(max, c.order + 1), 0)
  const chapter: Chapter = {
    id: uid(), bookId, title, order, createdAt: now(), updatedAt: now(),
  }
  await db.chapters.add(chapter)
  return chapter
}

export async function updateChapter(
  id: string,
  patch: Partial<Omit<Chapter, 'id' | 'bookId' | 'createdAt'>>,
): Promise<void> {
  await db.chapters.update(id, { ...patch, updatedAt: now() })
}

export async function listChapters(bookId: string): Promise<Chapter[]> {
  return db.chapters.where('bookId').equals(bookId).sortBy('order')
}

export async function reorderChapters(bookId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.chapters, async () => {
    const byId = new Map((await db.chapters.where('bookId').equals(bookId).toArray()).map((c) => [c.id, c]))
    let index = 0
    for (const id of orderedIds) {
      if (byId.has(id)) {
        await db.chapters.update(id, { order: index })
        index++
      }
    }
  })
}

export async function deleteChapter(id: string): Promise<void> {
  await db.transaction('rw', [db.chapters, db.scenes, db.plotlines, db.beats], async () => {
    const scenes = await db.scenes.where('chapterId').equals(id).toArray()
    for (const scene of scenes) {
      await detachBeatsForScene(scene.id)
      await db.scenes.delete(scene.id)
    }
    await db.chapters.delete(id)
  })
}

// --- Scenes -----------------------------------------------------------------

export async function createScene(
  bookId: string,
  chapterId: string,
  title: string,
): Promise<Scene> {
  const existing = await db.scenes.where('chapterId').equals(chapterId).toArray()
  const order = existing.reduce((max, s) => Math.max(max, s.order + 1), 0)
  const scene: Scene = {
    id: uid(), bookId, chapterId, title, content: '', synopsis: '', notes: '',
    status: 'outline', order, wordCount: 0, povPageId: null,
    castPageIds: [], locationPageIds: [], createdAt: now(), updatedAt: now(),
  }
  await db.scenes.add(scene)
  return scene
}

export async function updateScene(
  id: string,
  patch: Partial<Omit<Scene, 'id' | 'bookId' | 'createdAt'>>,
): Promise<void> {
  const next: Partial<Scene> = { ...patch, updatedAt: now() }
  if (typeof patch.content === 'string') {
    next.wordCount = computeWordCount(patch.content)
  }
  await db.scenes.update(id, next)
}

export async function listScenes(chapterId: string): Promise<Scene[]> {
  return db.scenes.where('chapterId').equals(chapterId).sortBy('order')
}

/** Every scene in a book, in reading order. The binder, the grid and the
 *  structure lane all work book-at-a-time; `listScenes` above is the
 *  chapter-scoped sibling. */
export async function listScenesForBook(bookId: string): Promise<Scene[]> {
  return db.scenes.where('bookId').equals(bookId).sortBy('order')
}

export async function reorderScenes(chapterId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.scenes, async () => {
    const byId = new Map((await db.scenes.where('chapterId').equals(chapterId).toArray()).map((s) => [s.id, s]))
    let index = 0
    for (const id of orderedIds) {
      if (byId.has(id)) {
        await db.scenes.update(id, { order: index })
        index++
      }
    }
  })
}

export async function moveScene(
  sceneId: string,
  toChapterId: string,
  toIndex: number,
): Promise<void> {
  await db.transaction('rw', db.scenes, async () => {
    const scene = await db.scenes.get(sceneId)
    if (!scene) return
    const target = (await db.scenes.where('chapterId').equals(toChapterId).sortBy('order'))
      .filter((s) => s.id !== sceneId)
    target.splice(Math.max(0, Math.min(toIndex, target.length)), 0, { ...scene, chapterId: toChapterId })
    let index = 0
    for (const s of target) {
      await db.scenes.update(s.id, {
        chapterId: toChapterId, order: index, updatedAt: now(),
      })
      index++
    }
  })
}

export async function deleteScene(id: string): Promise<void> {
  await db.transaction('rw', [db.scenes, db.plotlines, db.beats], async () => {
    await detachBeatsForScene(id)
    await db.scenes.delete(id)
  })
}

// --- Word-count rollups -----------------------------------------------------

export async function chapterWordCount(chapterId: string): Promise<number> {
  const scenes = await db.scenes.where('chapterId').equals(chapterId).toArray()
  return scenes.reduce((sum, s) => sum + s.wordCount, 0)
}

export async function bookWordCount(bookId: string): Promise<number> {
  const scenes = await db.scenes.where('bookId').equals(bookId).toArray()
  return scenes.reduce((sum, s) => sum + s.wordCount, 0)
}

// --- "Appears in": which scenes reference a wiki page --------------------------

export type AppearanceRole = 'pov' | 'cast' | 'location' | 'mention'

export interface SceneAppearance {
  sceneId: string
  bookId: string
  bookTitle: string
  chapterTitle: string
  sceneTitle: string
  roles: AppearanceRole[]
}

/** Every manuscript scene that references `pageId` — via its POV/cast/location
 *  refs (id-based) or an inline [[wiki-link]] to the page's title in the prose.
 *  Ordered by book, then chapter, then scene. */
export async function sceneAppearances(pageId: string): Promise<SceneAppearance[]> {
  const page = await db.pages.get(pageId)
  if (!page) return []
  const titleLc = page.title.trim().toLowerCase()

  const [scenes, chapters, books] = await Promise.all([
    db.scenes.toArray(),
    db.chapters.toArray(),
    db.books.toArray(),
  ])
  const chapterById = new Map(chapters.map((c) => [c.id, c]))
  const bookById = new Map(books.map((b) => [b.id, b]))

  const out: { appearance: SceneAppearance; sort: [number, number, number] }[] = []
  for (const s of scenes) {
    const roles: AppearanceRole[] = []
    if (s.povPageId === pageId) roles.push('pov')
    if (s.castPageIds.includes(pageId)) roles.push('cast')
    if (s.locationPageIds.includes(pageId)) roles.push('location')
    if (wikiLinkTitles(s.content).some((t) => t.trim().toLowerCase() === titleLc)) {
      roles.push('mention')
    }
    if (roles.length === 0) continue
    const ch = chapterById.get(s.chapterId)
    const bk = bookById.get(s.bookId)
    out.push({
      appearance: {
        sceneId: s.id,
        bookId: s.bookId,
        bookTitle: bk?.title ?? '(book)',
        chapterTitle: ch?.title ?? '(chapter)',
        sceneTitle: s.title,
        roles,
      },
      sort: [bk?.order ?? 0, ch?.order ?? 0, s.order],
    })
  }

  out.sort((a, b) =>
    a.sort[0] - b.sort[0] || a.sort[1] - b.sort[1] || a.sort[2] - b.sort[2],
  )
  return out.map((o) => o.appearance)
}

// --- Plotlines (grid lanes) ---------------------------------------------------

export async function createPlotline(
  bookId: string,
  name: string,
  opts: { color?: string; kind?: 'plot' | 'structure'; structureType?: StructureType } = {},
): Promise<Plotline> {
  const existing = await db.plotlines.where('bookId').equals(bookId).toArray()
  const order = existing.reduce((max, p) => Math.max(max, p.order + 1), 0)
  const color = opts.color ?? TYPE_COLORS[existing.length % TYPE_COLORS.length]
  const plotline: Plotline = {
    id: uid(), bookId, name, color, kind: opts.kind ?? 'plot',
    structureType: opts.structureType, order, createdAt: now(), updatedAt: now(),
  }
  await db.plotlines.add(plotline)
  return plotline
}

export async function updatePlotline(
  id: string,
  patch: Partial<Omit<Plotline, 'id' | 'bookId' | 'createdAt'>>,
): Promise<void> {
  await db.plotlines.update(id, { ...patch, updatedAt: now() })
}

export async function listPlotlines(bookId: string): Promise<Plotline[]> {
  return db.plotlines.where('bookId').equals(bookId).sortBy('order')
}

export async function reorderPlotlines(bookId: string, orderedIds: string[]): Promise<void> {
  await db.transaction('rw', db.plotlines, async () => {
    const byId = new Map((await db.plotlines.where('bookId').equals(bookId).toArray()).map((p) => [p.id, p]))
    let index = 0
    for (const id of orderedIds) {
      if (byId.has(id)) {
        await db.plotlines.update(id, { order: index })
        index++
      }
    }
  })
}

export async function deletePlotline(id: string): Promise<void> {
  await db.transaction('rw', [db.plotlines, db.beats], async () => {
    await db.beats.where('plotlineId').equals(id).delete()
    await db.plotlines.delete(id)
  })
}

// --- Beats (grid cells) -------------------------------------------------------

export async function createBeat(
  bookId: string,
  plotlineId: string,
  sceneId: string | null,
  note = '',
): Promise<Beat> {
  const existing = await db.beats.where('plotlineId').equals(plotlineId).toArray()
  const order = existing.reduce((max, b) => Math.max(max, b.order + 1), 0)
  const beat: Beat = {
    id: uid(), bookId, plotlineId, sceneId, label: '', note, order,
    createdAt: now(), updatedAt: now(),
  }
  await db.beats.add(beat)
  return beat
}

export async function updateBeat(
  id: string,
  patch: Partial<Omit<Beat, 'id' | 'bookId' | 'createdAt'>>,
): Promise<void> {
  await db.beats.update(id, { ...patch, updatedAt: now() })
}

export async function deleteBeat(id: string): Promise<void> {
  await db.beats.delete(id)
}

export async function listBeats(bookId: string): Promise<Beat[]> {
  return db.beats.where('bookId').equals(bookId).toArray()
}

// --- Story-structure track ----------------------------------------------------

export async function getStructurePlotline(bookId: string): Promise<Plotline | undefined> {
  return db.plotlines.where('bookId').equals(bookId).and((p) => p.kind === 'structure').first()
}

/** Apply a story structure to a book: replace any existing structure lane, then
 *  seed one beat per structure beat (unplaced) in a new structure-kind lane. */
export async function applyStructure(bookId: string, type: StructureType): Promise<void> {
  const def = structureDef(type)
  if (!def) return
  await removeStructure(bookId)
  const lane = await createPlotline(bookId, def.name, { kind: 'structure', structureType: type, color: '#c9a24b' })
  for (let i = 0; i < def.beats.length; i++) {
    const beat = await createBeat(bookId, lane.id, null, '')
    await updateBeat(beat.id, { label: def.beats[i], order: i })
  }
}

export async function removeStructure(bookId: string): Promise<void> {
  const lane = await getStructurePlotline(bookId)
  if (lane) await deletePlotline(lane.id)
}
