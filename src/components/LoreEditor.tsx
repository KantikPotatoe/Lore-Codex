import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { useLiveQuery } from 'dexie-react-hooks'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { WikiLink } from '../extensions/WikiLink'
import { Citation } from '../extensions/Citation'
import { Autolink, autolinkKey } from '../extensions/Autolink'
import { BodyImage } from '../extensions/BodyImage'
import { pageRepo } from '../db'
import { compressImage } from '../imageUtils'
import { showWikiHover, scheduleWikiHoverClose } from '../wikiLinkHover'
import { findOpenWikiQuery, rankWikiTitles } from '../wikiAutocomplete'
import { sectionNodes } from '../sectionNodes'

/** State of the open [[autocomplete]] menu: the partial query, the document
 *  range (`from`..`to`) covering the `[[query` text to be replaced on accept,
 *  and the highlighted row. */
interface WikiSuggest { query: string; from: number; to: number; index: number }

/** Inspect the text just before the cursor for an unclosed `[[`. Returns the
 *  suggestion anchor, or null when there's nothing to complete. */
function computeSuggest(editor: Editor): WikiSuggest | null {
  if (!editor.isEditable) return null
  const { selection } = editor.state
  if (!selection.empty) return null
  const $from = selection.$from
  // textBetween with a placeholder for leaf nodes so an inline atom (an existing
  // wiki link) reads as one non-bracket char rather than splicing text together.
  const textBefore = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼')
  const found = findOpenWikiQuery(textBefore)
  if (!found) return null
  const to = selection.from
  return { query: found.query, from: to - found.matchLength, to, index: 0 }
}

/** State of the citation dialog. `pos` is the doc position of the node being
 *  edited, or null when inserting a new citation. */
interface CiteDraft {
  pos: number | null
  mode: 'page' | 'text'
  target: string
  text: string
  locator: string
  quote: string
}

/** When the selection is a single citation node, return its position + attrs. */
function selectedCitation(editor: Editor): { pos: number; attrs: CiteDraft } | null {
  if (!editor.isEditable) return null
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'citation') {
    const a = selection.node.attrs
    return {
      pos: selection.from,
      attrs: {
        pos: selection.from,
        mode: a.text && !a.target ? 'text' : 'page',
        target: a.target ?? '',
        text: a.text ?? '',
        locator: a.locator ?? '',
        quote: a.quote ?? '',
      },
    }
  }
  return null
}

/** When the current selection is a single wiki-link node, return its document
 *  position and attrs so the edit popover can target it. Otherwise null. */
function selectedWikiLink(editor: Editor): { pos: number; title: string; display: string } | null {
  if (!editor.isEditable) return null
  const { selection } = editor.state
  if (selection instanceof NodeSelection && selection.node.type.name === 'wikiLink') {
    return { pos: selection.from, title: selection.node.attrs.title, display: selection.node.attrs.display || '' }
  }
  return null
}

interface Props {
  content: string
  editable: boolean
  onChange: (html: string) => void
  /** Editor lost focus — a good moment to flush a debounced content write. */
  onBlur?: () => void
  /** Store an inserted body image's bytes out-of-band and return its id; the
   *  editor then inserts a lightweight `bodyImage` reference node instead of an
   *  inline data URL (#182). When absent (scenes/events), images stay inline. */
  onInsertImage?: (dataUrl: string) => Promise<string>
  /** Called when a [[wiki link]] is clicked, with the linked page title. */
  onWikiClick: (title: string) => void
  /** Lowercased titles of existing pages; missing ones render as broken (view mode). */
  knownTitles?: Set<string>
  /** Canonical page titles (excluding the current page) for body autolinking. */
  autolinkTitles?: string[]
  /** Whether the autolinker is enabled for this world. */
  autolinkEnabled?: boolean
  /** View-mode: a citation marker was clicked; arg is its 0-based order in the body. */
  onCitationClick?: (index: number) => void
  /** Starter body-section names for this page's type; drives the "＋ Sections" button. */
  starterSections?: string[]
}

