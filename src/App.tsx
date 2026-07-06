import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { liveQuery } from 'dexie'
import Sidebar from './components/Sidebar'
import BackupBanner from './components/BackupBanner'
import StorageErrorBanner from './components/StorageErrorBanner'
import SearchModal from './components/SearchModal'
import WikiLinkPopover from './components/WikiLinkPopover'
import HomeRoute from './routes/HomeRoute'
import PageRoute from './routes/PageRoute'
import TemplatesRoute from './routes/TemplatesRoute'
import CategoryRoute from './routes/CategoryRoute'
import TagRoute from './routes/TagRoute'
import TimelineRoute from './routes/TimelineRoute'
import LoreSelectorRoute from './routes/LoreSelectorRoute'
import SettingsRoute from './routes/SettingsRoute'
import ManuscriptRoute from './routes/ManuscriptRoute'
// Code-split the heaviest routes out of the entry chunk (#188): Map pulls in
// Leaflet + leaflet-draw, Graph pulls in react-force-graph-2d, Book pulls in
// JSZip (EPUB). They load on first navigation instead of at every startup.
const MapRoute = lazy(() => import('./routes/MapRoute'))
const GraphRoute = lazy(() => import('./routes/GraphRoute'))
const BookRoute = lazy(() => import('./routes/BookRoute'))
import { requestPersistentStorage } from './backup'
import { seedTemplates, seedDefaultCalendar, migrateInlineBodyImages, pageRepo } from './db'
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
    // Convert any legacy inline body images to the by-ref model (#182 phase 2),
    // then snapshot — runs once per world (guarded by a meta flag), idempotent.
    migrateInlineBodyImages().finally(() => maybeTakeSnapshot())
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
          <Suspense fallback={<div className="content-pad">Loading…</div>}>
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
          </Suspense>
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
