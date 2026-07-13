// src/components/CalendarEditor.tsx
import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  calendarRepo,
  createCalendar, updateCalendar, deleteCalendar,
  type Calendar, type CalendarMonth, type CalendarEra,
} from '../db'
import ConfirmDialog from './ConfirmDialog'
import { useEscapeKey } from '../useEscapeKey'

interface Props {
  onClose: () => void
}

export default function CalendarEditor({ onClose }: Props) {
  const calendars = useLiveQuery(() => calendarRepo.listCalendars(), []) ?? []
  const [editId, setEditId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Calendar | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Calendar | null>(null)

  // Esc closes the editor, unless the delete confirmation owns it.
  useEscapeKey(onClose, pendingDelete === null)

  function startEdit(cal: Calendar) {
    setDraft(JSON.parse(JSON.stringify(cal)))
    setEditId(cal.id)
  }

  function cancelEdit() {
    setDraft(null)
    setEditId(null)
  }

  async function handleNew() {
    const id = await createCalendar('New Calendar')
    const cal = await calendarRepo.getCalendar(id)
    if (cal) startEdit(cal)
  }

  async function handleSave() {
    if (!draft) return
    await updateCalendar(draft.id, draft)
    cancelEdit()
  }

  async function confirmDelete() {
    const cal = pendingDelete
    if (!cal) return
    setPendingDelete(null)
    await deleteCalendar(cal.id)
    if (editId === cal.id) cancelEdit()
  }

  // -- month helpers ----------------------------------------------------------
  function setMonth(i: number, patch: Partial<CalendarMonth>) {
    if (!draft) return
    const months = draft.months.map((m, j) => (j === i ? { ...m, ...patch } : m))
    setDraft({ ...draft, months })
  }
  function addMonth() {
    if (!draft) return
    setDraft({ ...draft, months: [...draft.months, { name: 'New Month', days: 30 }] })
  }
  function removeMonth(i: number) {
    if (!draft) return
    setDraft({ ...draft, months: draft.months.filter((_, j) => j !== i) })
  }
  function moveMonth(i: number, dir: -1 | 1) {
    if (!draft) return
    const t = i + dir
    if (t < 0 || t >= draft.months.length) return
    const m = [...draft.months];
    [m[i], m[t]] = [m[t], m[i]]
    setDraft({ ...draft, months: m })
  }

  // -- weekday helpers --------------------------------------------------------
  function setWeekday(i: number, name: string) {
    if (!draft) return
    const weekdays = draft.weekdays.map((w, j) => (j === i ? name : w))
    setDraft({ ...draft, weekdays })
  }
  function addWeekday() {
    if (!draft) return
    setDraft({ ...draft, weekdays: [...draft.weekdays, 'New Day'] })
  }
  function removeWeekday(i: number) {
    if (!draft) return
    setDraft({ ...draft, weekdays: draft.weekdays.filter((_, j) => j !== i) })
  }

  // -- era helpers ------------------------------------------------------------
  function setEra(i: number, patch: Partial<CalendarEra>) {
    if (!draft) return
    const eras = draft.eras.map((e, j) => (j === i ? { ...e, ...patch } : e))
    setDraft({ ...draft, eras })
  }
  function addEra() {
    if (!draft) return
    setDraft({ ...draft, eras: [...draft.eras, { id: crypto.randomUUID(), name: 'New Era', startYear: 0 }] })
  }
  function removeEra(i: number) {
    if (!draft) return
    setDraft({ ...draft, eras: draft.eras.filter((_, j) => j !== i) })
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-dialog modal-dialog-lg cal-editor">
        <div className="cal-editor-head">
          <h2 className="modal-title">Manage Calendars</h2>
          <button className="tag-x" onClick={onClose}>×</button>
        </div>

        <div className="cal-editor-body">
          {/* Left: calendar list */}
          <div className="cal-list">
            {calendars.map((cal) => (
              <div
                key={cal.id}
                className={`cal-list-item${editId === cal.id ? ' active' : ''}`}
              >
                <span className="cal-list-name" onClick={() => startEdit(cal)}>{cal.name}</span>
                <button className="mini-btn danger" onClick={() => setPendingDelete(cal)}>✕</button>
              </div>
            ))}
            <button className="ghost-btn" style={{ marginTop: 8 }} onClick={handleNew}>
              + New calendar
            </button>
          </div>

          {/* Right: edit panel */}
          {draft && editId ? (
            <div className="cal-edit-panel">
              <div className="field-row">
                <label>Name</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="tpl-name-input"
                />
              </div>
              <div className="field-row">
                <label title="The absolute day on which Year 0, Month 1, Day 1 of this calendar falls. Default 0.">
                  Axis anchor (day)
                </label>
                <input
                  type="number"
                  value={draft.anchor}
                  onChange={(e) => setDraft({ ...draft, anchor: parseInt(e.target.value) || 0 })}
                  style={{ width: 100 }}
                />
              </div>

              <h3 className="cal-section-title">Months</h3>
              {draft.months.map((m, i) => (
                <div key={i} className="cal-row">
                  <button className="mini-btn" onClick={() => moveMonth(i, -1)} disabled={i === 0}>▲</button>
                  <button className="mini-btn" onClick={() => moveMonth(i, 1)} disabled={i === draft.months.length - 1}>▼</button>
                  <input
                    value={m.name}
                    onChange={(e) => setMonth(i, { name: e.target.value })}
                    className="cal-row-name"
                    placeholder="Month name"
                  />
                  <input
                    type="number"
                    min={1}
                    value={m.days}
                    onChange={(e) => setMonth(i, { days: Math.max(1, parseInt(e.target.value) || 1) })}
                    style={{ width: 60 }}
                  />
                  <span className="cal-row-unit">days</span>
                  <button className="mini-btn danger" onClick={() => removeMonth(i)}>✕</button>
                </div>
              ))}
              <button className="ghost-btn" style={{ marginTop: 4 }} onClick={addMonth}>+ Add month</button>

              <h3 className="cal-section-title">Weekdays</h3>
              {draft.weekdays.map((w, i) => (
                <div key={i} className="cal-row">
                  <input
                    value={w}
                    onChange={(e) => setWeekday(i, e.target.value)}
                    className="cal-row-name"
                    placeholder="Day name"
                  />
                  <button className="mini-btn danger" onClick={() => removeWeekday(i)}>✕</button>
                </div>
              ))}
              <button className="ghost-btn" style={{ marginTop: 4 }} onClick={addWeekday}>+ Add weekday</button>

              <h3 className="cal-section-title">Eras</h3>
              {draft.eras.map((era, i) => (
                <div key={era.id} className="cal-row">
                  <input
                    value={era.name}
                    onChange={(e) => setEra(i, { name: e.target.value })}
                    className="cal-row-name"
                    placeholder="Era name"
                  />
                  <label style={{ fontSize: 12, color: 'var(--ink-faint)' }}>from year</label>
                  <input
                    type="number"
                    value={era.startYear}
                    onChange={(e) => setEra(i, { startYear: parseInt(e.target.value) || 0 })}
                    style={{ width: 80 }}
                  />
                  <input
                    type="color"
                    value={era.color ?? '#3a3328'}
                    onChange={(e) => setEra(i, { color: e.target.value })}
                    style={{ width: 32, height: 28, padding: 2, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'none' }}
                    title="Era accent color"
                  />
                  <button className="mini-btn danger" onClick={() => removeEra(i)}>✕</button>
                </div>
              ))}
              <button className="ghost-btn" style={{ marginTop: 4 }} onClick={addEra}>+ Add era</button>

              <div className="modal-actions">
                <button className="ghost-btn" onClick={cancelEdit}>Cancel</button>
                <button className="primary-btn" onClick={handleSave}>Save calendar</button>
              </div>
            </div>
          ) : (
            <div className="cal-edit-panel cal-edit-empty">
              <p className="muted">Select a calendar on the left to edit it.</p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete calendar?"
        confirmLabel="Delete"
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      >
        Delete “{pendingDelete?.name}” and all its events? This cannot be undone.
      </ConfirmDialog>
    </div>
  )
}
