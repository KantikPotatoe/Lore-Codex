import { useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo } from '../db'
import BrowseGrid from '../components/BrowseGrid'

const NO_PAGES: import('../db').LorePage[] = []

export default function TagRoute() {
  const { tag = '' } = useParams<{ tag: string }>()

  const pages = useLiveQuery(() => pageRepo.listByTag(tag), [tag]) ?? NO_PAGES

  return (
    <BrowseGrid
      title={`#${tag}`}
      glyph="🏷️"
      pages={pages}
      empty={{
        icon: '🏷️',
        title: `No pages tagged #${tag}`,
        message: 'Add this tag to a page to see it listed here.',
      }}
    />
  )
}
