import { Node, mergeAttributes } from '@tiptap/core'
import { getImageUrl } from '../db'
import { BODY_IMAGE_ATTR } from '../bodyImage'

// ---------------------------------------------------------------------------
// BodyImage: a block image stored BY REFERENCE (#182).
//
// Instead of embedding the (large) compressed data URL inline in page.content —
// which makes every keystroke-save rewrite the image bytes — the node stores just
// an id (`data-image-id`) into the images table. The node view resolves that id
// to its data URL at render time. So the serialized body is a tiny
// `<img data-image-id="…">`, and the bytes live once in the images table.
//
// It parses only imgs that carry data-image-id, so the legacy inline-image node
// (@tiptap/extension-image, matching img[src]) still handles existing bodies —
// the two are mutually exclusive by attribute.
// ---------------------------------------------------------------------------

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    bodyImage: {
      /** Insert a body image that references an already-stored images-table row. */
      insertBodyImage: (attrs: { imageId: string }) => ReturnType
    }
  }
}

export const BodyImage = Node.create({
  name: 'bodyImage',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      imageId: {
        default: null,
        parseHTML: (el) => el.getAttribute(BODY_IMAGE_ATTR),
        renderHTML: (attrs) => (attrs.imageId ? { [BODY_IMAGE_ATTR]: attrs.imageId } : {}),
      },
    }
  },

  parseHTML() {
    return [{ tag: `img[${BODY_IMAGE_ATTR}]` }]
  },

  // Serialized (stored) form: a bytes-free reference. The node view below is what
  // the user actually sees in the editor.
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes)]
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('img')
      dom.className = 'body-image'
      dom.alt = ''
      const id = node.attrs.imageId as string | null
      if (id) {
        dom.setAttribute(BODY_IMAGE_ATTR, id)
        getImageUrl(id)
          .then((url) => {
            if (url) dom.src = url
            else dom.classList.add('is-missing')
          })
          .catch(() => dom.classList.add('is-missing'))
      }
      return { dom }
    }
  },

  addCommands() {
    return {
      insertBodyImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    }
  },
})
