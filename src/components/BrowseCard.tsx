import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { categoryColor, statusColor, pageStatus, type LorePage } from '../db'

export default function BrowseCard({ page, index = 0 }: { page: LorePage; index?: number }) {
  const color = categoryColor(page.category)
  return (
    <Link
      to={`/page/${page.id}`}
      className="browse-card"
      style={{ '--stagger-i': Math.min(index, 12) } as CSSProperties}
    >
      <div className="browse-card-img">
        {page.infobox?.image ? (
          <img src={page.infobox.image} alt={page.title} />
        ) : (
          <div className="browse-card-placeholder" style={{ background: color + '33' }}>
            <span style={{ color }}>{page.title.charAt(0).toUpperCase()}</span>
          </div>
        )}
      </div>
      <div className="browse-card-body">
        <div className="browse-card-name">{page.title}</div>
        {page.summary && <div className="browse-card-summary">{page.summary}</div>}
        <span
          className="browse-card-status"
          style={{ borderColor: statusColor(pageStatus(page)), color: statusColor(pageStatus(page)) }}
        >
          {pageStatus(page)}
        </span>
      </div>
    </Link>
  )
}
