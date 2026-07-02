import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, parseRefTitles, serializeRefTitles } from '../db'

interface Props {
  /** Current field value, e.g. "[[Iron Guild]] [[Free Companies]]". */
  value: string
  /** Page-type name this field links to; only pages of this type are offered. */
  refType: string
  onChange: (value: string) => void
}

/** Edit-mode picker for a typed page-reference field. Shows linked pages as
 *  removable chips and a search box that offers only pages whose category is
 *  `refType`, with an inline "create new page of this type" option. */
export default function RefField({ value, refType, onChange }: Props) {
  const [query, setQuery] = useState('')
  const titles = parseRefTitles(value)
  const lowerTitles = new Set(titles.map((t) => t.toLowerCase()))

  // Pages of the bound type, reactive to DB changes.
  const candidates = useLiveQuery(
    () => pageRepo.listByCategory(refType),
    [refType],
  ) ?? []

  const q = query.trim().toLowerCase()
  const matches = q
    ? candidates
        .filter((p) => p.title.toLowerCase().includes(q) && !lowerTitles.has(p.title.toLowerCase()))
        .slice(0, 8)
    : []
  const exactExists =
    !!q && candidates.some((p) => p.title.toLowerCase() === q)

  function addTitle(title: string) {
    if (lowerTitles.has(title.toLowerCase())) return
    onChange(serializeRefTitles([...titles, title]))
    setQuery('')
  }

  function removeTitle(title: string) {
    onChange(serializeRefTitles(titles.filter((t) => t !== title)))
  }

  async function createAndAdd() {
    const title = query.trim()
    if (!title) return
    // A page with this title may already exist (e.g. it's linked elsewhere so it's
    // filtered out of the suggestions); reuse it rather than creating a duplicate,
    // which createPage now rejects.
    const existing = await pageRepo.findIdByTitle(title)
    if (!existing) await pageRepo.create({ title, category: refType })
    addTitle(title)
  }

  return (
    <div className="ref-field">
      <div className="ref-chips">
        {titles.map((t) => (
          <span key={t} className="ref-chip">
            {t}
            <button className="tag-x" title="Remove" onClick={() => removeTitle(t)}>×</button>
          </span>
        ))}
      </div>
      <div className="ref-search">
        <input
          className="infobox-value-input"
          placeholder={`Add ${refType}…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {q && (
          <div className="ref-results">
            {matches.map((p) => (
              <button key={p.id} className="ref-result" onClick={() => addTitle(p.title)}>
                {p.title}
              </button>
            ))}
            {!exactExists && (
              <button className="ref-result ref-create" onClick={createAndAdd}>
                ＋ Create “{query.trim()}” as {refType}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
