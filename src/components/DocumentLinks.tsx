import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  pageRepo, getAttachedDocuments, getDocumentAttachedTo,
  attachDocument, detachDocument, reorderAttachedDocuments,
  categoryColor, type LorePage,
} from '../db'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'

interface Props {
  page: LorePage
  editable: boolean
}

/** The "Documents" section below a page body: a curated, drag-ordered list of
 *  attached Document-type pages. On a document, a reciprocal "Attached to" list
 *  shows the pages it's attached to. Hidden entirely in view mode when there is
 *  nothing to show. */
export default function DocumentLinks({ page, editable }: Props) {
  const attached = useLiveQuery(() => getAttachedDocuments(page.id), [page.id]) ?? []
  const attachedTo = useLiveQuery(() => getDocumentAttachedTo(page.id), [page.id]) ?? []

  if (!editable && attached.length === 0 && attachedTo.length === 0) return null

  return (
    <section className="doc-links">
      {(editable || attached.length > 0) && (
        <DocumentsPanel page={page} attached={attached} editable={editable} />
      )}
      {attachedTo.length > 0 && (
        <AttachedToPanel page={page} attachedTo={attachedTo} editable={editable} />
      )}
    </section>
  )
}

/** A single row: type dot + title link with hover preview. */
function DocRow({ id, title, category }: { id: string; title: string; category: string }) {
  return (
    <Link
      to={`/page/${id}`}
      className="doc-link"
      onMouseEnter={(e) => showPageHover(id, title, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={scheduleWikiHoverClose}
    >
      <span className="dot" style={{ background: categoryColor(category) }} />
      {title}
    </Link>
  )
}

/** Owning side: documents attached to this page (drag-orderable in edit mode). */
function DocumentsPanel({
  page, attached, editable,
}: {
  page: LorePage
  attached: { link: { documentId: string }; page: LorePage }[]
  editable: boolean
}) {
  const [dragId, setDragId] = useState<string | null>(null)

  async function onDropRow(targetDocId: string) {
    if (!dragId || dragId === targetDocId) { setDragId(null); return }
    const ids = attached.map((a) => a.page.id)
    const from = ids.indexOf(dragId)
    const to = ids.indexOf(targetDocId)
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setDragId(null)
    await reorderAttachedDocuments(page.id, ids)
  }

  return (
    <div className="doc-links-panel">
      <h2 className="doc-links-heading">Documents</h2>
      <ul className="doc-links-list">
        {attached.map((a) => (
          <li
            key={a.page.id}
            className="doc-links-row"
            draggable={editable}
            onDragStart={() => editable && setDragId(a.page.id)}
            onDragOver={(e) => { if (editable) e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); if (editable) onDropRow(a.page.id) }}
          >
            <DocRow id={a.page.id} title={a.page.title} category={a.page.category} />
            {editable && (
              <button
                className="tag-x"
                title="Remove attachment"
                onClick={() => detachDocument(page.id, a.page.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <DocPicker
          category="Document"
          placeholder="Attach a document…"
          excludeIds={new Set([page.id, ...attached.map((a) => a.page.id)])}
          onPick={(docId) => attachDocument(page.id, docId)}
        />
      )}
    </div>
  )
}

/** Reciprocal side: the pages this document is attached to. Attach this document
 *  to any-type target pages from here. Ordered by title, no drag-reorder. */
function AttachedToPanel({
  page, attachedTo, editable,
}: {
  page: LorePage
  attachedTo: { page: LorePage }[]
  editable: boolean
}) {
  return (
    <div className="doc-links-panel">
      <h2 className="doc-links-heading">Attached to</h2>
      <ul className="doc-links-list">
        {attachedTo.map((a) => (
          <li key={a.page.id} className="doc-links-row">
            <DocRow id={a.page.id} title={a.page.title} category={a.page.category} />
            {editable && (
              <button
                className="tag-x"
                title="Remove attachment"
                onClick={() => detachDocument(a.page.id, page.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && (
        <DocPicker
          placeholder="Attach this document to a page…"
          excludeIds={new Set([page.id, ...attachedTo.map((a) => a.page.id)])}
          onPick={(targetPageId) => attachDocument(targetPageId, page.id)}
        />
      )}
    </div>
  )
}

/** A search box offering pages (optionally of one category), excluding a set of
 *  ids, that calls onPick with the chosen page id. Reuses RefField's markup. */
function DocPicker({
  category, placeholder, excludeIds, onPick,
}: {
  category?: string
  placeholder: string
  excludeIds: Set<string>
  onPick: (pageId: string) => void
}) {
  const [query, setQuery] = useState('')
  const candidates = useLiveQuery(
    () => (category ? pageRepo.listByCategory(category) : pageRepo.list()),
    [category],
  ) ?? []

  const q = query.trim().toLowerCase()
  const matches = q
    ? candidates
        .filter((p) => !excludeIds.has(p.id) && p.title.toLowerCase().includes(q))
        .slice(0, 8)
    : []

  return (
    <div className="ref-search doc-picker">
      <input
        className="infobox-value-input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {q && matches.length > 0 && (
        <div className="ref-results">
          {matches.map((p) => (
            <button
              key={p.id}
              className="ref-result"
              onClick={() => { onPick(p.id); setQuery('') }}
            >
              <span className="dot" style={{ background: categoryColor(p.category) }} />
              {p.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