/** Toolbar button helper. */
function Btn({ active, onClick, title, children }: {
  active?: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' is-active' : ''}`}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep editor focus
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export default function LoreEditor({ content, editable, onChange, onBlur, onInsertImage, onWikiClick, knownTitles, autolinkTitles, autolinkEnabled, onCitationClick, starterSections }: Props) {
  // --- [[wiki link]] autocomplete state ------------------------------------
  // `index` is the highlighted row; it lives in the same object so a new query
  // (a fresh suggest) naturally resets it to 0 without a separate effect.
  const [suggest, setSuggest] = useState<WikiSuggest | null>(null)
  // The wiki-link node currently being edited via the popover (edit mode only).
  const [editLink, setEditLink] = useState<{ pos: number; title: string; display: string } | null>(null)
  const [cite, setCite] = useState<CiteDraft | null>(null)
  // Titles of all pages, for the suggestion menu. Read straight off the `title`
  // index — no record hydration just to list titles.
  const pageTitles = useLiveQuery(() => pageRepo.titles(), [])
  const items = useMemo(
    () => (suggest ? rankWikiTitles(pageTitles ?? [], suggest.query) : []),
    [suggest, pageTitles],
  )

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false, // we handle clicks ourselves so wiki vs external stay separate
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer', class: 'ext-link' },
        },
      }),
      WikiLink,
      Citation,
      Autolink,
      BodyImage,
      Image.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ table: { resizable: true } }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => { onChange(editor.getHTML()); setSuggest(computeSuggest(editor)) },
    onSelectionUpdate: ({ editor }) => {
      setSuggest(computeSuggest(editor)); setEditLink(selectedWikiLink(editor))
      const sc = selectedCitation(editor)
      setCite(sc ? sc.attrs : null)
    },
    onBlur: () => { setSuggest(null); onBlur?.() },
  })

  // Replace the `[[query` text with a real wiki-link node to `title`.
  const acceptSuggestion = useCallback((title: string) => {
    if (!editor || !suggest) return
    editor.chain().focus()
      .deleteRange({ from: suggest.from, to: suggest.to })
      .insertContent([{ type: 'wikiLink', attrs: { title } }, { type: 'text', text: ' ' }])
      .run()
    setSuggest(null)
  }, [editor, suggest])

  // Write the popover's Target/Display back onto the selected wiki-link node.
  const applyEditLink = useCallback(() => {
    if (!editor || !editLink) return
    const title = editLink.title.trim()
    if (!title) { setEditLink(null); return }
    const display = editLink.display.trim()
    editor.chain().focus().command(({ tr }) => {
      tr.setNodeMarkup(editLink.pos, undefined, {
        title,
        display: display && display !== title ? display : '',
      })
      return true
    }).run()
    // .run() dispatches synchronously, so onSelectionUpdate re-sets editLink to the
    // (now updated) node mid-call; this setEditLink(null) is batched after it and
    // wins, closing the popover. Keep it last.
    setEditLink(null)
  }, [editor, editLink])

  // Open the dialog to insert a brand-new citation at the cursor.
  const openCite = useCallback(() => {
    setCite({ pos: null, mode: 'page', target: '', text: '', locator: '', quote: '' })
  }, [])

  // Write the dialog back to the document: update the selected node, or insert one.
  const applyCite = useCallback(() => {
    if (!editor || !cite) return
    const attrs = {
      target: cite.mode === 'page' ? cite.target.trim() : '',
      text: cite.mode === 'text' ? cite.text.trim() : '',
      locator: cite.locator.trim(),
      quote: cite.quote.trim(),
    }
    if (!attrs.target && !attrs.text) { setCite(null); return } // nothing to cite
    if (cite.pos === null) {
      editor.chain().focus().insertContent({ type: 'citation', attrs }).run()
    } else {
      const pos = cite.pos
      editor.chain().focus().command(({ tr }) => { tr.setNodeMarkup(pos, undefined, attrs); return true }).run()
    }
    setCite(null)
  }, [editor, cite])

  // Drive the menu from the keyboard. A capture-phase listener on the editor DOM
  // runs before ProseMirror's own keymap, so we can claim the nav keys (and stop
  // them reaching the doc) only while the menu has results.
  useEffect(() => {
    if (!editor || !editable || !suggest || items.length === 0) return
    const dom = editor.view.dom
    const idx = Math.min(suggest.index, items.length - 1)
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSuggest((s) => s && { ...s, index: (idx + 1) % items.length }) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSuggest((s) => s && { ...s, index: (idx - 1 + items.length) % items.length }) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); acceptSuggestion(items[idx]) }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSuggest(null) }
    }
    dom.addEventListener('keydown', onKeyDown, true)
    return () => dom.removeEventListener('keydown', onKeyDown, true)
  }, [editor, editable, suggest, items, acceptSuggestion])

  const fileInput = useRef<HTMLInputElement>(null)
  const [showLinkBox, setShowLinkBox] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')

  // Insert an image into the body: downscale to a body-friendly 1600px (local-first
  // — no upload). When onInsertImage is provided (page editing), store the bytes in
  // the images table and insert a lightweight bodyImage reference so typing never
  // rewrites the bytes (#182); otherwise embed inline as a data URL.
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || !editor) return
    const dataUrl = await compressImage(file, 1600)
    if (onInsertImage) {
      const imageId = await onInsertImage(dataUrl)
      editor.chain().focus().insertBodyImage({ imageId }).run()
    } else {
      editor.chain().focus().setImage({ src: dataUrl }).run()
    }
  }

  function openLinkBox() {
    setLinkUrl(editor?.getAttributes('link').href ?? '')
    setShowLinkBox(true)
  }

  function applyLink() {
    const url = linkUrl.trim()
    if (!url) {
      editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      // Prefix https:// when the author types a bare domain (e.g. "example.com").
      const href = /^(https?:\/\/|mailto:)/i.test(url) ? url : `https://${url}`
      editor?.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
    setShowLinkBox(false)
    setLinkUrl('')
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange('link').unsetLink().run()
    setShowLinkBox(false)
    setLinkUrl('')
  }

  // Toggle edit/view without losing the editor instance.
  useEffect(() => {
    editor?.setEditable(editable)
  }, [editable, editor])

  // Feed the autolinker its title set + on/off state. Disabled while editing so
  // authoring sees plain text; the plugin also self-gates on editor.isEditable.
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(
      editor.state.tr.setMeta(autolinkKey, {
        enabled: !!autolinkEnabled && !editable,
        titles: autolinkTitles ?? [],
      }),
    )
  }, [editor, autolinkEnabled, autolinkTitles, editable])

  // In view mode, flag links whose target page no longer exists. Mirrors the
  // post-render DOM pass TableOfContents uses; edit mode is left untouched so
  // authoring isn't disrupted.
  useEffect(() => {
    if (!editor || editable || !knownTitles) return
    editor.view.dom.querySelectorAll('a.wiki-link').forEach((a) => {
      const t = a.getAttribute('data-title')?.trim().toLowerCase()
      a.classList.toggle('is-broken', !!t && !knownTitles.has(t))
    })
  }, [editor, editable, knownTitles, content])

  if (!editor) return null

  // Caret coords for the autocomplete menu (viewport-fixed). coordsAtPos reads
  // layout and can throw for a transient out-of-range pos, so guard it.
  let suggestPos: { left: number; top: number } | null = null
  if (editable && suggest && items.length > 0) {
    try {
      const c = editor.view.coordsAtPos(suggest.to)
      suggestPos = { left: c.left, top: c.bottom }
    } catch { suggestPos = null }
  }

  let editLinkPos: { left: number; top: number } | null = null
  if (editable && editLink) {
    try {
      const c = editor.view.coordsAtPos(editLink.pos)
      editLinkPos = { left: c.left, top: c.bottom }
    } catch { editLinkPos = null }
  }

  // Route clicks: wiki links navigate in-app; external href links open a new
  // tab. In edit mode both require Ctrl/Cmd-click so plain clicks place the cursor.
  const handleClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement

    const wiki = el.closest('.wiki-link')
    if (wiki) {
      if (editable && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      const title = wiki.getAttribute('data-title')
      if (title) onWikiClick(title)
      return
    }

    const citeEl = el.closest('sup[data-citation]')
    if (citeEl) {
      if (editable) return // edit mode: selection opens the dialog instead
      e.preventDefault()
      const all = Array.from(editor.view.dom.querySelectorAll('sup[data-citation]'))
      const idx = all.indexOf(citeEl)
      if (idx >= 0) onCitationClick?.(idx)
      return
    }

    const ext = el.closest('a[href]:not(.wiki-link)') as HTMLAnchorElement | null
    if (ext) {
      if (editable && !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      const href = ext.getAttribute('href')
      if (href) window.open(href, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className={editable ? 'lore-editor' : 'lore-editor is-reading'}>
      {editable && (
        <div className="editor-toolbar">
          <Btn title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></Btn>
          <Btn title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></Btn>
          <Btn title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></Btn>
          <span className="tb-sep" />
          <Btn title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Btn>
          <Btn title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Btn>
          <Btn title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Btn>
          <span className="tb-sep" />
          <Btn title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Btn>
          <Btn title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Btn>
          <Btn title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</Btn>
          <Btn title="Divider" onClick={() => editor.chain().focus().setHorizontalRule().run()}>―</Btn>
          <Btn title="Insert image" onClick={() => fileInput.current?.click()}>🖼</Btn>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={pickImage}
          />
          <Btn title="Link (external URL)" active={editor.isActive('link')} onClick={openLinkBox}>🔗</Btn>
          <Btn title="Insert citation" active={!!cite} onClick={openCite}>❝¹</Btn>
          {!!starterSections?.length && (
            <Btn
              title="Insert this page type's starter sections"
              onClick={() => editor.chain().focus().insertContent(sectionNodes(starterSections)).run()}
            >＋ Sections</Btn>
          )}
          <span className="tb-sep" />
          <Btn title="Insert table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>⊞</Btn>
          {editor.isActive('table') && (<>
            <Btn title="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>+Row</Btn>
            <Btn title="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>−Row</Btn>
            <Btn title="Add column after" onClick={() => editor.chain().focus().addColumnAfter().run()}>+Col</Btn>
            <Btn title="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>−Col</Btn>
            <Btn title="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>⌫ Tbl</Btn>
          </>)}
          <span className="tb-spacer" />
          <span className="tb-hint">Type [[Name]] or @Name to link a page</span>
        </div>
      )}
      {editable && showLinkBox && (
        <div className="link-popover">
          <input
            autoFocus
            type="text"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink() }
              if (e.key === 'Escape') { setShowLinkBox(false); setLinkUrl('') }
            }}
          />
          <Btn title="Apply link" onClick={applyLink}>Apply</Btn>
          {editor.isActive('link') && (
            <Btn title="Remove link" onClick={removeLink}>Remove</Btn>
          )}
        </div>
      )}
      {editable && cite && (
        <div className="cite-popover">
          <div className="cite-mode">
            <button
              type="button"
              className={`tb-btn${cite.mode === 'page' ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCite((c) => c && { ...c, mode: 'page' })}
            >Page</button>
            <button
              type="button"
              className={`tb-btn${cite.mode === 'text' ? ' is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setCite((c) => c && { ...c, mode: 'text' })}
            >Free text</button>
          </div>
          {cite.mode === 'page' ? (
            <label>
              Source page
              <input
                autoFocus
                type="text"
                placeholder="Page title…"
                value={cite.target}
                onChange={(e) => setCite((c) => c && { ...c, target: e.target.value })}
              />
              {cite.target.trim() && (
                <div className="cite-suggest">
                  {rankWikiTitles(pageTitles ?? [], cite.target).slice(0, 6).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className="wiki-suggest-item"
                      onMouseDown={(e) => { e.preventDefault(); setCite((c) => c && { ...c, target: t }) }}
                    >{t}</button>
                  ))}
                </div>
              )}
            </label>
          ) : (
            <label>
              Source
              <input
                autoFocus
                type="text"
                placeholder="e.g. The Oral Tradition of the Vale"
                value={cite.text}
                onChange={(e) => setCite((c) => c && { ...c, text: e.target.value })}
              />
            </label>
          )}
          <label>
            Locator
            <input
              type="text"
              placeholder="e.g. Ch. 3, p. 42"
              value={cite.locator}
              onChange={(e) => setCite((c) => c && { ...c, locator: e.target.value })}
            />
          </label>
          <label>
            Quote
            <textarea
              rows={2}
              placeholder="optional excerpt"
              value={cite.quote}
              onChange={(e) => setCite((c) => c && { ...c, quote: e.target.value })}
            />
          </label>
          <div className="cite-actions">
            <Btn title="Apply citation" onClick={applyCite}>Apply</Btn>
            <Btn title="Cancel" onClick={() => setCite(null)}>Cancel</Btn>
          </div>
        </div>
      )}
      <div
        onClick={handleClick}
        onMouseOver={(e) => {
          if (editable) return
          const anchor = (e.target as Element).closest('[data-wikilink]')
          if (!anchor) return
          const title = anchor.getAttribute('data-title')
          if (title) showWikiHover(title, anchor.getBoundingClientRect())
        }}
        onMouseOut={(e) => {
          if (editable) return
          const anchor = (e.target as Element).closest('[data-wikilink]')
          if (anchor) scheduleWikiHoverClose()
        }}
      >
        <EditorContent editor={editor} />
      </div>
      {suggestPos && (
        <div className="wiki-suggest" style={{ left: suggestPos.left, top: suggestPos.top }}>
          {items.map((title, i) => (
            <button
              key={title}
              type="button"
              className={`wiki-suggest-item${i === Math.min(suggest!.index, items.length - 1) ? ' active' : ''}`}
              // Keep editor focus/selection so acceptSuggestion's range stays valid.
              onMouseDown={(e) => { e.preventDefault(); acceptSuggestion(title) }}
              onMouseEnter={() => setSuggest((s) => s && { ...s, index: i })}
            >
              {title}
            </button>
          ))}
        </div>
      )}
      {editLinkPos && editLink && (
        <div className="wiki-link-edit" style={{ left: editLinkPos.left, top: editLinkPos.top }}>
          <label>
            Target
            <input
              autoFocus
              type="text"
              value={editLink.title}
              onChange={(e) => setEditLink((s) => s && { ...s, title: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyEditLink() }
                if (e.key === 'Escape') { e.preventDefault(); setEditLink(null) }
              }}
            />
          </label>
          <label>
            Display
            <input
              type="text"
              placeholder="(same as target)"
              value={editLink.display}
              onChange={(e) => setEditLink((s) => s && { ...s, display: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); applyEditLink() }
                if (e.key === 'Escape') { e.preventDefault(); setEditLink(null) }
              }}
            />
          </label>
          <Btn title="Apply" onClick={applyEditLink}>Apply</Btn>
        </div>
      )}
    </div>
  )
}
