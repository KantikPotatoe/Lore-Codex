import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  pageRepo,
  mapRepo,
  getMeta,
  setMeta,
  categoryColor,
  statusColor,
  pageStatus,
  STATUSES,
  type LorePage,
  type TimelineEvent,
} from '../db'
import { selectStalePages, staleLabel, pickFeaturedEvent, todayIndex } from '../rediscovery'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import { getLore, renameLore, setLoreBanner, currentLoreId } from '../lores'
import { compressImage } from '../imageUtils'
import { formatDate } from '../calendar'
import { stripHtml } from '../html'

/** Personalisable bits of the home page, stored as one row in the meta table. */
interface HomeConfig {
  // title removed — now stored in the lore registry
  tagline: string
  about: string
  showAbout: boolean
  showOverview: boolean
  showRecent: boolean
  showDusty: boolean
  showOnThisDay: boolean
}

/** Stable empty array so the live query doesn't feed `useMemo` a fresh `[]`
 *  (forcing a recompute) on every render while pages are still loading. */
const NO_PAGES: LorePage[] = []
const NO_EVENTS: TimelineEvent[] = []

const HOME_CONFIG_KEY = 'home-config'
const DEFAULT_HOME: HomeConfig = {
  tagline: 'Write, link, and map the lore of everything you create.',
  about: '',
  showAbout: true,
  showOverview: true,
  showRecent: true,
  showDusty: true,
  showOnThisDay: true,
}

