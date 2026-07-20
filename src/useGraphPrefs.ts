import { useCallback, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getMeta, setMeta } from './db'
import type { ColorBy } from './graphColor'
import type { TagMode } from './tagFilter'

const VIEW_KEY = 'graph-view'
const PINS_KEY = 'graph-pins'

/** Camera transform: zoom level `k` plus the graph-space coordinates centred in
 *  the viewport. Matches what react-force-graph's `onZoomEnd` reports and what
 *  `zoom()`/`centerAt()` consume to restore it. */
export interface GraphCam {
  k: number
  x: number
  y: number
}

interface SavedView {
  hidden: string[]
  hiddenStatuses: string[]
  showArrows: boolean
  showGhosts: boolean
  threeD: boolean
  panelOpen: boolean
  /** Legacy single-tag filter, read-migrated into `tags` and dropped on the
   *  next write. Never written by current code. */
  tag?: string
  /** Selected tag filter; empty means "all tags". */
  tags: string[]
  /** How a multi-tag selection combines. */
  tagMode: TagMode
  /** Hide nodes with fewer than this many connections (0 = show all). */
  minDegree: number
  /** When a node is selected, show only nodes within this many hops (0 = off). */
  depth: number
  /** Which dimension drives node colour: page type, status, or a highlighted tag. */
  colorBy: ColorBy
  cam: GraphCam | null
}

type Pins = Record<string, { x: number; y: number }>

// Stable fallback identities so consumers' useMemo deps don't bust every render
// while nothing is stored.
const DEFAULT_VIEW: SavedView = {
  hidden: [],
  hiddenStatuses: [],
  showArrows: false,
  showGhosts: true,
  threeD: false,
  panelOpen: false,
  tags: [],
  tagMode: 'any',
  minDegree: 0,
  depth: 0,
  colorBy: 'type',
  cam: null,
}
const NO_PINS: Pins = {}

export interface GraphPrefs {
  hidden: Set<string>
  toggleCategory: (cat: string) => void
  hiddenStatuses: Set<string>
  toggleStatus: (status: string) => void
  showArrows: boolean
  setShowArrows: (v: boolean) => void
  showGhosts: boolean
  setShowGhosts: (v: boolean) => void
  threeD: boolean
  setThreeD: (v: boolean) => void
  panelOpen: boolean
  setPanelOpen: (v: boolean) => void
  tags: string[]
  setTags: (tags: string[]) => void
  toggleTag: (tag: string) => void
  tagMode: TagMode
  setTagMode: (m: TagMode) => void
  minDegree: number
  setMinDegree: (v: number) => void
  depth: number
  setDepth: (v: number) => void
  colorBy: ColorBy
  setColorBy: (v: ColorBy) => void
  cam: GraphCam | null
  setCam: (c: GraphCam) => void
  pins: Pins
  pinNode: (id: string, x: number, y: number) => void
  clearPins: () => void
  prunePins: (validIds: Set<string>) => void
}

/** Fold a row written before multi-tag filtering into the current shape. Safe
 *  to run on every hydrate: once a migrated row is written back, `tag` is gone
 *  and this is a no-op. An explicit `tags` selection always wins. */
export function migrateView(view: SavedView): SavedView {
  if (view.tags.length > 0 || !view.tag) return view
  const next: SavedView = { ...view, tags: [view.tag] }
  delete next.tag
  return next
}

