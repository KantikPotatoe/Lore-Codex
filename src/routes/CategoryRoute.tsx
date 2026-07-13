import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { templateRepo, pageRepo, categoryColor } from '../db'
import BrowseGrid from '../components/BrowseGrid'

const NO_PAGES: import('../db').LorePage[] = []

export default function CategoryRoute() {
  const { category = '' } = useParams<{ category: string }>()
  const navigate = useNavigate()

  const pages =
    useLiveQuery(() => pageRepo.listByCategory(category), [category]) ?? NO_PAGES
  const templates = useLiveQuery(() => templateRepo.list(), []) ?? []
  const glyph = templates.find((t) => t.name === category)?.icon

  async function handleNew() {
    const id = await pageRepo.create({ category })
    navigate(`/page/${id}`)
  }

  return (
    <BrowseGrid
      title={category}
      titleColor={categoryColor(category)}
      glyph={glyph}
      action={
        <button className="primary-btn" onClick={handleNew}>
          + New {category}
        </button>
      }
      pages={pages}
      empty={{
        icon: '📭',
        title: `No ${category} pages yet`,
        message: `Use “+ New ${category}” above to create the first one.`,
      }}
    />
  )
}
