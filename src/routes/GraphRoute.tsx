import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { pageRepo, buildGraphData, categoryColor, statusColor, STATUSES, nodesWithinHops, connectedComponents, findPath, type GraphNode, type LorePage } from '../db'
import { useGraphPrefs } from '../useGraphPrefs'
import { useWikiLinkNavigation } from '../useWikiLinkNavigation'
import GraphView from '../components/GraphView'
import GraphPathControls from '../components/GraphPathControls'
import EmptyState from '../components/EmptyState'
import HubsOrphansPanel from '../components/HubsOrphansPanel'
import ConfirmDialog from '../components/ConfirmDialog'
import { islandColorOf, type ColorBy } from '../graphColor'
import { getLore, currentLoreId } from '../lores'
import { buildScene, sceneToSvg, svgBlob, sceneToPng, downloadBlob, graphFilename } from '../graphExport'
import { NO_TAG_FILTER, type TagFilter } from '../tagFilter'

// The 3D view drags in three.js, so load it only when the user opts in.
const GraphView3D = lazy(() => import('../components/GraphView3D'))

const NO_PAGES: LorePage[] = []
const EMPTY_ISLAND_COLORS = new Map<string, string>()

export default function GraphRoute() {
  const pages = useLiveQuery(() => pageRepo.list(), []) ?? NO_PAGES

  const full = useMemo(() => buildGraphData(pages), [pages])

  const wiki = useWikiLinkNavigation()
  const {
    hidden, toggleCategory,
    hiddenStatuses, toggleStatus,
    showArrows, setShowArrows,
    showGhosts, setShowGhosts,
    threeD, setThreeD,
    panelOpen, setPanelOpen,
    tag, setTag,
    colorBy, setColorBy,
    minDegree, setMinDegree,
    depth, setDepth,
    cam, setCam,
    pins, pinNode, clearPins, prunePins,
  } = useGraphPrefs()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Path endpoints are deliberately NOT persisted in useGraphPrefs: a stored path
  // would resurrect a stale highlight on a later visit, pointing at pages that may
  // since have been deleted.
  const [fromId, setFromId] = useState<string | null>(null)
  const [toId, setToId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const lore = useLiveQuery(() => getLore(currentLoreId()), [])
  const loreName = lore?.name ?? 'World'

  // All categories / tags present in the data, for the toolbar controls.
  // Exclude ghost nodes so the filter chips only show real page categories/tags.
  const categories = useMemo(
    () => [...new Set(full.nodes.filter((n) => !n.ghost).map((n) => n.category))].sort((a, b) => a.localeCompare(b)),
    [full],
  )
  const tags = useMemo(
    () => [...new Set(full.nodes.filter((n) => !n.ghost).flatMap((n) => n.tags))].sort((a, b) => a.localeCompare(b)),
    [full],
  )
  // Highest connection count present, so the min-degree slider caps at something
  // meaningful (and hides entirely when nothing is connected).
  const maxDegree = useMemo(() => full.nodes.reduce((m, n) => Math.max(m, n.degree), 0), [full])

  // The depth filter only bites when a node is selected. Deriving the focus id
  // this way keeps `filtered` from recomputing (and reheating the sim) on every
  // selection while depth is 0 — the id only enters the dep array once depth > 0.
  const depthFocus = depth > 0 ? selectedId : null

  // Statuses actually present, kept in the canonical Stub→Draft→Complete order.
  const statuses = useMemo(() => {
    const present = new Set(full.nodes.filter((n) => !n.ghost).map((n) => n.status))
    return STATUSES.map((s) => s.name).filter((name) => present.has(name))
  }, [full])

  const filtered = useMemo(() => {
    const hopSet = depthFocus ? nodesWithinHops(full.links, depthFocus, depth) : null
    const nodes = full.nodes.filter(
      (n) =>
        (showGhosts || !n.ghost) &&
        !hidden.has(n.category) &&
        (n.ghost || !hiddenStatuses.has(n.status)) &&
        (colorBy === 'tag' || tag === '' || n.tags.includes(tag)) &&
        n.degree >= minDegree &&
        (hopSet == null || hopSet.has(n.id)),
    )
    const visible = new Set(nodes.map((n) => n.id))
    const links = full.links.filter((l) => visible.has(l.source) && visible.has(l.target))
    return {
      nodes: nodes.map((n) => ({ ...n })),
      links: links.map((l) => ({ ...l })),
    }
  }, [full, hidden, hiddenStatuses, tag, showGhosts, minDegree, depth, depthFocus, colorBy])

  // A page can be deleted while its id still sits in an endpoint; drop it by
  // derivation rather than by writing state from an effect.
  const liveIds = useMemo(() => new Set(full.nodes.map((n) => n.id)), [full])
  const fromValid = fromId && liveIds.has(fromId) ? fromId : null
  const toValid = toId && liveIds.has(toId) ? toId : null

  const pathResult = useMemo(() => {
    if (!fromValid || !toValid || fromValid === toValid) return null
    return findPath(filtered.links, full.links, fromValid, toValid)
  }, [filtered.links, full.links, fromValid, toValid])

  const path = pathResult?.kind === 'path' ? pathResult.nodes : null

  // Seed pinned positions imperatively rather than through the `filtered` memo,
  // so a live drag (which updates `pins`) doesn't recreate the graph data and
  // reheat the whole simulation. The running sim reads fx/fy off these same node
  // objects on its next tick; on a filter change `filtered` is rebuilt fresh and
  // this re-applies the pins. Restore-on-load works the same way once pins load.
  useEffect(() => {
    for (const n of filtered.nodes) {
      const pin = pins[n.id]
      if (pin) {
        const node = n as GraphNode & { fx?: number; fy?: number }
        // eslint-disable-next-line react-hooks/immutability
        node.fx = pin.x
        node.fy = pin.y
      }
    }
  }, [filtered, pins])

  // Drop saved pins for pages that no longer exist.
  useEffect(() => {
    if (full.nodes.length > 0) prunePins(new Set(full.nodes.map((n) => n.id)))
  }, [full, prunePins])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return filtered.nodes
      .filter((n) => n.title.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, filtered])

  const hubs = useMemo(
    () => [...filtered.nodes].sort((a, b) => b.degree - a.degree).slice(0, 10).filter((n) => n.degree > 0),
    [filtered],
  )
  const isolated = useMemo(
    () => filtered.nodes.filter((n) => n.degree === 0).sort((a, b) => a.title.localeCompare(b.title)),
    [filtered],
  )

  // Connected-component colouring for island mode. Computed over the *filtered*
  // graph (what's actually drawn) so it respects ghost/category/tag/degree
  // filters, and only when island mode is active — other modes get a stable
  // empty map so the renderer prop identity doesn't churn.
  const { islandColors, clusterCount } = useMemo(() => {
    if (colorBy !== 'island') return { islandColors: EMPTY_ISLAND_COLORS, clusterCount: 0 }
    const { componentOf, sizes } = connectedComponents(filtered.nodes.map((n) => n.id), filtered.links)
    return {
      islandColors: islandColorOf(componentOf, sizes),
      clusterCount: sizes.filter((s) => s >= 2).length,
    }
  }, [colorBy, filtered])

  function selectNode(id: string) {
    setSelectedId(null)
    // Defer so the GraphView effect sees a real change and re-glides.
    requestAnimationFrame(() => setSelectedId(id))
  }

  // Temporary bridge while `tag` is still a single string; Task 5 replaces this
  // with the real multi-tag selection from useGraphPrefs.
  const tagFilter = useMemo<TagFilter>(() => (tag ? { tags: [tag], mode: 'any' } : NO_TAG_FILTER), [tag])

  async function doExport(format: 'png' | 'svg') {
    setExportMsg(null)
    const scene = buildScene(filtered, { colorBy, tagFilter, islandColors })
    if (!scene) {
      setExportMsg('Graph still settling — try again')
      return
    }
    try {
      const filename = graphFilename(loreName, format)
      if (format === 'svg') {
        downloadBlob(svgBlob(sceneToSvg(scene)), filename)
      } else {
        downloadBlob(await sceneToPng(scene), filename)
      }
    } catch {
      setExportMsg(
        format === 'png'
          ? 'PNG export failed — the graph may be too large; try SVG.'
          : 'Export failed — try again',
      )
    }
  }

  if (pages.length === 0) {
    return (
      <EmptyState
        icon="🕸️"
        title="No connections to map yet"
        message={<>Create some pages and link them with <code>[[wiki links]]</code> to see your world take shape here.</>}
      />
    )
  }

  return (
    <div className="graph-page">
      <div className="graph-toolbar">
        <div className="graph-chips">
          {categories.map((cat) => (
            <button
              key={cat}
              className={`graph-chip${hidden.has(cat) ? ' off' : ''}`}
              style={{ borderColor: categoryColor(cat), color: hidden.has(cat) ? undefined : categoryColor(cat) }}
              onClick={() => toggleCategory(cat)}
            >
              <span className="dot" style={{ background: categoryColor(cat) }} />
              {cat}
            </button>
          ))}
        </div>

        <div className="graph-search">
          <input
            type="text"
            placeholder="Search pages…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('')
              if (e.key === 'Enter' && matches.length > 0) {
                selectNode(matches[0].id)
                setQuery('')
              }
            }}
          />
          {matches.length > 0 && (
            <ul className="graph-search-results">
              {matches.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      selectNode(n.id)
                      setQuery('')
                    }}
                  >
                    <span className="dot" style={{ background: categoryColor(n.category) }} />
                    {n.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select value={tag} onChange={(e) => setTag(e.target.value)}>
          <option value="">All tags</option>
          {tags.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>

        <label className="graph-slider" title="Colour nodes by page type, status, a highlighted tag, or connected island">
          Color by
          <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)}>
            <option value="type">Type</option>
            <option value="status">Status</option>
            <option value="tag">Tag</option>
            <option value="island">Island</option>
          </select>
        </label>

        {statuses.length > 1 && (
          <div className="graph-chips">
            {statuses.map((s) => (
              <button
                key={s}
                className={`graph-chip${hiddenStatuses.has(s) ? ' off' : ''}`}
                style={{ borderColor: statusColor(s), color: hiddenStatuses.has(s) ? undefined : statusColor(s) }}
                onClick={() => toggleStatus(s)}
              >
                <span className="dot" style={{ background: statusColor(s) }} />
                {s}
              </button>
            ))}
          </div>
        )}

        {maxDegree > 0 && (
          <>
            <label className="graph-slider" title="Hide nodes with fewer connections">
              Min links
              <input
                type="range"
                min={0}
                max={maxDegree}
                value={Math.min(minDegree, maxDegree)}
                onChange={(e) => setMinDegree(Number(e.target.value))}
              />
              <span className="graph-slider-val">{minDegree}</span>
            </label>

            <label
              className="graph-slider"
              title="Show only nodes within N hops of the selected node"
            >
              Depth
              <input
                type="range"
                min={0}
                max={6}
                value={depth}
                onChange={(e) => setDepth(Number(e.target.value))}
              />
              <span className="graph-slider-val">{depth === 0 ? 'off' : `${depth} hop${depth > 1 ? 's' : ''}`}</span>
            </label>
          </>
        )}

        <button
          className={`ghost-btn${showArrows ? ' active' : ''}`}
          onClick={() => setShowArrows(!showArrows)}
        >
          {showArrows ? '➜ Arrows on' : '➜ Arrows off'}
        </button>

        <button
          className={`ghost-btn${threeD ? ' active' : ''}`}
          onClick={() => setThreeD(!threeD)}
        >
          {threeD ? '🧊 3D on' : '🧊 3D off'}
        </button>

        <button
          className={`ghost-btn${showGhosts ? ' active' : ''}`}
          onClick={() => setShowGhosts(!showGhosts)}
        >
          {showGhosts ? '👻 Ghosts on' : '👻 Ghosts off'}
        </button>

        {Object.keys(pins).length > 0 && (
          <button className="ghost-btn" onClick={clearPins}>
            ⤺ Reset layout
          </button>
        )}

        {!threeD && filtered.nodes.length > 0 && (
          <details
            className="graph-export"
            onToggle={(e) => {
              if (!(e.currentTarget as HTMLDetailsElement).open) setExportMsg(null)
            }}
          >
            <summary className="ghost-btn">⬇ Export</summary>
            <div className="graph-export-menu">
              <button
                onClick={(e) => {
                  ;(e.currentTarget.closest('details') as HTMLDetailsElement).open = false
                  doExport('png')
                }}
              >
                PNG image
              </button>
              <button
                onClick={(e) => {
                  ;(e.currentTarget.closest('details') as HTMLDetailsElement).open = false
                  doExport('svg')
                }}
              >
                SVG vector
              </button>
              {exportMsg && <p className="graph-export-msg">{exportMsg}</p>}
            </div>
          </details>
        )}

        <button
          className={`ghost-btn${panelOpen ? ' active' : ''}`}
          onClick={() => setPanelOpen(!panelOpen)}
        >
          {panelOpen ? '☰ Hide lists' : '☰ Hubs & isolated'}
        </button>

        {!threeD && (
          <GraphPathControls
            fromId={fromValid}
            toId={toValid}
            onFrom={setFromId}
            onTo={setToId}
            result={pathResult}
          />
        )}

        <span className="graph-hint">
          {filtered.nodes.length} pages · {filtered.links.length} links
          {depth > 0 && !selectedId && ' — select a node to apply depth'}
          {filtered.nodes.length > 300 && ' — filter by type or tag to declutter'}
          {colorBy === 'tag' && tag === '' && ' — select a tag to highlight'}
          {colorBy === 'island' && ` — ${clusterCount} island${clusterCount === 1 ? '' : 's'}`}
        </span>
      </div>

      <div className="graph-body">
        <div className="graph-canvas">
          {threeD ? (
            <Suspense fallback={<div className="graph-3d-loading">Loading 3D view…</div>}>
              <GraphView3D
                data={filtered}
                showArrows={showArrows}
                colorBy={colorBy}
                tagFilter={tagFilter}
                islandColors={islandColors}
                onGhostClick={wiki.stageCreate}
              />
            </Suspense>
          ) : (
            <GraphView
              data={filtered}
              showArrows={showArrows}
              colorBy={colorBy}
              tagFilter={tagFilter}
              islandColors={islandColors}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onGhostClick={wiki.stageCreate}
              onPinNode={pinNode}
              initialCam={cam}
              onCamChange={setCam}
              path={path}
            />
          )}
        </div>
        {panelOpen && (
          <HubsOrphansPanel hubs={hubs} isolated={isolated} onSelect={selectNode} />
        )}
      </div>

      <ConfirmDialog
        open={wiki.pendingTitle !== null}
        title="Create page?"
        confirmLabel="Create"
        onConfirm={wiki.confirmCreate}
        onCancel={wiki.cancelCreate}
      >
        "{wiki.pendingTitle}" doesn't exist yet. Create it?
      </ConfirmDialog>
    </div>
  )
}
