import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, mapRepo, addBodyImage, defaultInfobox, STATUSES, categoryColor, statusColor, pageStatus, type Infobox as InfoboxType } from '../db'
import { usePage } from '../usePage'
import { useWikiLinkNavigation } from '../useWikiLinkNavigation'
import LoreEditor from '../components/LoreEditor'
import References from '../components/References'
import Infobox from '../components/Infobox'
import DraftInput from '../components/DraftInput'
import Backlinks from '../components/Backlinks'
import SceneAppearances from '../components/SceneAppearances'
import ImageGallery from '../components/ImageGallery'
import TableOfContents from '../components/TableOfContents'
import DocumentLinks from '../components/DocumentLinks'
import ConfirmDialog from '../components/ConfirmDialog'
import { maybeTakeSnapshot } from '../snapshots'
import Breadcrumb from '../components/Breadcrumb'
import { recordRecent } from '../recents'
import { getSettings } from '../settings'
import { flushableDebounce } from '../debounce'

// Editor content is written on every keystroke; collapse a burst of typing into
// one IndexedDB write per idle pause. Flushed on blur / Done / page switch /
// unmount so at most this much typing is ever unsaved.
const CONTENT_WRITE_DELAY_MS = 500

export default function PageRoute() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { page, templates, update, rename, addTag, removeTag, changeCategory, remove } = usePage(id)
  const wiki = useWikiLinkNavigation()

  const [editing, setEditing] = useState(false)
  // Debounced content writer. The page id travels in the call args so a flush
  // that lands after navigation still targets the page that was being edited
  // (PageRoute itself stays mounted across page switches — only the id changes).
  const [contentWriter] = useState(() =>
    flushableDebounce<[string, string]>((pageId, html) => {
      void pageRepo.update(pageId, { content: html })
    }, CONTENT_WRITE_DELAY_MS),
  )
  const [tagInput, setTagInput] = useState('')
  const [titleDraft, setTitleDraft] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)

  // Marker → reference: scroll the matching <li> into view (ids set in References).
  function scrollToReference(index: number) {
    document.getElementById(`cite-ref-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
  // Reference → marker: scroll the nth citation marker in the body into view.
  function scrollToMarker(index: number) {
    const marks = mainRef.current?.querySelectorAll('sup[data-citation]')
    marks?.[index]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  // Every page title, read from the `title` index only — no record hydration, so
  // typing on a page doesn't re-pull every other page's content + image bytes on
  // each keystroke's liveQuery invalidation. Both derived views come from this.
  const allTitles = useLiveQuery(() => pageRepo.titles(), [])

  // Lowercased titles of all existing pages — drives broken-link styling.
  const knownTitles = useMemo(
    () => (allTitles ? new Set(allTitles.map((t) => t.trim().toLowerCase())) : undefined),
    [allTitles],
  )

  // Canonical titles of every OTHER page — the autolinker's vocabulary. Titles are
  // unique (renames reject clashes), so excluding this page's title == the
  // self-link skip the old id-based filter did.
  const autolinkTitles = useMemo(
    () => allTitles?.filter((t) => t !== page?.title),
    [allTitles, page?.title],
  )
  // Global per-world toggle (default on when settings haven't loaded yet).
  const settings = useLiveQuery(() => getSettings(), [])
  const autolinkEnabled = settings?.autolinkEnabled ?? true

  // Pins that link to this page, with their map names — drives the "Location"
  // block. pageId is indexed, so the where() is cheap.
  const pinLocations = useLiveQuery(async () => {
    const linking = await mapRepo.listPinsForPage(id)
    if (linking.length === 0) return []
    const mapName = new Map((await mapRepo.listMaps()).map((m) => [m.id, m.name]))
    return linking.map((p) => ({
      pinId: p.id,
      label: p.label,
      mapName: mapName.get(p.mapId) ?? 'Map',
    }))
  }, [id]) ?? []

  // Record this page in the per-world "recently viewed" list once it has loaded.
  useEffect(() => {
    if (page?.id === id && id) recordRecent(id)
  }, [page?.id, id])

  // Flush any pending content write when leaving the page or the route. The
  // cleanup runs before this effect re-runs for a new id (and on unmount), while
  // the writer's pending args still hold the outgoing page's id.
  useEffect(() => () => contentWriter.flush(), [id, contentWriter])

  // Start in view mode whenever you open a different page. Resetting during
  // render (rather than in an effect) avoids a flash of the previous page's
  // edit state — see react.dev "You Might Not Need an Effect".
  const [prevId, setPrevId] = useState(id)
  if (id !== prevId) {
    setPrevId(id)
    setEditing(false)
    setTitleDraft(null)
  }

  if (page === undefined) return <div className="content-pad">Loading…</div>
  if (page === null) return <div className="content-pad">This page doesn’t exist (it may have been deleted).</div>
  // The live query can briefly return the PREVIOUS page's data right after you
  // navigate. Wait until the loaded page actually matches the URL, otherwise the
  // editor would mount with stale content and keep it (see key={id} below).
  if (page.id !== id) return <div className="content-pad">Loading…</div>

  async function commitTitle() {
    if (titleDraft === null) return
    const next = titleDraft.trim()
    setTitleDraft(null)
    if (!next || next === page!.title) return
    try {
      await rename(next)
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : 'Could not rename the page.')
    }
  }

  // Commit the tag input: add it (the hook guards empty/duplicate), then clear.
  async function commitTag() {
    await addTag(tagInput)
    setTagInput('')
  }

  async function handleDelete() {
    setConfirmDelete(false)
    await remove()
    navigate('/home')
  }

  const typeIcon = templates.find((t) => t.name === page.category)?.icon

  return (
    <div className="page-view" style={{ '--type-color': categoryColor(page.category) } as CSSProperties}>
      <header className="page-header">
        <Breadcrumb category={page.category} title={page.title} color={categoryColor(page.category)} />
        <div className="page-header-row">
          <div className="page-title-wrap">
            {typeIcon && (
              <span className="page-type-glyph" aria-hidden="true">
                {typeIcon}
              </span>
            )}
            {editing ? (
              <input
                className="title-input"
                value={titleDraft ?? page.title}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder="Page title"
              />
            ) : (
              <h1 className="page-title">{page.title}</h1>
            )}
          </div>
          <div className="page-header-actions">
            <button
              className="ghost-btn"
              onClick={() => {
                if (editing) {
                  contentWriter.flush()
                  commitTitle()
                  maybeTakeSnapshot()
                }
                setEditing((v) => !v)
              }}
            >
              {editing ? '✓ Done' : '✎ Edit'}
            </button>
            <button className="ghost-btn danger" onClick={() => setConfirmDelete(true)}>🗑</button>
          </div>
        </div>

        <div className="page-meta">
          {editing ? (
            <select
              className="category-select"
              value={page.category}
              onChange={(e) => changeCategory(e.target.value)}
            >
              {/* Keep the current type listed even if it was renamed/removed. */}
              {!templates.some((t) => t.name === page.category) && (
                <option value={page.category}>{page.category}</option>
              )}
              {templates.map((t) => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          ) : (
            <span className="category-badge" style={{ background: categoryColor(page.category) }}>
              {page.category}
            </span>
          )}

          {editing ? (
            <select
              className="category-select"
              value={pageStatus(page)}
              onChange={(e) => update({ status: e.target.value })}
            >
              {STATUSES.map((s) => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
          ) : (
            <span className="status-badge" style={{ borderColor: statusColor(pageStatus(page)), color: statusColor(pageStatus(page)) }}>
              {pageStatus(page)}
            </span>
          )}

          {editing ? (
            <DraftInput
              className="summary-input"
              value={page.summary}
              onCommit={(v) => update({ summary: v })}
              placeholder="One-line summary…"
            />
          ) : (
            page.summary && <span className="summary-text">{page.summary}</span>
          )}
        </div>

        <div className="tags-row">
          {page.tags.map((t) =>
            editing ? (
              <span key={t} className="tag">
                #{t}
                <button className="tag-x" onClick={() => removeTag(t)}>×</button>
              </span>
            ) : (
              <Link key={t} to={`/tag/${encodeURIComponent(t)}`} className="tag">
                #{t}
              </Link>
            ),
          )}
          {editing && (
            <input
              className="tag-input"
              placeholder="add tag…"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && commitTag()}
              onBlur={commitTag}
            />
          )}
        </div>
      </header>

      <div className="page-body">
        <div className="page-main" ref={mainRef}>
          <LoreEditor
            key={id}
            content={page.content}
            editable={editing}
            onChange={(html) => contentWriter.call(id, html)}
            onBlur={() => contentWriter.flush()}
            onInsertImage={(dataUrl) => addBodyImage(id, dataUrl)}
            onWikiClick={wiki.follow}
            onCitationClick={scrollToReference}
            knownTitles={knownTitles}
            autolinkTitles={autolinkTitles}
            autolinkEnabled={autolinkEnabled}
            starterSections={templates.find((t) => t.name === page.category)?.sections}
          />
          <ImageGallery page={page} editable={editing} />
          <References
            content={page.content}
            knownTitles={knownTitles}
            onWikiClick={wiki.follow}
            onBackref={scrollToMarker}
          />
          <DocumentLinks page={page} editable={editing} />
        </div>

        <div className="page-aside">
          <TableOfContents containerRef={mainRef} pageId={page.id} />
          {page.infobox ? (
            <Infobox
              box={page.infobox}
              editable={editing}
              title={page.title}
              accent={categoryColor(page.category)}
              onChange={(box: InfoboxType) => update({ infobox: box })}
              onRemove={() => update({ infobox: undefined })}
              onWikiClick={wiki.follow}
              knownTitles={knownTitles}
            />
          ) : (
            editing && (
              <button
                className="ghost-btn add-infobox-btn"
                onClick={async () => update({ infobox: await defaultInfobox(page.category) })}
              >
                ＋ Add infobox
              </button>
            )
          )}

          {!editing && pinLocations.length > 0 && (
            <div className="page-locations">
              <div className="page-locations-head">On the map</div>
              {pinLocations.map((loc) => (
                <button
                  key={loc.pinId}
                  className="ghost-btn location-row"
                  onClick={() => navigate(`/map?pin=${loc.pinId}`)}
                  title="Show this pin on the map"
                >
                  📍 {pinLocations.length > 1 ? `${loc.mapName} — ${loc.label || 'Pin'}` : 'Show on map'}
                </button>
              ))}
            </div>
          )}

          <Backlinks pageId={id} />
          <SceneAppearances pageId={id} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete page?"
        confirmLabel="Delete"
        danger
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      >
        Delete “{page.title}”? This cannot be undone.
      </ConfirmDialog>

      <ConfirmDialog
        open={wiki.pendingTitle !== null}
        title="Create page?"
        confirmLabel="Create"
        onConfirm={wiki.confirmCreate}
        onCancel={wiki.cancelCreate}
      >
        “{wiki.pendingTitle}” doesn’t exist yet. Create it?
      </ConfirmDialog>

      <ConfirmDialog
        open={renameError !== null}
        title="Couldn’t rename page"
        confirmLabel="OK"
        hideCancel
        onConfirm={() => setRenameError(null)}
        onCancel={() => setRenameError(null)}
      >
        {renameError}
      </ConfirmDialog>
    </div>
  )
}
