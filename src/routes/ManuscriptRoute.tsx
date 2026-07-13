import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Link, useNavigate } from 'react-router-dom'
import { manuscriptRepo, createBook, TYPE_COLORS, type Book, type Scene } from '../db'
import EmptyState from '../components/EmptyState'
import { coverHue } from '../bookCover'

const NO_BOOKS: Book[] = []
const NO_SCENES: Scene[] = []

export default function ManuscriptRoute() {
  const navigate = useNavigate()
  const books = useLiveQuery(() => manuscriptRepo.listBooks(), []) ?? NO_BOOKS
  const scenes = useLiveQuery(() => manuscriptRepo.listAllScenes(), []) ?? NO_SCENES

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
      </div>
      {books.length === 0 ? (
        <EmptyState
          icon="📖"
          title="No books yet"
          message="Your world has a story in it. Start the manuscript that tells it."
        >
          <button className="primary-btn" onClick={handleNew}>＋ New book</button>
        </EmptyState>
      ) : (
        <div className="book-grid">
          {books.map((b, i) => {
            const st = stats.get(b.id) ?? { count: 0, words: 0 }
            return (
              <Link
                key={b.id}
                to={`/book/${b.id}`}
                className="book-card"
                style={{
                  '--stagger-i': Math.min(i, 12),
                  '--cover-hue': coverHue(b.title, TYPE_COLORS),
                } as CSSProperties}
              >
                <span className="book-card-title">{b.title}</span>
                <span className="book-card-rule" aria-hidden="true" />
                <span className="book-card-stats">
                  {st.count} scene{st.count === 1 ? '' : 's'} · {st.words} words
                </span>
                {b.synopsis && <span className="book-card-blurb">{b.synopsis}</span>}
              </Link>
            )
          })}
          <button
            className="book-card-add"
            onClick={handleNew}
            style={{ '--stagger-i': Math.min(books.length, 12) } as CSSProperties}
          >
            <span className="book-card-add-icon" aria-hidden="true">＋</span>
            <span>New book</span>
          </button>
        </div>
      )}
    </div>
  )
}
