import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateBook } from '../db'
import BookWriteView from '../components/manuscript/BookWriteView'
import BookGridView from '../components/manuscript/BookGridView'
import { exportBookEpub, printBook } from '../manuscriptExport'

export default function BookRoute() {
  const { bookId } = useParams<{ bookId: string }>()
  const [view, setView] = useState<'write' | 'grid'>('write')
  const [searchParams, setSearchParams] = useSearchParams()
  const book = useLiveQuery(() => (bookId ? db.books.get(bookId) : undefined), [bookId])

  const selectedSceneId = searchParams.get('scene')
  function selectScene(id: string | null) {
    setSearchParams(id ? { scene: id } : {}, { replace: true })
  }

  if (!bookId) return null

  return (
    <div className="book-workspace">
      <div className="book-head">
        <input
          className="page-title book-title-input"
          aria-label="Book title"
          value={book?.title ?? ''}
          placeholder="Untitled Book"
          disabled={!book}
          onChange={(e) => updateBook(bookId, { title: e.target.value })}
        />
        <div className="seg-control">
          <button className={view === 'write' ? 'seg active' : 'seg'} onClick={() => setView('write')}>Write</button>
          <button className={view === 'grid' ? 'seg active' : 'seg'} onClick={() => setView('grid')}>Grid</button>
        </div>
        <div className="book-compile">
          <button className="ghost-btn" onClick={() => exportBookEpub(bookId)}>EPUB</button>
          <button className="ghost-btn" onClick={() => printBook(bookId)}>Print / PDF</button>
        </div>
      </div>
      {view === 'write' ? (
        <BookWriteView bookId={bookId} selectedSceneId={selectedSceneId} onSelectScene={selectScene} />
      ) : (
        <BookGridView bookId={bookId} />
      )}
    </div>
  )
}
