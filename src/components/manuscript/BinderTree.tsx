import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db, createChapter, createScene, updateChapter, sceneStatusColor,
  type Chapter, type Scene,
} from '../../db'

interface BinderTreeProps {
  bookId: string
  selectedSceneId: string | null
  onSelectScene: (id: string) => void
}

const NO_CHAPTERS: Chapter[] = []
const NO_SCENES: Scene[] = []

export default function BinderTree({ bookId, selectedSceneId, onSelectScene }: BinderTreeProps) {
  const chapters = useLiveQuery(
    () => db.chapters.where('bookId').equals(bookId).sortBy('order'),
    [bookId],
  ) ?? NO_CHAPTERS
  const scenes = useLiveQuery(
    () => db.scenes.where('bookId').equals(bookId).sortBy('order'),
    [bookId],
  ) ?? NO_SCENES

  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  function startEdit(ch: Chapter) {
    setEditingId(ch.id)
    setDraft(ch.title)
  }

  function commitEdit() {
    if (!editingId) return
    const title = draft.trim()
    if (title) updateChapter(editingId, { title })
    setEditingId(null)
  }

  const scenesByChapter = useMemo(() => {
    const map = new Map<string, Scene[]>()
    for (const s of scenes) {
      const list = map.get(s.chapterId) ?? []
      list.push(s)
      map.set(s.chapterId, list)
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order)
    return map
  }, [scenes])

  return (
    <div className="binder">
      {chapters.map((ch) => (
        <div key={ch.id} className="binder-chapter">
          <div className="binder-chapter-head">
            {editingId === ch.id ? (
              <input
                className="binder-chapter-title-input"
                aria-label="Chapter title"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit()
                  else if (e.key === 'Escape') setEditingId(null)
                }}
              />
            ) : (
              <span
                className="binder-chapter-title"
                title="Double-click to rename"
                onDoubleClick={() => startEdit(ch)}
              >{ch.title}</span>
            )}
            <button
              className="binder-add"
              title="Add scene"
              onClick={() => createScene(bookId, ch.id, 'New scene')}
            >＋ Scene</button>
          </div>
          {(scenesByChapter.get(ch.id) ?? []).map((sc) => (
            <button
              key={sc.id}
              className={sc.id === selectedSceneId ? 'binder-scene active' : 'binder-scene'}
              onClick={() => onSelectScene(sc.id)}
            >
              <span className="status-pip" style={{ background: sceneStatusColor(sc.status) }} />
              <span className="binder-scene-title">{sc.title}</span>
              <span className="binder-scene-words">{sc.wordCount || ''}</span>
            </button>
          ))}
        </div>
      ))}
      <button className="binder-add-chapter" onClick={() => createChapter(bookId, 'New chapter')}>
        ＋ Chapter
      </button>
    </div>
  )
}
