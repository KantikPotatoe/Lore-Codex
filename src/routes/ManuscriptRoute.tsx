import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { db, createBook, type Book, type Scene } from '../db'

const NO_BOOKS: Book[] = []
const NO_SCENES: Scene[] = []

export default function ManuscriptRoute() {
  const navigate = useNavigate()
  const books = useLiveQuery(() => db.books.orderBy('order').toArray(), []) ?? NO_BOOKS
  const scenes = useLiveQuery(() => db.scenes.toArray(), []) ?? NO_SCENES

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; words: number }>()
    for (const s of scenes) {
      const cur = m.get(s.bookId) ?? { count: 0, words: 0 }
      cur.count += 1
      cur.words += s.wordCount
      m.set(s.bookId, cur)
    }
    return m
  }, [scenes])

  async function handleNew() {
    const book = await createBook('Untitled Book')
    navigate(`/book/${book.id}`)
  }

  return (
    <div className="manuscript-page">
      <div className="manuscript-head">
        <h1 className="page-title">Manuscript</h1>
        <button className="primary-btn" onClick={handleNew}>＋ New book</button>
      </div>
      {books.length === 0 ? (
        <p className="empty-hint">No books yet. Start your first manuscript!</p>
      ) : (
        <div className="book-grid">
          {books.map((b, i) => {
            const st = stats.get(b.id) ?? { count: 0, words: 0 }
            return (
              <Link
                key={b.id}
                to={`/book/${b.id}`}
                className="book-card"
                style={{ '--stagger-i': Math.min(i, 12) } as CSSProperties}
              >
                <span className="book-card-title">{b.title}</span>
                {b.synopsis && <span className="book-card-synopsis">{b.synopsis}</span>}
                <span className="book-card-stats">
                  {st.count} scene{st.count === 1 ? '' : 's'} · {st.words} words
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
