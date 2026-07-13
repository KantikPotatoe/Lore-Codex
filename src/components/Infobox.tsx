import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  templateRepo,
  type Infobox,
  type InfoboxField,
  applyTemplate,
} from '../db'
import WikiText from './WikiText'
import RefField from './RefField'
import DraftInput from './DraftInput'
import { compressImage } from '../imageUtils'

interface Props {
  box: Infobox
  editable: boolean
  /** Persist a changed infobox. */
  onChange: (box: Infobox) => void
  /** Remove the infobox entirely (edit mode only). */
  onRemove: () => void
  /** Title of the page, shown as the infobox heading. */
  title: string
  /** Accent color (from the page category) for the heading bar. */
  accent: string
  /** Follow a [[wiki link]] in a field value (view mode). */
  onWikiClick: (title: string) => void
  /** Lowercased titles of existing pages, for broken-link styling. */
  knownTitles?: Set<string>
}

export default function Infobox({ box, editable, onChange, onRemove, title, accent, onWikiClick, knownTitles }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const templates = useLiveQuery(() => templateRepo.listByName(), []) ?? []

  // Field labels defined by this box's page type. Those are managed in /templates,
  // so in edit mode we show them as read-only text (you fill in the value, not the
  // name). Fields you add by hand aren't in this set and stay freely renamable.
  const typeLabels = new Set(
    templates
      .find((t) => t.name === box.template)
      ?.items.filter((it) => !it.separator)
      .map((it) => it.label.toLowerCase()) ?? [],
  )

  // A separator only "counts" as content if it has a following field with a value.
  const filledFields = box.fields.filter((fld) => fld.kind === 'separator' || fld.value.trim())
  const visibleRows = dropEmptySeparators(filledFields)
  const hasContent = box.image || box.fields.some((fld) => fld.kind !== 'separator' && fld.value.trim())

  // In view mode, an empty infobox shows nothing at all.
  if (!editable && !hasContent) return null

  // -- field helpers --------------------------------------------------------
  function setField(id: string, patch: Partial<InfoboxField>) {
    onChange({ ...box, fields: box.fields.map((fld) => (fld.id === id ? { ...fld, ...patch } : fld)) })
  }
  function addField() {
    onChange({ ...box, fields: [...box.fields, { id: crypto.randomUUID(), label: 'New field', value: '' }] })
  }
  function addSeparator() {
    onChange({ ...box, fields: [...box.fields, { id: crypto.randomUUID(), label: 'Section', value: '', kind: 'separator' }] })
  }
  function removeField(id: string) {
    onChange({ ...box, fields: box.fields.filter((fld) => fld.id !== id) })
  }

  // -- image helpers --------------------------------------------------------
  async function pickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await compressImage(file, 800)
    onChange({ ...box, image: dataUrl })
    e.target.value = ''
  }

  function changeTemplate(name: string) {
    const tpl = templates.find((t) => t.name === name)
    if (tpl) onChange(applyTemplate(box, tpl))
  }

  return (
    <aside className="infobox">
      <div className="infobox-title" style={{ background: accent }}>{title}</div>

      {/* Image */}
      {box.image ? (
        <figure className="infobox-figure">
          <img src={box.image} alt={title} />
          {editable ? (
            <>
              <DraftInput
                className="infobox-caption-input"
                placeholder="caption…"
                value={box.caption}
                onCommit={(v) => onChange({ ...box, caption: v })}
              />
              <div className="infobox-img-actions">
                <button className="mini-btn" onClick={() => fileRef.current?.click()}>Replace</button>
                <button className="mini-btn danger" onClick={() => onChange({ ...box, image: null, caption: '' })}>Remove</button>
              </div>
            </>
          ) : (
            box.caption && <figcaption>{box.caption}</figcaption>
          )}
        </figure>
      ) : (
        editable && (
          <button className="infobox-add-image" onClick={() => fileRef.current?.click()}>
            ＋ Add image
          </button>
        )
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />

      {/* Template picker (edit mode only) */}
      {editable && (
        <div className="infobox-template">
          <label>Template</label>
          <select value={box.template} onChange={(e) => changeTemplate(e.target.value)}>
            {/* Show the current template even if it has since been renamed/deleted. */}
            {!templates.some((t) => t.name === box.template) && (
              <option value={box.template}>{box.template}</option>
            )}
            {templates.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
          </select>
          <Link to="/templates" className="infobox-template-edit" title="Edit templates">✎</Link>
        </div>
      )}

      {/* Fields */}
      <div className="infobox-fields">
        {editable
          ? box.fields.map((fld) =>
              fld.kind === 'separator' ? (
                <div key={fld.id} className="infobox-row editing separator">
                  <DraftInput
                    className="infobox-separator-input"
                    value={fld.label}
                    placeholder="Section heading…"
                    onCommit={(v) => setField(fld.id, { label: v })}
                  />
                  <button className="tag-x" title="Remove separator" onClick={() => removeField(fld.id)}>×</button>
                </div>
              ) : (
                <div key={fld.id} className="infobox-row editing">
                  {typeLabels.has(fld.label.toLowerCase()) ? (
                    <span className="infobox-label-input locked" title="Defined by the page type — edit field names in Templates">
                      {fld.label}
                    </span>
                  ) : (
                    <DraftInput
                      className="infobox-label-input"
                      value={fld.label}
                      onCommit={(v) => setField(fld.id, { label: v })}
                    />
                  )}
                  {fld.fieldType === 'ref' && fld.refType ? (
                    <RefField
                      value={fld.value}
                      refType={fld.refType}
                      onChange={(value) => setField(fld.id, { value })}
                    />
                  ) : fld.fieldType === 'number' ? (
                    <DraftInput
                      className="infobox-value-input"
                      type="number"
                      placeholder="number…"
                      value={fld.value}
                      onCommit={(v) => setField(fld.id, { value: v })}
                    />
                  ) : (
                    <DraftInput
                      className="infobox-value-input"
                      placeholder="value…"
                      value={fld.value}
                      onCommit={(v) => setField(fld.id, { value: v })}
                    />
                  )}
                  <button className="tag-x" title="Remove field" onClick={() => removeField(fld.id)}>×</button>
                </div>
              ),
            )
          : visibleRows.map((fld) =>
              fld.kind === 'separator' ? (
                <div key={fld.id} className="infobox-separator">{fld.label}</div>
              ) : (
                <div key={fld.id} className="infobox-row">
                  <span className="infobox-label">{fld.label}</span>
                  <span className="infobox-value">
                    <WikiText value={fld.value} onWikiClick={onWikiClick} knownTitles={knownTitles} />
                  </span>
                </div>
              ),
            )}
      </div>

      {editable && (
        <div className="infobox-actions">
          <button className="mini-btn" onClick={addField}>＋ Add field</button>
          <button className="mini-btn" onClick={addSeparator}>＋ Add separator</button>
          <button className="mini-btn danger" onClick={onRemove}>Delete infobox</button>
          <span className="infobox-hint">Use [[Name]] to link a page</span>
        </div>
      )}
    </aside>
  )
}

/** Hide separators in view mode that head no visible fields (e.g. a trailing
 *  heading, or one whose section is entirely empty). */
function dropEmptySeparators(rows: InfoboxField[]): InfoboxField[] {
  return rows.filter((row, i) => {
    if (row.kind !== 'separator') return true
    // Keep only if some field appears before the next separator.
    for (let j = i + 1; j < rows.length; j++) {
      if (rows[j].kind === 'separator') break
      return true
    }
    return false
  })
}

