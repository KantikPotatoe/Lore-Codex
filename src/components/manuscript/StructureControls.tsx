import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db, applyStructure, removeStructure, updateBeat,
  type Scene, type Plotline, type Beat, type StructureType,
} from '../../db'
import { STRUCTURES } from '../../manuscriptStructures'
import ConfirmDialog from '../ConfirmDialog'

const NO_SCENES: Scene[] = []
const NO_PLOTLINES: Plotline[] = []
const NO_BEATS: Beat[] = []

export default function StructureControls({ bookId }: { bookId: string }) {
  const scenes = useLiveQuery(() => db.scenes.where('bookId').equals(bookId).sortBy('order'), [bookId]) ?? NO_SCENES
  const plotlines = useLiveQuery(() => db.plotlines.where('bookId').equals(bookId).toArray(), [bookId]) ?? NO_PLOTLINES
  const beats = useLiveQuery(() => db.beats.where('bookId').equals(bookId).toArray(), [bookId]) ?? NO_BEATS

  const structureLane = plotlines.find((p) => p.kind === 'structure')
  const unplaced = useMemo(
    () =>
      structureLane
        ? beats.filter((b) => b.plotlineId === structureLane.id && b.sceneId === null).sort((a, b) => a.order - b.order)
        : [],
    [beats, structureLane],
  )

  // Replacing/removing an applied structure loses beat placements — confirmed
  // through the in-app dialog (host confirm() is unreliable in the shell's
  // webview). `pendingPick` holds the choice awaiting confirmation.
  const [pendingPick, setPendingPick] = useState<string | null>(null)

  function applyPick(value: string) {
    if (value === 'none') removeStructure(bookId)
    else applyStructure(bookId, value as StructureType)
  }

  function onPick(value: string) {
    // No structure applied yet ⇒ nothing is lost; apply without ceremony.
    if (!structureLane) {
      if (value !== 'none') applyPick(value)
      return
    }
    setPendingPick(value)
  }

  return (
    <div className="structure-controls">
      <label className="structure-pick">
        <span>Story structure</span>
        <select
          aria-label="Story structure"
          value={structureLane?.structureType ?? 'none'}
          onChange={(e) => onPick(e.target.value)}
        >
          <option value="none">None</option>
          {STRUCTURES.map((s) => (
            <option key={s.type} value={s.type}>{s.name}</option>
          ))}
        </select>
      </label>

      {structureLane && unplaced.length > 0 && (
        <div className="structure-tray">
          <span className="structure-tray-head">Unplaced beats</span>
          {unplaced.map((b) => (
            <div key={b.id} className="structure-tray-beat">
              <span className="structure-tray-label">{b.label}</span>
              <select
                aria-label={`assign beat ${b.label}`}
                value=""
                onChange={(e) => updateBeat(b.id, { sceneId: e.target.value })}
              >
                <option value="" disabled>Assign to scene…</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>{s.title}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={pendingPick !== null}
        danger
        title={pendingPick === 'none' ? 'Remove story structure?' : 'Replace story structure?'}
        confirmLabel={pendingPick === 'none' ? 'Remove' : 'Replace'}
        cancelLabel="Cancel"
        onConfirm={() => {
          if (pendingPick !== null) applyPick(pendingPick)
          setPendingPick(null)
        }}
        onCancel={() => setPendingPick(null)}
      >
        <p>
          {pendingPick === 'none'
            ? 'This removes the story-structure track and its beats.'
            : 'This replaces the current story structure. Beat placements will be reset.'}
        </p>
      </ConfirmDialog>
    </div>
  )
}
