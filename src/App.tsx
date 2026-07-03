import { useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { liveQuery } from 'dexie'
import Sidebar from './components/Sidebar'
import BackupBanner from './components/BackupBanner'
import StorageErrorBanner from './components/StorageErrorBanner'
import SearchModal from './components/SearchModal'
import WikiLinkPopover from './components/WikiLinkPopover'
import HomeRoute from './routes/HomeRoute'
import PageRoute from './routes/PageRoute'
import MapRoute from './routes/MapRoute'
import TemplatesRoute from './routes/TemplatesRoute'
import CategoryRoute from './routes/CategoryRoute'
import TagRoute from './routes/TagRoute'
import GraphRoute from './routes/GraphRoute'
import TimelineRoute from './routes/TimelineRoute'
import LoreSelectorRoute from './routes/LoreSelectorRoute'
import SettingsRoute from './routes/SettingsRoute'
import ManuscriptRoute from './routes/ManuscriptRoute'
import BookRoute from './routes/BookRoute'
import { requestPersistentStorage } from './backup'
import { seedTemplates, seedDefaultCalendar, pageRepo } from './db'
import { maybeTakeSnapshot } from './snapshots'
import { syncIndex } from './search'
import { bootstrapDefaultLore } from './lores'
import { installStorageErrorListener } from './storageError'
import { shouldOpenSearch } from './searchShortcut'

export default function App() {
  const location = useLocation()
  const [searchOpen, setSearchOpen] = useState(false)
  const contentRef = useRef<HTMLElement>(null)
  const [showTop, setShowTop] = useState(false)

  // Reset the scroll container to the top whenever the route path changes.
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [location.pathname])

  // Open search from anywhere: Ctrl/Cmd+K always, `/` when not typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldOpenSearch(e, e.target)) {
        e.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    installStorageErrorListener() // surface IndexedDB quota/eviction write failures
    bootstrapDefaultLore()
    requestPersistentStorage()
    seedTemplates()
    seedDefaultCalendar()
    maybeTakeSnapshot()
  }, [])

  // Keep the FlexSearch index in sync as pages change. The liveQuery emits the whole
  // table on every edit, but syncIndex only re-indexes the deltas (see search.ts) —
  // the first emission builds, later ones apply just the changed/added/removed pages.
  useEffect(() => {
    const sub = liveQuery(() => pageRepo.list()).subscribe((pages) => {
      syncIndex(pages)
    })
    return () => sub.unsubscribe()
  }, [])

  // Lore selector: full-screen, no sidebar/overlays (but still surface storage errors)
  if (location.pathname === '/') {
    return (
      <>
        <StorageErrorBanner />
        <LoreSelectorRoute />
      </>
    )
  }

  // All other routes: existing sidebar shell
  return (
    <div className="app-shell">
      <StorageErrorBanner />
      <Sidebar onOpenSearch={() => setSearchOpen(true)} />
      <main className="content" ref={contentRef} onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 600)}>
        <BackupBanner />
        <div className="route-fade" key={location.pathname}>
          <Routes>
            <Route path="/home" element={<HomeRoute />} />
            <Route path="/page/:id" element={<PageRoute />} />
            <Route path="/map" element={<MapRoute />} />
            <Route path="/graph" element={<GraphRoute />} />
            <Route path="/timeline" element={<TimelineRoute />} />
            <Route path="/templates" element={<TemplatesRoute />} />
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="/manuscript" element={<ManuscriptRoute />} />
            <Route path="/book/:bookId" element={<BookRoute />} />
            <Route path="/browse/:category" element={<CategoryRoute />} />
            <Route path="/tag/:tag" element={<TagRoute />} />
          </Routes>
        </div>
        {showTop && (
          <button
            className="back-to-top"
            aria-label="Back to top"
            onClick={() => contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            ↑
          </button>
        )}
      </main>
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} />}
      <WikiLinkPopover />
    </div>
  )
}
