import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import BackupBanner from './components/BackupBanner'
import StorageErrorBanner from './components/StorageErrorBanner'
import UpdateBanner from './components/UpdateBanner'
import { UpdateCheckProvider } from './UpdateCheckContext'
import TabSyncOverlay from './components/TabSyncOverlay'
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
import HealthRoute from './routes/HealthRoute'
// Code-split the heaviest routes out of the entry chunk (#188): Map pulls in
// Leaflet + leaflet-draw, Graph pulls in react-force-graph-2d, Book pulls in
// JSZip (EPUB). They load on first navigation instead of at every startup.
const MapRoute = lazy(() => import('./routes/MapRoute'))
const GraphRoute = lazy(() => import('./routes/GraphRoute'))
const BookRoute = lazy(() => import('./routes/BookRoute'))
import { requestPersistentStorage, latestChangeTime, shouldBackupOnExit, backupOnExit, LAST_BACKUP_KEY } from './backup'
import { seedTemplates, seedDefaultCalendar, migrateInlineBodyImages, activeLoreId, getMeta } from './db'
import { maybeTakeSnapshot } from './snapshots'
import { installSearchIndex } from './searchSync'
import { bootstrapDefaultLore } from './lores'
import { installStorageErrorListener } from './storageError'
import { installTabSyncListener } from './tabSync'
import { shouldOpenSearch } from './searchShortcut'
import { useNavDirection } from './navDirection'
import { onCloseRequested } from './platform'
import { getAppSettings } from './appSettings'

// onCloseRequested awaits its handler before destroying the window (platform.ts),
// and only catches a *rejected* handler — a backup that hangs (e.g. a stalled
// filesystem write) would never resolve and would trap the user in an unclosable
// app. Racing against a timeout guarantees the window always closes; losing an
// exit-backup is acceptable, an app you cannot quit is not.
//
// Accepted trade-off: if the timeout wins, win.destroy() can fire while
// writeAppData's writeTextFile is mid-write, leaving a truncated exit-<Day>.json
// that looks valid by its name. This is deliberately not guarded against — it
// fails loudly at restore (parseBackup throws on the truncated JSON) rather
// than corrupting anything silently, and a write-to-temp-then-rename fix would
// need an fs permission (temp-file write/rename outside the final path) this
// branch refuses to add for a backup that's already a secondary safety net.
function withTimeout(promise: Promise<void>, ms: number): Promise<void> {
  return Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms))])
}

export default function App() {
  const location = useLocation()
  const navDir = useNavDirection()
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
    installTabSyncListener(activeLoreId) // freeze on another tab's import/delete of this world
    bootstrapDefaultLore()
    requestPersistentStorage()
    seedTemplates()
    seedDefaultCalendar()
    // Convert any legacy inline body images to the by-ref model (#182 phase 2),
    // then snapshot — runs once per world (guarded by a meta flag), idempotent.
    migrateInlineBodyImages().finally(() => maybeTakeSnapshot())
  }, [])

  // Keep the search index in sync as any searchable table changes. installSearchIndex
  // owns one liveQuery per table and re-indexes only deltas (see searchSync.ts).
  useEffect(() => {
    const teardown = installSearchIndex()
    return teardown
  }, [])

  // Desktop only: finish a backup before the window closes. Everything is read
  // *inside* the handler, at exit time — a value captured now would be stale by
  // the time the user actually quits.
  useEffect(() => {
    let dispose: (() => void) | undefined
    let cancelled = false
    onCloseRequested(async () => {
      await withTimeout(
        (async () => {
          const { backupOnExit: enabled } = await getAppSettings()
          const lastBackup = (await getMeta<number>(LAST_BACKUP_KEY)) ?? null
          if (shouldBackupOnExit(enabled, lastBackup, await latestChangeTime())) {
            await backupOnExit()
          }
        })(),
        5000,
      )
    }).then((off) => {
      if (cancelled) off()
      else dispose = off
    })
    return () => {
      cancelled = true
      dispose?.()
    }
  }, [])

  // Lore selector: full-screen, no sidebar/overlays (but still surface storage errors)
  if (location.pathname === '/') {
    return (
      <>
        <StorageErrorBanner />
        <TabSyncOverlay />
        <LoreSelectorRoute />
      </>
    )
  }

  // All other routes: existing sidebar shell
  // The provider wraps the whole shell so the banner and the routed
  // SettingsRoute share ONE update state machine. Two instances would each
  // hold their own plugin handle, letting the banner dismiss a version that
  // the other instance had already downloaded — stranding the installer.
  return (
    <UpdateCheckProvider>
      <div className="app-shell">
        <StorageErrorBanner />
        <TabSyncOverlay />
        <Sidebar onOpenSearch={() => setSearchOpen(true)} />
        <main className="content" ref={contentRef} onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 600)}>
          <UpdateBanner />
          <BackupBanner />
          <div className="route-fade" data-nav={navDir} key={location.pathname}>
            <Suspense fallback={<div className="content-pad">Loading…</div>}>
              <Routes>
                <Route path="/home" element={<HomeRoute />} />
                <Route path="/page/:id" element={<PageRoute />} />
                <Route path="/map" element={<MapRoute />} />
                <Route path="/graph" element={<GraphRoute />} />
                <Route path="/health" element={<HealthRoute />} />
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
    </UpdateCheckProvider>
  )
}
