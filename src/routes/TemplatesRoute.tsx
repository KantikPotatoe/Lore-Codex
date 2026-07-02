import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  pageRepo,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  resetTemplate,
  applyTemplateToPages,
  TYPE_COLORS,
  type InfoboxTemplate,
  type TemplateItem,
} from '../db'
import ConfirmDialog from '../components/ConfirmDialog'

export default function TemplatesRoute() {
  const templates = useLiveQuery(() => db.templates.orderBy('name').toArray(), [])
  const pages = useLiveQuery(() => pageRepo.list(), []) ?? []
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<InfoboxTemplate | null>(null)

  if (!templates) return <div className="content-pad">Loading…</div>

  // The selected template defaults to the first one until you pick another.
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0] ?? null
  const usedByCount = selected ? pages.filter((p) => p.infobox?.template === selected.name).length : 0

  // Selecting a template also clears any "applied" note from the previous one.
  function selectTemplate(id: string | null) {
    setSelectedId(id)
    setNote('')
    setDirty(false)
  }

  async function applyToPages() {
    if (!selected) return
    const n = await applyTemplateToPages(selected)
    setDirty(false)
    setNote(n === 0 ? 'No pages use this type yet.' : `Updated ${n} page${n === 1 ? '' : 's'}.`)
  }

  async function handleNew() {
    const id = await createTemplate('New template')
    selectTemplate(id)
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    await deleteTemplate(pendingDelete.id)
    setPendingDelete(null)
    selectTemplate(null)
  }

  // -- item editing (operates on the selected template) ---------------------
  function commitItems(items: TemplateItem[]) {
    if (selected) {
      updateTemplate(selected.id, { items })
      setDirty(true)
    }
  }
  function setItem(index: number, patch: Partial<TemplateItem>) {
    if (!selected) return
    commitItems(selected.items.map((it, i) => (i === index ? { ...it, ...patch } : it)))
  }
  function addItem(item: TemplateItem) {
    if (selected) commitItems([...selected.items, item])
  }
  function removeItem(index: number) {
    if (selected) commitItems(selected.items.filter((_, i) => i !== index))
  }
  function moveItem(index: number, dir: -1 | 1) {
    if (!selected) return
    const target = index + dir
    if (target < 0 || target >= selected.items.length) return
    const next = [...selected.items]
    ;[next[index], next[target]] = [next[target], next[index]]
    commitItems(next)
  }

  // -- body-section editing (operates on the selected template) --------------
  function commitSections(sections: string[]) {
    if (selected) updateTemplate(selected.id, { sections })
  }
  function setSection(index: number, value: string) {
    if (!selected) return
    commitSections((selected.sections ?? []).map((s, i) => (i === index ? value : s)))
  }
  function addSection() {
    if (selected) commitSections([...(selected.sections ?? []), 'New section'])
  }
  function removeSection(index: number) {
    if (selected) commitSections((selected.sections ?? []).filter((_, i) => i !== index))
  }
  function moveSection(index: number, dir: -1 | 1) {
    if (!selected) return
    const list = selected.sections ?? []
    const target = index + dir
    if (target < 0 || target >= list.length) return
    const next = [...list]
    ;[next[index], next[target]] = [next[target], next[index]]
    commitSections(next)
  }

  return (
    <div className="templates-view content-pad">
      <header className="templates-header">
        <h1>Page types &amp; templates</h1>
        <p className="templates-intro">
          Each type (Character, Country, Deity…) is a coloured category plus the starter rows for
          its infobox. Edit them here or add your own — new types appear in the type picker on every
          page, and choosing a type fills in its infobox rows. A type can also define starter body
          sections an author can insert into a page with one click.
        </p>
      </header>

      <div className="templates-layout">
        {/* Template list */}
        <aside className="templates-list">
          {templates.map((t) => (
            <button
              key={t.id}
              className={t.id === selected?.id ? 'template-pick active' : 'template-pick'}
              onClick={() => selectTemplate(t.id)}
            >
              <span className="template-pick-dot" style={{ background: t.color }} />
              <span className="template-pick-name">{t.name}</span>
              {t.builtin && <span className="template-builtin-tag">built-in</span>}
            </button>
          ))}
          <button className="mini-btn template-new" onClick={handleNew}>＋ New template</button>
        </aside>

        {/* Selected template editor */}
        {selected ? (
          <section className="template-editor">
            <div className="template-editor-head">
              <input
                className="template-name-input"
                value={selected.name}
                onChange={(e) => updateTemplate(selected.id, { name: e.target.value })}
                placeholder="Type name"
              />
              {selected.builtin ? (
                <button className="mini-btn" onClick={() => { resetTemplate(selected.id); setDirty(true) }} title="Restore shipped colour and rows">
                  ↺ Reset
                </button>
              ) : (
                <button className="mini-btn danger" onClick={() => setPendingDelete(selected)}>Delete</button>
              )}
            </div>

            <div className="template-color-row">
              <span className="template-color-label">Colour</span>
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  className={selected.color?.toLowerCase() === c ? 'color-swatch active' : 'color-swatch'}
                  style={{ background: c }}
                  title={c}
                  onClick={() => updateTemplate(selected.id, { color: c })}
                />
              ))}
              <input
                type="color"
                className="color-custom"
                value={selected.color ?? '#a0a0a0'}
                title="Custom colour"
                onChange={(e) => updateTemplate(selected.id, { color: e.target.value })}
              />
            </div>

            <div className="template-color-row">
              <span className="template-color-label">Icon</span>
              <input
                className="template-icon-input"
                value={selected.icon ?? ''}
                maxLength={4}
                placeholder="🏰"
                title="An emoji shown on map pins of this type"
                onChange={(e) => updateTemplate(selected.id, { icon: e.target.value })}
              />
              {selected.icon && (
                <button
                  className="mini-btn"
                  onClick={() => updateTemplate(selected.id, { icon: '' })}
                  title="Clear icon"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="template-items">
              {selected.items.length === 0 && (
                <p className="empty-hint">No rows yet. Add a field or a separator below.</p>
              )}
              {selected.items.map((it, i) => (
                <div key={i} className={it.separator ? 'template-item separator' : 'template-item'}>
                  <div className="template-item-move">
                    <button className="tag-x" title="Move up" disabled={i === 0} onClick={() => moveItem(i, -1)}>▲</button>
                    <button className="tag-x" title="Move down" disabled={i === selected.items.length - 1} onClick={() => moveItem(i, 1)}>▼</button>
                  </div>
                  <input
                    className="template-item-label"
                    value={it.label}
                    placeholder={it.separator ? 'Section heading…' : 'Field label…'}
                    onChange={(e) => setItem(i, { label: e.target.value })}
                  />
                  {it.separator ? (
                    <span className="template-item-kind">separator</span>
                  ) : (
                    <>
                      <select
                        className="template-item-type"
                        value={it.fieldType ?? 'text'}
                        onChange={(e) => {
                          const ft = e.target.value as 'text' | 'ref' | 'number'
                          setItem(i, {
                            fieldType: ft,
                            refType: ft === 'ref' ? (it.refType ?? templates[0]?.name) : undefined,
                          })
                        }}
                      >
                        <option value="text">text</option>
                        <option value="ref">page link</option>
                        <option value="number">number</option>
                      </select>
                      {it.fieldType === 'ref' && (
                        <select
                          className="template-item-reftype"
                          value={it.refType ?? ''}
                          onChange={(e) => setItem(i, { refType: e.target.value })}
                        >
                          {templates.map((t) => (
                            <option key={t.id} value={t.name}>{t.name}</option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                  <button className="tag-x" title="Remove row" onClick={() => removeItem(i)}>×</button>
                </div>
              ))}
            </div>

            <div className="template-editor-actions">
              <button className="mini-btn" onClick={() => addItem({ label: 'New field' })}>＋ Add field</button>
              <button className="mini-btn" onClick={() => addItem({ label: 'Section', separator: true })}>＋ Add separator</button>
            </div>

            <div className="template-sections">
              <h3 className="template-sections-head">Body sections</h3>
              <p className="template-sections-intro">
                Starter headings an author can drop into a page's body with the "＋ Sections"
                button in the editor. Inserted on demand per page — never added automatically or
                pushed to existing pages.
              </p>
              {(selected.sections ?? []).length === 0 && (
                <p className="empty-hint">No starter sections yet. Add some below.</p>
              )}
              {(selected.sections ?? []).map((s, i) => (
                <div key={i} className="template-item">
                  <div className="template-item-move">
                    <button className="tag-x" title="Move up" disabled={i === 0} onClick={() => moveSection(i, -1)}>▲</button>
                    <button
                      className="tag-x"
                      title="Move down"
                      disabled={i === (selected.sections ?? []).length - 1}
                      onClick={() => moveSection(i, 1)}
                    >▼</button>
                  </div>
                  <input
                    className="template-item-label"
                    value={s}
                    placeholder="Section heading…"
                    onChange={(e) => setSection(i, e.target.value)}
                  />
                  <button className="tag-x" title="Remove section" onClick={() => removeSection(i)}>×</button>
                </div>
              ))}
              <div className="template-editor-actions">
                <button className="mini-btn" onClick={addSection}>＋ Add section</button>
              </div>
            </div>

            <div className={`template-apply-row${dirty && usedByCount > 0 ? ' dirty' : ''}`}>
              {dirty && usedByCount > 0 && (
                <p className="template-apply-callout">
                  ● You changed this type’s rows. Existing pages keep their old rows until you apply.
                </p>
              )}
              <div className="template-apply-controls">
                <button className="mini-btn" disabled={usedByCount === 0} onClick={applyToPages}>
                  {usedByCount > 0
                    ? `Apply to ${usedByCount} existing page${usedByCount === 1 ? '' : 's'}`
                    : 'Apply to existing pages'}
                </button>
                <span className="template-apply-hint">
                  {note ||
                    (usedByCount === 0 ? 'No pages use this type yet.' : 'Filled-in values are kept.')}
                </span>
              </div>
            </div>
          </section>
        ) : (
          <section className="template-editor empty">
            <p className="empty-hint">Select a template, or create a new one.</p>
          </section>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete template?"
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        Delete the “{pendingDelete?.name}” template? Pages already using it keep their fields.
      </ConfirmDialog>
    </div>
  )
}
