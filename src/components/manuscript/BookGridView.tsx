import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  manuscriptRepo, createPlotline, updatePlotline, deletePlotline, reorderPlotlines,
  createBeat, updateBeat, deleteBeat, sceneStatusColor, TYPE_COLORS,
  type Scene, type Chapter, type Plotline, type Beat,
} from '../../db'
import EmptyState from '../EmptyState'
import StructureControls from './StructureControls'

const NO_SCENES: Scene[] = []
const NO_CHAPTERS: Chapter[] = []
const NO_PLOTLINES: Plotline[] = []
const NO_BEATS: Beat[] = []

export default function BookGridView({ bookId }: { bookId: string }) {
  const scenes = useLiveQuery(() => manuscriptRepo.listScenesForBook(bookId), [bookId]) ?? NO_SCENES
  const chapters = useLiveQuery(() => manuscriptRepo.listChaptersForBook(bookId), [bookId]) ?? NO_CHAPTERS
  const plotlines = useLiveQuery(() => manuscriptRepo.listPlotlinesForBook(bookId), [bookId]) ?? NO_PLOTLINES
  const beats = useLiveQuery(() => manuscriptRepo.listBeatsForBook(bookId), [bookId]) ?? NO_BEATS

  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Structure lane pinned to the top; plot lanes follow in their own order.
  const orderedLanes = useMemo(
    () => [...plotlines].sort((a, b) => Number(b.kind === 'structure') - Number(a.kind === 'structure')),
    [plotlines],
  )

  // Ordered scene columns (by chapter order, then scene order) + chapter spans.
  const { columns, chapterSpans } = useMemo(() => {
    const chOrder = new Map(chapters.map((c, i) => [c.id, i]))
    const cols = [...scenes].sort((a, b) =>
      (chOrder.get(a.chapterId) ?? 0) - (chOrder.get(b.chapterId) ?? 0) || a.order - b.order,
    )
    const spans: { chapterId: string; title: string; count: number }[] = []
    for (const s of cols) {
      const last = spans[spans.length - 1]
      if (last && last.chapterId === s.chapterId) last.count++
      else spans.push({ chapterId: s.chapterId, title: chapters.find((c) => c.id === s.chapterId)?.title ?? '', count: 1 })
    }
    return { columns: cols, chapterSpans: spans }
  }, [scenes, chapters])

  const beatByKey = useMemo(() => {
    const m = new Map<string, Beat>()
    for (const b of beats) if (b.sceneId) m.set(`${b.plotlineId}:${b.sceneId}`, b)
    return m
  }, [beats])

  // Plot-lane index (for ▲▼ reorder, which only applies to plot lanes).
  const plotLanes = useMemo(() => plotlines.filter((p) => p.kind === 'plot').sort((a, b) => a.order - b.order), [plotlines])

  function startEdit(key: string, current: string) {
    setEditingKey(key)
    setDraft(current)
  }

  async function commitEdit(plotlineId: string, sceneId: string, beat: Beat | undefined) {
    const text = draft.trim()
    setEditingKey(null)
    if (beat && !text && !beat.label) { await deleteBeat(beat.id); return }
    if (beat && text !== beat.note) { await updateBeat(beat.id, { note: text }); return }
    if (!beat && text) { await createBeat(bookId, plotlineId, sceneId, text); return }
  }

  function moveLane(pl: Plotline, dir: -1 | 1) {
    const index = plotLanes.findIndex((p) => p.id === pl.id)
    const j = index + dir
    if (index < 0 || j < 0 || j >= plotLanes.length) return
    const next = [...plotLanes]
    ;[next[index], next[j]] = [next[j], next[index]]
    reorderPlotlines(bookId, next.map((p) => p.id))
  }

  function cycleColor(pl: Plotline) {
    const i = TYPE_COLORS.indexOf(pl.color as (typeof TYPE_COLORS)[number])
    const nextColor = TYPE_COLORS[(i + 1) % TYPE_COLORS.length]
    updatePlotline(pl.id, { color: nextColor })
  }

  return (
    <div className="grid-board">
      <div className="grid-board-actions">
        <button className="primary-btn" onClick={() => createPlotline(bookId, 'New plotline')}>＋ Plotline</button>
        <StructureControls bookId={bookId} />
      </div>
      {plotlines.length === 0 ? (
        <EmptyState
          icon="🧵"
          title="No plotlines yet"
          message="Add a plotline to start weaving threads through your chapters."
        />
      ) : (
        <div className="grid-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="grid-corner" />
                {chapterSpans.map((cs, i) => (
                  <th key={`${cs.chapterId}:${i}`} colSpan={cs.count} className="grid-chapter">{cs.title}</th>
                ))}
              </tr>
              <tr>
                <th className="grid-corner" />
                {columns.map((s) => (
                  <th key={s.id} className="grid-scene-col">
                    <span className="status-pip" style={{ background: sceneStatusColor(s.status) }} />
                    {s.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {orderedLanes.map((pl) => (
                <tr key={pl.id}>
                  <th className={pl.kind === 'structure' ? 'grid-lane grid-lane-structure' : 'grid-lane'} style={{ borderLeft: `3px solid ${pl.color}` }}>
                    {pl.kind === 'structure' ? (
                      <span className="grid-lane-structure-name">{pl.name}</span>
                    ) : (
                      <div className="grid-lane-controls">
                        <button
                          className="lane-swatch"
                          title="Change color"
                          aria-label={`lane color ${pl.id}`}
                          style={{ background: pl.color }}
                          onClick={() => cycleColor(pl)}
                        />
                        <input
                          className="lane-name"
                          aria-label={`lane name ${pl.id}`}
                          value={pl.name}
                          onChange={(e) => updatePlotline(pl.id, { name: e.target.value })}
                        />
                        <button className="lane-btn" title="Move up" aria-label={`move lane up ${pl.id}`} onClick={() => moveLane(pl, -1)}>▲</button>
                        <button className="lane-btn" title="Move down" aria-label={`move lane down ${pl.id}`} onClick={() => moveLane(pl, 1)}>▼</button>
                        <button className="lane-btn lane-del" title="Delete lane" aria-label={`delete lane ${pl.id}`} onClick={() => deletePlotline(pl.id)}>×</button>
                      </div>
                    )}
                  </th>
                  {columns.map((s) => {
                    const key = `${pl.id}:${s.id}`
                    const beat = beatByKey.get(key)
                    const editing = editingKey === key
                    return (
                      <td
                        key={s.id}
                        className="grid-cell"
                        aria-label={`beat ${key}`}
                        onClick={() => !editing && startEdit(key, beat?.note ?? '')}
                      >
                        {editing ? (
                          <textarea
                            className="grid-beat-editor"
                            aria-label="beat note"
                            autoFocus
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onBlur={() => commitEdit(pl.id, s.id, beat)}
                          />
                        ) : beat ? (
                          <span className="grid-beat" style={{ background: `${pl.color}22` }}>
                            {beat.label && <strong className="grid-beat-label">{beat.label}</strong>}
                            {beat.note}
                            {pl.kind === 'structure' && (
                              <button
                                className="grid-beat-unplace"
                                aria-label={`unplace beat ${beat.id}`}
                                title="Send back to tray"
                                onClick={(e) => { e.stopPropagation(); updateBeat(beat.id, { sceneId: null }) }}
                              >×</button>
                            )}
                          </span>
                        ) : (
                          <span className="grid-cell-add">＋</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
