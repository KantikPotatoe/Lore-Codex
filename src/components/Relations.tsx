import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { relationshipRepo, categoryColor, type LorePage } from '../db'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'
import PagePicker from './PagePicker'

interface Props {
  page: LorePage
  editable: boolean
}

/** The "Relations" panel in the page aside: every typed relationship touching
 *  this page, resolved to its point of view. One merged list — with inverse
 *  labels there is no reader-visible difference between the two stored
 *  directions (see getRelationsFor). Quiet when empty in view mode, matching
 *  PageHistory. */
export default function Relations({ page, editable }: Props) {
  const relations = useLiveQuery(() => relationshipRepo.listFor(page.id), [page.id]) ?? []

  if (!editable && relations.length === 0) return null

  return (
    <section className="relations">
      <h2 className="relations-heading">Relations</h2>
      <ul className="relations-list">
        {relations.map((r) => (
          <li key={r.row.id} className="relations-row">
            <span className="relations-label" style={{ color: r.type.color }}>
              {r.label}
            </span>
            <Link
              to={`/page/${r.other.id}`}
              className="relations-target"
              onMouseEnter={(e) =>
                showPageHover(r.other.id, r.other.title, e.currentTarget.getBoundingClientRect())
              }
              onMouseLeave={scheduleWikiHoverClose}
            >
              <span className="dot" style={{ background: categoryColor(r.other.category) }} />
              {r.other.title}
            </Link>
            {r.row.note && <span className="relations-note">{r.row.note}</span>}
            {editable && (
              <button
                className="tag-x"
                title="Remove relationship"
                onClick={() => relationshipRepo.remove(r.row.id)}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editable && <AddRelation page={page} />}
    </section>
  )
}

/** The edit-mode add form: pick a type, pick a page, optionally annotate. */
function AddRelation({ page }: { page: LorePage }) {
  const types = useLiveQuery(() => relationshipRepo.listTypes(), []) ?? []
  const [typeId, setTypeId] = useState('')
  const [target, setTarget] = useState<string[]>([])
  const [note, setNote] = useState('')

  const effectiveType = typeId || types[0]?.id || ''
  const canAdd = effectiveType !== '' && target.length > 0

  async function add() {
    if (!canAdd) return
    await relationshipRepo.add(page.id, target[0], effectiveType, note.trim())
    setTarget([])
    setNote('')
  }

  return (
    <div className="relations-add">
      <select
        className="relations-type-select"
        value={effectiveType}
        onChange={(e) => setTypeId(e.target.value)}
      >
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <PagePicker
        value={target}
        onChange={setTarget}
        multiple={false}
        placeholder="Find a page…"
      />
      <input
        className="infobox-value-input relations-note-input"
        placeholder="Note (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <button className="mini-btn" disabled={!canAdd} onClick={add}>
        ＋ Add
      </button>
    </div>
  )
}