export function useGraphPrefs(): GraphPrefs {
  // Read the persisted rows reactively. getMeta returns undefined both while
  // loading and when no row exists — both collapse to defaults below, and we
  // never write on load, so a stored row is never clobbered by defaults.
  const savedView = useLiveQuery(() => getMeta<SavedView>(VIEW_KEY), [])
  const savedPins = useLiveQuery(() => getMeta<Pins>(PINS_KEY), [])

  // Local overrides layered on top of the persisted values; null until the user
  // acts, after which the draft reflects intent immediately (the liveQuery also
  // re-fires after each write and converges to the same value).
  const [viewDraft, setViewDraft] = useState<SavedView | null>(null)
  const [pinsDraft, setPinsDraft] = useState<Pins | null>(null)

  const view = useMemo(
    () => viewDraft ?? (savedView ? migrateView({ ...DEFAULT_VIEW, ...savedView }) : DEFAULT_VIEW),
    [viewDraft, savedView],
  )
  const pins = pinsDraft ?? savedPins ?? NO_PINS

  const writeView = useCallback((next: SavedView) => {
    setViewDraft(next)
    setMeta(VIEW_KEY, next)
  }, [])

  const writePins = useCallback((next: Pins) => {
    setPinsDraft(next)
    setMeta(PINS_KEY, next)
  }, [])

  const hidden = useMemo(() => new Set(view.hidden), [view.hidden])
  const hiddenStatuses = useMemo(() => new Set(view.hiddenStatuses), [view.hiddenStatuses])

  const toggleCategory = useCallback((cat: string) => {
    const next = new Set(view.hidden)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    writeView({ ...view, hidden: [...next] })
  }, [view, writeView])

  const toggleStatus = useCallback((status: string) => {
    const next = new Set(view.hiddenStatuses)
    if (next.has(status)) next.delete(status)
    else next.add(status)
    writeView({ ...view, hiddenStatuses: [...next] })
  }, [view, writeView])

  const setShowArrows = useCallback((v: boolean) => writeView({ ...view, showArrows: v }), [view, writeView])
  const setShowGhosts = useCallback((v: boolean) => writeView({ ...view, showGhosts: v }), [view, writeView])
  const setThreeD = useCallback((v: boolean) => writeView({ ...view, threeD: v }), [view, writeView])
  const setPanelOpen = useCallback((v: boolean) => writeView({ ...view, panelOpen: v }), [view, writeView])
  const setTags = useCallback((v: string[]) => writeView({ ...view, tags: v }), [view, writeView])
  const setTagMode = useCallback((v: TagMode) => writeView({ ...view, tagMode: v }), [view, writeView])

  const toggleTag = useCallback((tag: string) => {
    const next = view.tags.includes(tag)
      ? view.tags.filter((t) => t !== tag)
      : [...view.tags, tag]
    writeView({ ...view, tags: next })
  }, [view, writeView])

  const setMinDegree = useCallback((v: number) => writeView({ ...view, minDegree: v }), [view, writeView])
  const setDepth = useCallback((v: number) => writeView({ ...view, depth: v }), [view, writeView])
  const setColorBy = useCallback((v: ColorBy) => writeView({ ...view, colorBy: v }), [view, writeView])
  const setCam = useCallback((c: GraphCam) => writeView({ ...view, cam: c }), [view, writeView])

  const pinNode = useCallback((id: string, x: number, y: number) => {
    writePins({ ...pins, [id]: { x, y } })
  }, [pins, writePins])

  const clearPins = useCallback(() => writePins({}), [writePins])

  const prunePins = useCallback((validIds: Set<string>) => {
    let changed = false
    const next: Pins = {}
    for (const [id, pos] of Object.entries(pins)) {
      if (validIds.has(id)) next[id] = pos
      else changed = true
    }
    if (changed) writePins(next)
  }, [pins, writePins])

  return {
    hidden, toggleCategory,
    hiddenStatuses, toggleStatus,
    showArrows: view.showArrows, setShowArrows,
    showGhosts: view.showGhosts, setShowGhosts,
    threeD: view.threeD, setThreeD,
    panelOpen: view.panelOpen, setPanelOpen,
    tags: view.tags, setTags, toggleTag, tagMode: view.tagMode, setTagMode,
    minDegree: view.minDegree, setMinDegree,
    depth: view.depth, setDepth,
    colorBy: view.colorBy, setColorBy,
    cam: view.cam, setCam,
    pins, pinNode, clearPins, prunePins,
  }
}
