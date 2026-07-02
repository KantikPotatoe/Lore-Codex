import { useCallback } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pageRepo, applyTemplate, type InfoboxTemplate, type LorePage } from './db'

// Stable empty identity so consumers' deps don't bust every render while the
// templates query is still loading.
const NO_TEMPLATES: InfoboxTemplate[] = []

export interface UsePage {
  /** The page record. `undefined` while loading OR when no page has that id
   *  (pageRepo.get can't tell them apart); `null` is kept in the union for the
   *  route's defensive not-found branch. */
  page: LorePage | undefined | null
  /** All page-type templates — for the type picker and category re-seeding. */
  templates: InfoboxTemplate[]
  update: (changes: Partial<LorePage>) => Promise<void>
  rename: (title: string) => Promise<void>
  addTag: (tag: string) => Promise<void>
  removeTag: (tag: string) => Promise<void>
  changeCategory: (category: string) => Promise<void>
  remove: () => Promise<void>
}

/** The page record plus every mutation PageRoute performs on it, lifted out of
 *  the component so the route reads as presentation. Reads stay reactive via
 *  useLiveQuery; mutations go through the pageRepo seam. */
export function usePage(id: string): UsePage {
  const page = useLiveQuery(() => pageRepo.get(id), [id])
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray(), []) ?? NO_TEMPLATES

  const update = useCallback((changes: Partial<LorePage>) => pageRepo.update(id, changes), [id])
  const rename = useCallback((title: string) => pageRepo.rename(id, title), [id])
  const remove = useCallback(() => pageRepo.remove(id), [id])

  const addTag = useCallback(
    async (tag: string) => {
      const t = tag.trim()
      if (!t || !page || page.tags.includes(t)) return
      await pageRepo.update(id, { tags: [...page.tags, t] })
    },
    [id, page],
  )

  const removeTag = useCallback(
    async (tag: string) => {
      if (!page) return
      await pageRepo.update(id, { tags: page.tags.filter((x) => x !== tag) })
    },
    [id, page],
  )

  // Changing a page's type also re-seeds its infobox from that template,
  // keeping any values already filled in.
  const changeCategory = useCallback(
    async (category: string) => {
      if (!page) return
      const changes: Partial<LorePage> = { category }
      const tpl = templates.find((t) => t.name === category)
      if (tpl && page.infobox) changes.infobox = applyTemplate(page.infobox, tpl)
      await pageRepo.update(id, changes)
    },
    [id, page, templates],
  )

  return { page, templates, update, rename, addTag, removeTag, changeCategory, remove }
}
