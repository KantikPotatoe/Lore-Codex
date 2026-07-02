import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, categoryColor, type LorePage } from '../db'

interface PagePickerProps {
  value: string[]
  onChange: (ids: string[]) => void
  multiple?: boolean
  category?: string
  placeholder?: string
}

const NO_PAGES: LorePage[] = []

/** Id-based wiki-page reference control. Mirrors RefField's look (.ref-* classes)
 *  but stores page ids (rename-safe) and can select any page type. */
export default function PagePicker({
  value, onChange, multiple = true, category, placeholder = 'Add page…',
}: PagePickerProps) {
  const [query, setQuery] = useState('')
  const pages = useLiveQuery(() => pageRepo.listByTitle(), []) ?? NO_PAGES
  const byId = new Map(pages.map((p) => [p.id, p]))
  const selected = new Set(value)

  const q = query.trim().toLowerCase()
  const matches = q
    ? pages
        .filter((p) => !selected.has(p.id) && p.title.toLowerCase().includes(q))
        .filter((p) => !category || p.category === category)
        .slice(0, 8)
    : []

  function add(id: string) {
    onChange(multiple ? [...value, id] : [id])
    setQuery('')
  }
  function remove(id: string) {
    onChange(value.filter((v) => v !== id))
  }

  return (
    <div className="ref-field">
      <div className="ref-chips">
        {value.map((id) => {
          const page = byId.get(id)
          return (
            <span key={id} className="ref-chip">
              <span className="dot" style={{ background: categoryColor(page?.category ?? '') }} />
              {page?.title ?? '(deleted)'}
              <button className="tag-x" title="Remove" onClick={() => remove(id)}>×</button>
            </span>
          )
        })}
      </div>
      <div className="ref-search">
        <input
          className="infobox-value-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && matches.length > 0 && (
          <div className="ref-results">
            {matches.map((p) => (
              <button key={p.id} className="ref-result" onClick={() => add(p.id)}>
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