export default function HomeRoute() {
  const navigate = useNavigate()
  const bannerFileRef = useRef<HTMLInputElement>(null)
  const [customizing, setCustomizing] = useState(false)
  const [loreNameDraft, setLoreNameDraft] = useState<string | null>(null)
  // In-app acknowledgement — host alert() is unreliable in the shell's webview.
  const [notice, setNotice] = useState<string | null>(null)

  const activeLoreId = currentLoreId()
  const activeLore = useLiveQuery(() => getLore(activeLoreId), [])

  // Home config lives in the meta table. We load it once into local state and
  // treat that as the source of truth while editing — merging each change onto
  // the async live-query value directly would let rapid edits to different
  // fields clobber one another.
  const savedConfig = useLiveQuery(() => getMeta<Partial<HomeConfig>>(HOME_CONFIG_KEY), [])
  const [draft, setDraft] = useState<HomeConfig | null>(null)
  // Initialise the draft from the saved config the first time it loads. Adjusting
  // state during render (instead of in an effect) is React's recommended pattern
  // for deriving state from an async/changing input.
  if (savedConfig !== undefined && draft === null) {
    setDraft({ ...DEFAULT_HOME, ...(savedConfig ?? {}) })
  }
  const cfg: HomeConfig = draft ?? { ...DEFAULT_HOME, ...(savedConfig ?? {}) }

  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES
  const recent = useLiveQuery(() => pageRepo.listRecent(8), []) ?? []
  const mapCount = useLiveQuery(() => mapRepo.countMaps(), []) ?? 0
  const dusty = useMemo(() => selectStalePages(pages), [pages])
  const events = useLiveQuery(() => db.events.toArray(), []) ?? NO_EVENTS
  const featured = useMemo(() => pickFeaturedEvent(events, todayIndex()), [events])
  const featuredCal = useLiveQuery(
    () => (featured ? db.calendars.get(featured.calendarId) : undefined),
    [featured?.calendarId],
  )

  // -- overview figures -----------------------------------------------------
  const total = pages.length
  const byType = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pages) m.set(p.category, (m.get(p.category) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [pages])
  const byStatus = useMemo(
    () => STATUSES.map((s) => ({ ...s, count: pages.filter((p) => pageStatus(p) === s.name).length })),
    [pages],
  )
  const completePct = total ? Math.round((byStatus.find((s) => s.name === 'Complete')!.count / total) * 100) : 0

  // Persist whenever the draft changes (functional update keeps merges correct
  // even across fast successive edits to different fields).
  useEffect(() => {
    if (draft) setMeta(HOME_CONFIG_KEY, draft)
  }, [draft])
  function saveConfig(patch: Partial<HomeConfig>) {
    setDraft((prev) => ({ ...(prev ?? { ...DEFAULT_HOME, ...(savedConfig ?? {}) }), ...patch }))
  }

  async function commitLoreName() {
    if (loreNameDraft !== null) {
      await renameLore(activeLoreId, loreNameDraft)
      setLoreNameDraft(null)
    }
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await compressImage(file, 1600)
    await setLoreBanner(activeLoreId, dataUrl)
    e.target.value = ''
  }

  async function handleNew() {
    const id = await pageRepo.create()
    navigate(`/page/${id}`)
  }

  return (
    <div className="home">
      <div
        className="home-hero"
        style={activeLore?.banner ? {
          backgroundImage: `url(${activeLore.banner})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        } : undefined}
      >
        {customizing ? (
          <>
            <input
              className="home-title-input"
              value={loreNameDraft ?? activeLore?.name ?? ''}
              onChange={(e) => setLoreNameDraft(e.target.value)}
              onBlur={commitLoreName}
              onKeyDown={(e) => { if (e.key === 'Enter') commitLoreName() }}
              placeholder="World name"
            />
            <input
              className="home-tagline-input"
              value={cfg.tagline}
              onChange={(e) => saveConfig({ tagline: e.target.value })}
              placeholder="A short tagline…"
            />
          </>
        ) : (
          <>
            <h1>{activeLore?.name || 'My World'}</h1>
            {cfg.tagline && <p>{cfg.tagline}</p>}
          </>
        )}

        <div className="home-cta">
          <button className="primary-btn" onClick={handleNew}>+ New page</button>
          <Link to="/map" className="ghost-btn">Open maps</Link>
          <button className={customizing ? 'ghost-btn active' : 'ghost-btn'} onClick={() => {
            if (customizing) commitLoreName()
            setCustomizing((v) => !v)
          }}>
            {customizing ? '✓ Done' : '✎ Customize'}
          </button>
        </div>

        {customizing && (
          <div className="home-customize">
            {/* Banner upload controls */}
            <div className="home-banner-controls">
              <button className="ghost-btn" onClick={() => bannerFileRef.current?.click()}>
                🖼 {activeLore?.banner ? 'Change banner' : 'Add banner image'}
              </button>
              {activeLore?.banner && (
                <button className="ghost-btn" onClick={async () => {
                  try {
                    await setLoreBanner(activeLoreId, null)
                  } catch {
                    setNotice('Failed to remove banner.')
                  }
                }}>
                  ✕ Remove banner
                </button>
              )}
              <input
                ref={bannerFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={handleBannerChange}
              />
            </div>

            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showAbout} onChange={(e) => saveConfig({ showAbout: e.target.checked })} />
              About this world
            </label>
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showOverview} onChange={(e) => saveConfig({ showOverview: e.target.checked })} />
              Overview
            </label>
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showRecent} onChange={(e) => saveConfig({ showRecent: e.target.checked })} />
              Recently edited
            </label>
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showDusty} onChange={(e) => saveConfig({ showDusty: e.target.checked })} />
              Dusty corners
            </label>
            <label className="home-toggle">
              <input type="checkbox" checked={cfg.showOnThisDay} onChange={(e) => saveConfig({ showOnThisDay: e.target.checked })} />
              On this day
            </label>
          </div>
        )}
      </div>

      {/* About this world */}
      {(cfg.showAbout && (cfg.about || customizing)) && (
        <section className="home-section">
          <h2>About this world</h2>
          {customizing ? (
            <textarea
              className="home-about-input"
              value={cfg.about}
              onChange={(e) => saveConfig({ about: e.target.value })}
              placeholder="Describe your world, its premise, the tone you're going for…"
              rows={4}
            />
          ) : (
            <p className="home-about">{cfg.about}</p>
          )}
        </section>
      )}

      {/* Overview */}
      {cfg.showOverview && (
        <section className="home-section">
          <h2>Overview</h2>
          <div className="overview-cards">
            <div className="ov-card"><span className="ov-num">{total}</span><span className="ov-label">pages</span></div>
            <div className="ov-card"><span className="ov-num">{byType.length}</span><span className="ov-label">types in use</span></div>
            <div className="ov-card"><span className="ov-num">{mapCount}</span><span className="ov-label">maps</span></div>
            <div className="ov-card"><span className="ov-num">{completePct}%</span><span className="ov-label">complete</span></div>
          </div>

          {total === 0 ? (
            <p className="empty-hint">Your overview fills in as you add pages.</p>
          ) : (
            <div className="overview-breakdowns">
              <div className="ov-block">
                <h3>By type</h3>
                <div className="type-chips">
                  {byType.map(([name, count]) => (
                    <span key={name} className="type-chip">
                      <span className="type-chip-dot" style={{ background: categoryColor(name) }} />
                      {name}
                      <span className="type-chip-count">{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="ov-block">
                <h3>By status</h3>
                <div className="status-bar">
                  {byStatus.filter((s) => s.count > 0).map((s) => (
                    <div
                      key={s.name}
                      className="status-seg"
                      title={`${s.name}: ${s.count}`}
                      style={{ flexGrow: s.count, background: s.color }}
                    />
                  ))}
                </div>
                <div className="status-legend">
                  {byStatus.map((s) => (
                    <span key={s.name} className="legend-item">
                      <span className="legend-dot" style={{ background: s.color }} />
                      {s.name} <span className="muted">{s.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Recently edited */}
      {cfg.showRecent && (
        <section className="home-section">
          {recent.length > 0 && <h2>Recently edited</h2>}
          {recent.length === 0 ? (
            <EmptyState
              icon="📜"
              title="Your world is unwritten"
              message="Every world begins with a single page. Create your first one to start building."
            >
              <button className="primary-btn" onClick={handleNew}>+ Create your first page</button>
            </EmptyState>
          ) : (
            <div className="card-grid">
              {recent.map((p) => (
                <Link key={p.id} to={`/page/${p.id}`} className="lore-card">
                  <div className="card-badges">
                    <span className="card-badge" style={{ background: categoryColor(p.category) }}>{p.category}</span>
                    <span className="status-badge" style={{ borderColor: statusColor(pageStatus(p)), color: statusColor(pageStatus(p)) }}>{pageStatus(p)}</span>
                  </div>
                  <h3>{p.title}</h3>
                  {p.summary && <p>{p.summary}</p>}
                </Link>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Dusty corners */}
      {cfg.showDusty && dusty.length > 0 && (
        <section className="home-section">
          <h2>Dusty corners</h2>
          <p className="home-section-sub">Pages you haven't touched in a while — revisit?</p>
          <div className="card-grid">
            {dusty.map((p) => (
              <Link key={p.id} to={`/page/${p.id}`} className="lore-card">
                <div className="card-badges">
                  <span className="card-badge" style={{ background: categoryColor(p.category) }}>{p.category}</span>
                  <span className="muted">{staleLabel(p.updatedAt)}</span>
                </div>
                <h3>{p.title}</h3>
                {p.summary && <p>{p.summary}</p>}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* On this day */}
      {cfg.showOnThisDay && featured && featuredCal && (
        <section className="home-section">
          <h2>On this day</h2>
          <Link
            className="on-this-day"
            to={featured.pageId ? `/page/${featured.pageId}` : '/timeline'}
          >
            {featured.icon && <span className="otd-icon">{featured.icon}</span>}
            <span className="otd-body">
              <span className="otd-title">{featured.title}</span>
              <span className="otd-date">
                {formatDate(featuredCal, featured.startYear, featured.startMonth, featured.startDay)}
              </span>
              {featured.description && (
                <span className="otd-snippet">{stripHtml(featured.description).slice(0, 160)}</span>
              )}
              <span className="otd-link">View on timeline →</span>
            </span>
          </Link>
        </section>
      )}

      <ConfirmDialog
        open={notice !== null}
        hideCancel
        title="Something went wrong"
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      >
        <p>{notice}</p>
      </ConfirmDialog>
    </div>
  )
}
