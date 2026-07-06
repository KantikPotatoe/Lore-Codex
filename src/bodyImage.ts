import { parseHtml } from './html'

// Body images (#182) are stored by reference: page.content carries an
// `<img data-image-id="…">` with no bytes, and the actual data URL lives in the
// images table (kind:'body'). This module is the pure glue shared by the Tiptap
// node, the sanitizer whitelist, and every export path — so they all agree on the
// attribute name and on how a ref resolves back to bytes.

/** The attribute a bodyImage node serializes its image id into. */
export const BODY_IMAGE_ATTR = 'data-image-id'

/** The image ids referenced by body-image nodes in `html`, in document order,
 *  deduped. Ordinary inline `<img src="data:…">` images are ignored. */
export function bodyImageIds(html: string): string[] {
  if (!html || !html.includes(BODY_IMAGE_ATTR)) return []
  const ids: string[] = []
  const seen = new Set<string>()
  for (const img of parseHtml(html).querySelectorAll(`img[${BODY_IMAGE_ATTR}]`)) {
    const id = img.getAttribute(BODY_IMAGE_ATTR)
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export interface BodyImageMigrationPlan {
  /** The body with every inline data-URL image turned into a ref node. */
  html: string
  /** The bytes lifted out, for the caller to store as images-table rows. */
  added: { id: string; dataUrl: string }[]
}

/** Plan the migration of a legacy body's inline data-URL images to the by-ref
 *  model (#182 phase 2): each `<img src="data:…">` becomes an
 *  `<img data-image-id>` and its bytes are handed back in `added` for the caller
 *  to store. Existing ref nodes and external-src images are left untouched.
 *  Returns null when there is nothing to migrate, so an already-migrated (or
 *  imageless) body is never rewritten — the migration is idempotent. */
export function planBodyImageMigration(
  html: string,
  makeId: () => string,
): BodyImageMigrationPlan | null {
  if (!html || !html.includes('data:image')) return null
  const doc = parseHtml(html)
  const added: { id: string; dataUrl: string }[] = []
  for (const img of doc.querySelectorAll('img')) {
    if (img.hasAttribute(BODY_IMAGE_ATTR)) continue // already a ref
    const src = img.getAttribute('src')
    if (!src || !src.startsWith('data:')) continue // external / non-data — leave as-is
    const id = makeId()
    added.push({ id, dataUrl: src })
    img.removeAttribute('src')
    img.setAttribute(BODY_IMAGE_ATTR, id)
  }
  if (added.length === 0) return null
  return { html: doc.body.innerHTML, added }
}

/** Rewrite each body-image ref in `html` into a plain `<img src="…">` using
 *  `urlById` to resolve the bytes. A ref whose image is missing (deleted) is
 *  dropped entirely rather than left as a broken node. Ordinary inline images are
 *  untouched. Used by the HTML/EPUB/print export paths, which serialize HTML
 *  directly rather than through the editor's node view. */
export function resolveBodyImages(html: string, urlById: (id: string) => string | null): string {
  if (!html || !html.includes(BODY_IMAGE_ATTR)) return html
  const doc = parseHtml(html)
  for (const img of doc.querySelectorAll(`img[${BODY_IMAGE_ATTR}]`)) {
    const id = img.getAttribute(BODY_IMAGE_ATTR)
    const url = id ? urlById(id) : null
    if (!url) {
      img.remove()
      continue
    }
    img.removeAttribute(BODY_IMAGE_ATTR)
    img.setAttribute('src', url)
  }
  return doc.body.innerHTML
}
