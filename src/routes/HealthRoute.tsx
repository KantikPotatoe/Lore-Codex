import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, categoryColor, computeWorldHealth, type LorePage } from '../db'
import ConfirmDialog from '../components/ConfirmDialog'

/** Stable empty array so the live query doesn't feed `useMemo` a fresh `[]`
 *  (forcing a recompute) on every render while pages are still loading. */
const NO_PAGES: LorePage[] = []

function PageList({ pages, empty }: { pages: LorePage[]; empty: string }) {
  if (pages.length === 0) return <p className="muted">{empty}</p>
  return (
    <ul className="health-list">
      {pages.map((p) => (
        <li key={p.id}>
          <Link to={`/page/${p.id}`}>
            <span className="dot" style={{ background: categoryColor(p.category) }} />
            <span className="t">{p.title}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export default function HealthRoute() {
  const navigate = useNavigate()
  // In-app acknowledgement — host alert() is unreliable in the shell's webview.
  const [notice, setNotice] = useState<string | null>(null)

  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES
  const health = useMemo(() => computeWorldHealth(pages), [pages])

  // Another tab (or a stale live query) may have created this page since the
  // broken-link list was computed. Resolve first and reuse it rather than
  // erroring on the title clash — the broken link is fixed either way. Mirrors
  // useWikiLinkNavigation's confirmCreate.
  async function handleCreate(title: string) {
    try {
      const id = (await pageRepo.findIdByTitle(title)) ?? (await pageRepo.create({ title, status: 'Stub' }))
      navigate(`/page/${id}`)
    } catch {
      setNotice(`Couldn't create “${title}”. Your browser may be out of storage space.`)
    }
  }

  return (
    <div className="health">
      <header className="health-header">
        <h1>World health</h1>
        <p className="health-sub">What's dangling, unreachable, or still unwritten.</p>
      </header>

      <section className="health-section">
        <h2>Broken links <span className="count">{health.brokenLinks.length}</span></h2>
        <p className="health-section-sub">Pages you've linked to but never wrote.</p>
        {health.brokenLinks.length === 0 ? (
          <p className="muted">Every link lands somewhere. 🎉</p>
        ) : (
          <ul className="health-list">
            {health.brokenLinks.map((b) => (
              <li key={b.title.toLowerCase()} className="health-broken">
                <span className="t">{b.title}</span>
                <span className="health-sources">
                  linked from{' '}
                  {b.sources.map((p, i) => (
                    <span key={p.id}>
                      {i > 0 && ', '}
                      <Link to={`/page/${p.id}`}>{p.title}</Link>
                    </span>
                  ))}
                </span>
                <button className="ghost-btn" onClick={() => handleCreate(b.title)}>
                  + Create
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="health-section">
        <h2>Orphans <span className="count">{health.orphans.length}</span></h2>
        <p className="health-section-sub">Nothing links to these — you can't reach them by browsing.</p>
        <PageList pages={health.orphans} empty="Every page is linked to. 🎉" />
      </section>

      <section className="health-section">
        <h2>Stubs <span className="count">{health.stubs.length}</span></h2>
        <p className="health-section-sub">Pages still marked Stub.</p>
        <PageList pages={health.stubs} empty="No stubs left. 🎉" />
      </section>

      <ConfirmDialog
        open={notice !== null}
        hideCancel
        title="Couldn't create that page"
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      >
        <p>{notice}</p>
      </ConfirmDialog>
    </div>
  )
}
