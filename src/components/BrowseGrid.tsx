import type { CSSProperties, ReactNode } from 'react'
import type { LorePage } from '../db'
import BrowseCard from './BrowseCard'
import EmptyState from './EmptyState'

/** Empty-state copy shown when a browse screen has no pages. */
export interface BrowseEmpty {
  icon: string
  title: string
  message: string
}

/** Shared layout for the "list of pages" screens (a category, a tag): an
 *  identity hero (accent bar + colour wash, mirroring .page-header), then
 *  either a card grid or an empty state. CategoryRoute / TagRoute differ only
 *  in the query and this copy. */
export default function BrowseGrid({
  title,
  titleColor,
  glyph,
  action,
  pages,
  empty,
}: {
  /** Heading content (e.g. a category name, or `#tag`). */
  title: ReactNode
  /** Accent colour driving the hero's bar + wash (defaults to gold). */
  titleColor?: string
  /** Optional page-type emoji shown large beside the title. */
  glyph?: string
  /** Optional header control, e.g. a "+ New" button. */
  action?: ReactNode
  pages: LorePage[]
  empty: BrowseEmpty
}) {
  return (
    <div className="browse-route">
      <header
        className="browse-header browse-hero"
        style={{ '--hero-color': titleColor ?? 'var(--accent)' } as CSSProperties}
      >
        {glyph && <span className="browse-hero-glyph">{glyph}</span>}
        <h1 className="browse-title">
          {title}
          <span className="browse-count">
            {pages.length === 1 ? '1 page' : `${pages.length} pages`}
          </span>
        </h1>
        {action}
      </header>

      {pages.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title} message={empty.message} />
      ) : (
        <div className="browse-grid">
          {pages.map((page) => (
            <BrowseCard key={page.id} page={page} />
          ))}
        </div>
      )}
    </div>
  )
}
