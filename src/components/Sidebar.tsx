import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, pageRepo, categoryColor, statusColor, pageStatus, type LorePage } from '../db'
import { getLore, currentLoreId } from '../lores'
import { pickRandomId } from '../rediscovery'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'
import { getRecent, pruneRecent, subscribeRecents } from '../recents'
import { getCollapsedGroups, toggleCollapsedGroup, RECENT_GROUP, TAGS_GROUP } from '../sidebarPrefs'
import { tagCounts } from '../tags'

// Stable empty array so the live queries don't hand `useMemo` a fresh `[]`
// (and force a recompute) on every render while data is still loading.
const NO_PAGES: LorePage[] = []

function PageLink({ page, active }: { page: LorePage; active: boolean }) {
  return (
    <Link
      to={`/page/${page.id}`}
      className={active ? 'page-link active' : 'page-link'}
      onMouseEnter={(e) => showPageHover(page.id, page.title, e.currentTarget.getBoundingClientRect())}
      onMouseLeave={scheduleWikiHoverClose}
    >
      <span className="dot" style={{ background: categoryColor(page.category) }} />
      <span className="page-link-title">{page.title}</span>
      <span className="status-pip" title={pageStatus(page)} style={{ background: statusColor(pageStatus(page)) }} />
    </Link>
  )
}

