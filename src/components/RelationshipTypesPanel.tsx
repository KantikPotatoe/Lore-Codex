import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { relationshipRepo, TYPE_COLORS, type RelationshipGroup, type RelationshipType } from '../db'
import { isSymmetric } from '../relations'
import ConfirmDialog from './ConfirmDialog'

const GROUPS: RelationshipGroup[] = ['kin', 'faction', 'org', 'social', 'other']

/** The relationship-type vocabulary editor, shown below the page types on
 *  /templates. Both are the world's user-definable vocabularies, so they share
 *  a route; this lives in its own component because TemplatesRoute already
 *  carries its own master/detail state. */
export default function RelationshipTypesPanel() {
  const types = useLiveQuery(() => relationshipRepo.listTypes(), [])
  const [pendingDelete, setPendingDelete] = useState<RelationshipType | null>(null)
  const [deleteCount, setDeleteCount] = useState(0)

  if (!types) return null

  async function askDelete(type: RelationshipType) {
    setDeleteCount(await relationshipRepo.countOfType(type.id))
    setPendingDelete(type)
  }

  return (
    <section className="reltypes">
      <h2>Relationship types</h2>
      <p className="templates-intro">
        How pages relate to each other. Each type reads one way from the page you
        add it on and the other way from the page it points at — “Parent of” from
        one end is “Child of” from the other. Give both ends the same wording to
        make a type symmetric.
      </p>

      <ul className="reltypes-list">
        {types.map((t) => (
          <li key={t.id} className="reltypes-row">
            <input
              className="reltypes-input"
              value={t.label}
              aria-label="Label"
              onChange={(e) => relationshipRepo.updateType(t.id, { label: e.target.value })}
            />
            <span className="reltypes-sep">/</span>
            <input
              className="reltypes-input"
              value={t.inverse}
              aria-label="Inverse label"
              onChange={(e) => relationshipRepo.updateType(t.id, { inverse: e.target.value })}
            />
            {isSymmetric(t) && (
              <span className="reltypes-symmetric">symmetric</span>
            )}
            <select
              className="reltypes-group"
              value={t.group}
              aria-label="Group"
              onChange={(e) =>
                relationshipRepo.updateType(t.id, { group: e.target.value as RelationshipGroup })
              }
            >
              {GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
            <span className="reltypes-colors">
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch${t.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => relationshipRepo.updateType(t.id, { color: c })}
                />
              ))}
            </span>
            {t.builtin ? (
              <button
                className="mini-btn"
                title="Restore shipped labels and colour"
                onClick={() => relationshipRepo.resetType(t.id)}
              >
                Reset
              </button>
            ) : (
              <button
                className="mini-btn danger"
                title="Delete type"
                onClick={() => askDelete(t)}
              >
                Delete
              </button>
            )}
          </li>
        ))}
      </ul>

      <button
        className="mini-btn template-new"
        onClick={() =>
          relationshipRepo.createType({
            label: 'New relationship', inverse: 'New relationship', group: 'other',
          })
        }
      >
        ＋ Add type
      </button>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.label ?? ''}”?`}
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          if (pendingDelete) await relationshipRepo.removeType(pendingDelete.id)
          setPendingDelete(null)
        }}
        onCancel={() => setPendingDelete(null)}
      >
        {deleteCount === 0
          ? 'No pages use this relationship type.'
          : `${deleteCount} relationship${deleteCount === 1 ? '' : 's'} using this type will be deleted too. This cannot be undone.`}
      </ConfirmDialog>
    </section>
  )
}
