import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { searchAll, highlightSnippet, type SearchResult } from '../search'
import { resultHref } from '../searchEntries'
import { db, pageRepo, categoryColor, type LorePage } from '../db'
import { getRecent } from '../recents'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'

interface Props {
  onClose: () => void
}

/** A selectable row: a multi-kind search hit (page/event/pin/region/scene), or
 *  the trailing "create this page" action offered when nothing matches the
 *  query exactly. */
type Row = SearchResult | { kind: 'create'; title: string }

const NO_PAGES: LorePage[] = []

const BADGE: Record<SearchResult['kind'], string> = {
  page: 'Page', event: 'Event', pin: 'Pin', region: 'Region', scene: 'Scene',
}

export default function SearchModal({ onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards the create row against double-activation (Enter auto-repeat /
  // double-click) while the async create is in flight.
  const creating = useRef(false)

  const q = query.trim()
  const results = useMemo(() => searchAll(query), [query])

  // Recently-viewed pages for the empty-query state. bulkGet keeps the stored
  // order; ids of since-deleted pages come back undefined and are dropped.
  const recent =
    useLiveQuery(async () => {
      const ids = getRecent()
      if (ids.length === 0) return NO_PAGES
      const pages = await db.pages.bulkGet(ids)
      return pages.filter((p): p is LorePage => p != null)
    }, []) ?? NO_PAGES

  // All pages, for the exact-title check deciding whether to offer "create".
  const allPages = useLiveQuery(() => pageRepo.listByTitle(), []) ?? NO_PAGES
  const titleExists = useMemo(
    () => allPages.some((p) => p.title.trim().toLowerCase() === q.toLowerCase()),
    [allPages, q],
  )

  const rows = useMemo<Row[]>(() => {
    if (!q) {
      return recent.map((p): Row => ({
        kind: 'page', id: p.id, title: p.title, category: p.category, snippet: '',
      }))
    }
    // Copy — `results` is memoized on [query] alone, so pushing onto it
    // directly would mutate that memo and leak a stale "create" row into
    // later renders (e.g. once titleExists flips true after allPages loads).
    const pageRows: Row[] = [...results]
    if (!titleExists) pageRows.push({ kind: 'create', title: q })
    return pageRows
  }, [q, results, recent, titleExists])

  // Reset the highlighted row whenever the query changes. Adjusting state during
  // render (rather than in an effect) avoids a redundant re-render — see
  // react.dev "You Might Not Need an Effect".
  const [prevQuery, setPrevQuery] = useState(query)
  if (query !== prevQuery) {
    setPrevQuery(query)
    setSelected(0)
  }

  useEffect(() => { inputRef.current?.focus() }, [])

  function go(row: SearchResult) {
    navigate(resultHref(row))
    onClose()
  }

  async function activate(row: Row) {
    if (row.kind === 'create') {
      if (creating.current) return
      creating.current = true
      try {
        const id = await pageRepo.create({ title: row.title })
        navigate(`/page/${id}`)
        onClose()
      } catch {
        // Title clash — a page with this name already exists (e.g. the page
        // list hadn't loaded yet when the row was offered). Go there instead.
        const existing = await pageRepo.findIdByTitle(row.title)
        if (existing) { navigate(`/page/${existing}`); onClose() }
      } finally {
        creating.current = false
      }
      return
    }
    go(row)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((s) => Math.min(s + 1, rows.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && rows[selected]) void activate(rows[selected])
  }

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="search-modal-input"
          placeholder="Search your world…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKey}
        />
        {!q && rows.length > 0 && <div className="search-section-label">Recently viewed</div>}
        {rows.length > 0 && (
          <div className="search-results">
            {rows.map((row, i) => {
              if (row.kind === 'create') {
                return (
                  <div
                    key="__create__"
                    className={`search-result search-create${i === selected ? ' is-selected' : ''}`}
                    onClick={() => void activate(row)}
                    onMouseEnter={() => setSelected(i)}
                  >
                    ＋ Create page "{row.title}"
                  </div>
                )
              }
              const isPage = row.kind === 'page'
              return (
                <a
                  key={`${row.kind}:${row.id}`}
                  href={resultHref(row)}
                  className={`search-result${i === selected ? ' is-selected' : ''}`}
                  onClick={(e) => { e.preventDefault(); go(row) }}
                  onMouseEnter={(e) => {
                    setSelected(i)
                    if (isPage) showPageHover(row.id, row.title, e.currentTarget.getBoundingClientRect())
                  }}
                  onMouseLeave={isPage ? scheduleWikiHoverClose : undefined}
                >
                  <div className="search-result-title">
                    {isPage ? (
                      <span className="search-result-dot" style={{ background: categoryColor(row.category) }} />
                    ) : (
                      <span className="search-result-badge">{BADGE[row.kind]}</span>
                    )}
                    {row.title}
                    {!isPage && row.subtitle && (
                      <span className="search-result-subtitle">{row.subtitle}</span>
                    )}
                  </div>
                  {row.snippet && (
                    <div
                      className="search-result-snippet"
                      dangerouslySetInnerHTML={{ __html: highlightSnippet(row.snippet, query) }}
                    />
                  )}
                </a>
              )
            })}
          </div>
        )}
        {q && rows.length === 0 && (
          <div className="search-empty">No results for "{query}"</div>
        )}
      </div>
    </div>
  )
}