export default function Sidebar({ onOpenSearch }: { onOpenSearch: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()

  const pages = useLiveQuery(() => pageRepo.listByTitle(), []) ?? NO_PAGES
  const templates = useLiveQuery(() => db.templates.toArray(), []) ?? []
  const activeLore = useLiveQuery(() => getLore(currentLoreId()), [])
  const loreName = activeLore?.name ?? 'Lore Codex'

  const [loreId] = useState(currentLoreId)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(getCollapsedGroups(loreId)))
  // Recent ids live in state, refreshed by the recents bus, so the list updates
  // the moment a page is viewed (visiting a page doesn't touch the `pages` query).
  const [recentIds, setRecentIds] = useState<string[]>(() => getRecent(loreId))
  useEffect(() => subscribeRecents(() => setRecentIds(getRecent(loreId))), [loreId])
  const toggle = (name: string) => setCollapsed(new Set(toggleCollapsedGroup(name, loreId)))

  // Group all pages by category.
  const grouped = useMemo(() => {
    const map = new Map<string, typeof pages>()
    for (const p of pages) {
      const list = map.get(p.category) ?? []
      list.push(p)
      map.set(p.category, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [pages])

  const tags = useMemo(() => tagCounts(pages), [pages])

  // Resolve per-world recent ids to live page records; drop any that were deleted.
  const recentPages = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]))
    return recentIds.filter((id) => byId.has(id)).map((id) => byId.get(id)!)
  }, [pages, recentIds])

  // Prune ids of deleted pages from storage (side-effect kept out of the memo).
  useEffect(() => {
    pruneRecent(new Set(pages.map((p) => p.id)), loreId)
  }, [pages, loreId])

  async function handleNew() {
    const id = await pageRepo.create()
    navigate(`/page/${id}`)
  }

  const currentId = location.pathname.startsWith('/page/')
    ? location.pathname.split('/page/')[1]
    : null

  function handleRandom() {
    const ids = pages.map((p) => p.id).filter((id) => id !== currentId)
    const id = pickRandomId(ids)
    if (id) navigate(`/page/${id}`)
  }

  const browseCategory = location.pathname.startsWith('/browse/')
    ? decodeURIComponent(location.pathname.split('/browse/')[1])
    : null

  const currentTag = location.pathname.startsWith('/tag/')
    ? decodeURIComponent(location.pathname.split('/tag/')[1])
    : null

  return (
    <aside className="sidebar">
      <div className="brand">
        <Link to="/" className="brand-link" title="Switch world">
          {loreName} ⇄
        </Link>
      </div>

      <nav className="top-nav">
        <Link to="/home" className={location.pathname === '/home' ? 'nav-item active' : 'nav-item'}>Home</Link>
        <Link to="/map" className={location.pathname.startsWith('/map') ? 'nav-item active' : 'nav-item'}>Maps</Link>
        <Link to="/graph" className={location.pathname.startsWith('/graph') ? 'nav-item active' : 'nav-item'}>Graph</Link>
        <Link to="/timeline" className={location.pathname.startsWith('/timeline') ? 'nav-item active' : 'nav-item'}>Timeline</Link>
        <Link to="/manuscript" className={location.pathname.startsWith('/manuscript') || location.pathname.startsWith('/book/') ? 'nav-item active' : 'nav-item'}>Manuscript</Link>
        <Link to="/templates" className={location.pathname.startsWith('/templates') ? 'nav-item active' : 'nav-item'}>Templates</Link>
        <Link to="/settings" className={location.pathname.startsWith('/settings') ? 'nav-item active' : 'nav-item'}>Settings</Link>
      </nav>

      <div className="sidebar-actions">
        <button className="primary-btn" onClick={handleNew}>+ New page</button>
        <button
          className="ghost-btn sidebar-random"
          onClick={handleRandom}
          disabled={pages.length === 0}
        >🎲 Random page</button>
      </div>

      <div className="search-box-wrap">
        <input
          className="search-box"
          placeholder="Search lore…"
          readOnly
          onFocus={onOpenSearch}
          onClick={onOpenSearch}
        />
        <kbd className="search-kbd">Ctrl K</kbd>
      </div>

      <div className="page-list">
        {recentPages.length > 0 && (
          <div className="page-group">
            <div className="group-head">
              <button
                className="group-toggle"
                aria-expanded={!collapsed.has(RECENT_GROUP)}
                onClick={() => toggle(RECENT_GROUP)}
              >
                <span className={collapsed.has(RECENT_GROUP) ? 'chev' : 'chev chev--open'}>▸</span>
              </button>
              <span className="group-label group-label-static">Recent</span>
            </div>
            {!collapsed.has(RECENT_GROUP) &&
              recentPages.map((p) => (
                <PageLink key={p.id} page={p} active={p.id === currentId} />
              ))}
          </div>
        )}

        {grouped.length === 0 && <p className="empty-hint">No pages yet. Create your first one!</p>}
        {grouped.map(([category, items]) => (
          <div key={category} className="page-group">
            <div className="group-head">
              <button
                className="group-toggle"
                aria-expanded={!collapsed.has(category)}
                onClick={() => toggle(category)}
              >
                <span className={collapsed.has(category) ? 'chev' : 'chev chev--open'}>▸</span>
              </button>
              <Link
                to={`/browse/${encodeURIComponent(category)}`}
                className={`group-label${browseCategory === category ? ' active' : ''}`}
                style={{ color: categoryColor(category) }}
              >
                {category} <span className="group-count">{items.length}</span>
              </Link>
            </div>
            {!collapsed.has(category) &&
              items.map((p) => (
                <PageLink key={p.id} page={p} active={p.id === currentId} />
              ))}
          </div>
        ))}

        {tags.length > 0 && (
          <div className="page-group">
            <div className="group-head">
              <button
                className="group-toggle"
                aria-expanded={!collapsed.has(TAGS_GROUP)}
                onClick={() => toggle(TAGS_GROUP)}
              >
                <span className={collapsed.has(TAGS_GROUP) ? 'chev' : 'chev chev--open'}>▸</span>
              </button>
              <span className="group-label group-label-static">Tags</span>
            </div>
            {!collapsed.has(TAGS_GROUP) &&
              tags.map(({ tag, count }) => (
                <Link
                  key={tag}
                  to={`/tag/${encodeURIComponent(tag)}`}
                  className={currentTag === tag ? 'tag-link active' : 'tag-link'}
                >
                  <span className="tag-link-name">#{tag}</span>
                  <span className="group-count">{count}</span>
                </Link>
              ))}
          </div>
        )}
      </div>

      <div className="sidebar-footer">
        {templates.length} types · {pages.length} pages
      </div>
    </aside>
  )
}
