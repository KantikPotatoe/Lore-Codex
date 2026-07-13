import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  templateRepo, pageRepo, mapRepo, pinType, regionStyle,
  mapBreadcrumb, ancestorMapIds,
  TYPE_COLORS, type InfoboxTemplate,
} from '../db'
import MapView, { type PinMarkerStyle, type FocusTarget } from '../components/MapView'
import MapPreviewCard from '../components/MapPreviewCard'
import EmptyState from '../components/EmptyState'
import ConfirmDialog from '../components/ConfirmDialog'
import { compressImage } from '../imageUtils'
import { useEscapeKey } from '../useEscapeKey'

export default function MapRoute() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const mapsData = useLiveQuery(() => mapRepo.listMaps(), [])
  const maps = useMemo(() => mapsData ?? [], [mapsData])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [addMode, setAddMode] = useState(false)
  const [selectedPinId, setSelectedPinId] = useState<string | null>(null)
  const [confirmDeleteMap, setConfirmDeleteMap] = useState(false)
  const [drawMode, setDrawMode] = useState(false)
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  // Click selects + previews; the preview's Edit button flips to the edit panel.
  const [panelMode, setPanelMode] = useState<'preview' | 'edit'>('preview')
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null)
  const [showFind, setShowFind] = useState(false)
  const [findQuery, setFindQuery] = useState('')

  const [searchParams] = useSearchParams()
  const focusPinId = searchParams.get('pin')
  const focusRegionId = searchParams.get('region')

  // A deep link (#/map?pin=<id>) switches to that pin's map and selects it.
  // MapView then pans to it. A stale/deleted id is a harmless no-op.
  useEffect(() => {
    if (!focusPinId) return
    let cancelled = false
    mapRepo.getPin(focusPinId).then((pin) => {
      if (cancelled || !pin) return
      setActiveId(pin.mapId)
      setSelectedPinId(pin.id)
      setPanelMode('preview')
    })
    return () => { cancelled = true }
  }, [focusPinId])

  // A deep link (#/map?region=<id>) switches to that region's map and selects it.
  // MapView fits its bounds. A stale/deleted id is a harmless no-op.
  useEffect(() => {
    if (!focusRegionId) return
    let cancelled = false
    mapRepo.getRegion(focusRegionId).then((region) => {
      if (cancelled || !region) return
      setActiveId(region.mapId)
      focusRegion(region.id)
      setPanelMode('preview')
    })
    return () => { cancelled = true }
  }, [focusRegionId])

  // Default to the first map if none chosen yet.
  const currentMap = maps.find((m) => m.id === activeId) ?? maps[0] ?? null
  const mapId = currentMap?.id ?? ''

  const pinsData = useLiveQuery(
    () => mapRepo.listPinsForMap(mapId),
    [mapId],
  )
  const allPagesData = useLiveQuery(() => pageRepo.listByTitle(), [])
  const templatesData = useLiveQuery(() => templateRepo.list(), [])
  // Stable empty-array fallbacks so downstream useMemo deps don't change every render.
  const regionsData = useLiveQuery(
    () => mapRepo.listRegionsForMap(mapId),
    [mapId],
  )
  // All pins/regions across every map — needed to derive the breadcrumb (which
  // portal opens this map) and the cycle-exclusion set for the portal picker.
  const allPinsData = useLiveQuery(() => mapRepo.listPins(), [])
  const allRegionsData = useLiveQuery(() => mapRepo.listRegions(), [])
  const regions = useMemo(() => regionsData ?? [], [regionsData])
  const pins = useMemo(() => pinsData ?? [], [pinsData])
  const allPages = useMemo(() => allPagesData ?? [], [allPagesData])
  const templates = useMemo(() => templatesData ?? [], [templatesData])
  const allPins = useMemo(() => allPinsData ?? [], [allPinsData])
  const allRegions = useMemo(() => allRegionsData ?? [], [allRegionsData])
  // Legend filter: set of type-keys hidden on this map. "" = the Untyped group.
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set())

  const pagesById = useMemo(() => new Map(allPages.map((p) => [p.id, p])), [allPages])
  const templatesByName = useMemo(
    () => new Map(templates.map((t) => [t.name.toLowerCase(), t] as [string, InfoboxTemplate])),
    [templates],
  )

  // Resolve every pin's derived type once.
  const pinTypes = useMemo(
    () => new Map(pins.map((p) => [p.id, pinType(p, pagesById, templatesByName)])),
    [pins, pagesById, templatesByName],
  )

  // Resolve every region's fill + derived type once.
  const regionStyles = useMemo(
    () => new Map(regions.map((r) => [r.id, regionStyle(r, pagesById, templatesByName)])),
    [regions, pagesById, templatesByName],
  )

  // Legend rows: one per distinct derived type present on this map (plus Untyped),
  // counting both pins and regions; toggling a row hides both.
  const legend = useMemo(() => {
    const rows = new Map<string, { key: string; name: string; color: string; icon: string | null; count: number }>()
    const bump = (name: string | null, color: string, icon: string | null) => {
      const key = name ?? ''
      const row = rows.get(key)
      if (row) row.count++
      else rows.set(key, { key, name: name ?? 'Untyped', color, icon, count: 1 })
    }
    for (const p of pins) {
      const t = pinTypes.get(p.id)!
      bump(t.name, t.color, t.icon)
    }
    for (const r of regions) {
      const s = regionStyles.get(r.id)!
      bump(s.type.name, s.type.color, s.type.icon)
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [pins, pinTypes, regions, regionStyles])

  const mapsById = useMemo(() => new Map(maps.map((m) => [m.id, m])), [maps])
  const breadcrumb = useMemo(
    () => mapBreadcrumb(mapId, maps, allPins, allRegions),
    [mapId, maps, allPins, allRegions],
  )
  // Maps a portal on the current map may NOT target (itself + its ancestors).
  const portalExcluded = useMemo(
    () => ancestorMapIds(mapId, allPins, allRegions),
    [mapId, allPins, allRegions],
  )
  const portalTargets = useMemo(
    () => maps.filter((m) => !portalExcluded.has(m.id)),
    [maps, portalExcluded],
  )

  // Pins passed to the map, minus any whose type is hidden.
  const visiblePins = useMemo(
    () => pins.filter((p) => !hiddenTypes.has(pinTypes.get(p.id)?.name ?? '')),
    [pins, pinTypes, hiddenTypes],
  )

  const visibleRegions = useMemo(
    () => regions.filter((r) => !hiddenTypes.has(regionStyles.get(r.id)?.type.name ?? '')),
    [regions, regionStyles, hiddenTypes],
  )

  // Fill colour per region id (only what MapView needs).
  const regionFills = useMemo(() => {
    const m = new Map<string, { color: string; portal?: boolean }>()
    for (const r of regions) {
      m.set(r.id, { color: regionStyles.get(r.id)?.fill ?? '#a0a0a0', portal: !!r.childMapId })
    }
    return m
  }, [regions, regionStyles])

  // Marker styles keyed by pin id (only what MapView needs).
  const pinStyles = useMemo(() => {
    const m = new Map<string, PinMarkerStyle>()
    for (const p of pins) {
      const t = pinTypes.get(p.id)!
      m.set(p.id, { color: t.color, icon: t.icon, portal: !!p.childMapId })
    }
    return m
  }, [pins, pinTypes])

  function toggleType(key: string) {
    setHiddenTypes((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  // Switch the active map, resetting all transient UI (used by the dropdown,
  // breadcrumb, and the "Enter map →" drill-down).
  function switchToMap(id: string) {
    setActiveId(id)
    setSelectedPinId(null)
    setSelectedRegionId(null)
    setAddMode(false)
    setDrawMode(false)
    setHiddenTypes(new Set())
    setFindQuery('')
    setShowFind(false)
    setFocusTarget(null)
    setPanelMode('preview')
  }

  // Select + centre on a pin/region. Bumping nonce re-pans even if it was already
  // selected (incremented in a handler, never during render — purity rule).
  function focusPin(id: string) {
    setSelectedPinId(id)
    setSelectedRegionId(null)
    setPanelMode('preview')
    setFocusTarget((t) => ({ kind: 'pin', id, nonce: (t?.nonce ?? 0) + 1 }))
  }
  function focusRegion(id: string) {
    setSelectedRegionId(id)
    setSelectedPinId(null)
    setPanelMode('preview')
    setFocusTarget((t) => ({ kind: 'region', id, nonce: (t?.nonce ?? 0) + 1 }))
  }

  // Esc backs out of the open map UI one layer at a time (panel → mode), unless
  // the delete-map confirmation owns it.
  useEscapeKey(() => {
    if (showFind) { setShowFind(false); setFindQuery('') }
    else if ((selectedPinId || selectedRegionId) && panelMode === 'edit') setPanelMode('preview')
    else if (selectedPinId) setSelectedPinId(null)
    else if (selectedRegionId) setSelectedRegionId(null)
    else if (addMode) setAddMode(false)
    else if (drawMode) setDrawMode(false)
  }, !confirmDeleteMap)

  // Read from visiblePins so the pin panel closes when its type is filtered out.
  const selectedPin = visiblePins.find((p) => p.id === selectedPinId) ?? null
  const selectedRegion = visibleRegions.find((r) => r.id === selectedRegionId) ?? null

  // What MapView should anchor the overlay to (stable while the selection holds).
  const previewTarget = useMemo<{ kind: 'pin' | 'region'; id: string } | null>(() => {
    if (panelMode !== 'preview') return null
    if (selectedPinId && selectedPin) return { kind: 'pin', id: selectedPinId }
    if (selectedRegionId && selectedRegion) return { kind: 'region', id: selectedRegionId }
    return null
  }, [panelMode, selectedPinId, selectedRegionId, selectedPin, selectedRegion])

  // The card React node, built from already-loaded page data (no new query).
  const previewItem = selectedPin ?? selectedRegion
  const previewCard = panelMode === 'preview' && previewItem ? (() => {
    const page = previewItem.pageId ? pagesById.get(previewItem.pageId) ?? null : null
    const isPortal = !!previewItem.childMapId && mapsById.has(previewItem.childMapId)
    return (
      <MapPreviewCard
        label={previewItem.label}
        page={page}
        isPortal={isPortal}
        onEdit={() => setPanelMode('edit')}
        onOpenPage={previewItem.pageId ? () => navigate(`/page/${previewItem.pageId}`) : undefined}
        onEnterMap={isPortal ? () => switchToMap(previewItem.childMapId!) : undefined}
        onClose={() => { setSelectedPinId(null); setSelectedRegionId(null) }}
      />
    )
  })() : null

  // Find panel: current-map pins + regions matching the query, respecting the
  // legend filter (so the list matches what's visible on the map).
  const findResults = useMemo(() => {
    const q = findQuery.trim().toLowerCase()
    const pinRows = visiblePins
      .filter((p) => p.label.toLowerCase().includes(q))
      .map((p) => ({ kind: 'pin' as const, id: p.id, label: p.label }))
    const regionRows = visibleRegions
      .filter((r) => r.label.toLowerCase().includes(q))
      .map((r) => ({ kind: 'region' as const, id: r.id, label: r.label }))
    return [...pinRows, ...regionRows].sort((a, b) => a.label.localeCompare(b.label))
  }, [visiblePins, visibleRegions, findQuery])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const dataUrl = await compressImage(file, 8192, 0.92)
    const { width, height } = await imageSize(dataUrl)
    const name = file.name.replace(/\.[^.]+$/, '')
    const id = await mapRepo.addMap(name, dataUrl, width, height)
    setActiveId(id)
    e.target.value = ''
  }

  async function handleMapClick(lat: number, lng: number) {
    if (addMode && currentMap) {
      const id = await mapRepo.addPin(currentMap.id, lat, lng)
      setSelectedPinId(id)
      setPanelMode('preview')
      setAddMode(false)
      return
    }
    // Idle background click closes any open preview/edit panel. (Draw mode feeds
    // the drawer, so leave selection alone there.)
    if (drawMode) return
    setSelectedPinId(null)
    setSelectedRegionId(null)
  }

  // Create a fresh page named after the marker's label and link it. Lets you
  // spin up a stub page straight from the map instead of only picking an
  // existing one (mirrors RefField's inline "create new page").
  async function createLinkedPage(label: string, link: (pageId: string) => void) {
    const title = label.trim() || 'New page'
    // Reuse an existing page with this title rather than creating a duplicate
    // (createPage now rejects a title clash).
    const id = (await pageRepo.findIdByTitle(title)) ?? (await pageRepo.create({ title }))
    link(id)
  }

  async function handleRegionCreate(points: [number, number][]) {
    if (!currentMap) return
    const id = await mapRepo.addRegion(currentMap.id, points)
    setDrawMode(false)
    setSelectedPinId(null)
    setSelectedRegionId(id)
    setPanelMode('preview')
  }

  // ---- No maps yet -------------------------------------------------------
  if (maps.length === 0) {
    return (
      <EmptyState
        icon="🗺️"
        title="No map yet"
        message="Upload an image of your world (PNG or JPG) to start dropping pins."
      >
        <button className="primary-btn" onClick={() => fileRef.current?.click()}>⭱ Upload a map image</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleUpload} />
      </EmptyState>
    )
  }

  return (
    <div className="map-page">
      <div className="map-toolbar">
        {breadcrumb.length > 1 && (
          <nav className="map-breadcrumb" aria-label="Map hierarchy">
            {breadcrumb.map((m, i) => {
              const last = i === breadcrumb.length - 1
              return (
                <span key={m.id} className="map-crumb">
                  {last
                    ? <span className="map-crumb-current">{m.name}</span>
                    : <button className="map-crumb-link" onClick={() => switchToMap(m.id)}>{m.name}</button>}
                  {!last && <span className="map-crumb-sep">›</span>}
                </span>
              )
            })}
          </nav>
        )}
        <select value={currentMap?.id} onChange={(e) => switchToMap(e.target.value)}>
          {maps.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button
          className={addMode ? 'primary-btn' : 'ghost-btn'}
          onClick={() => { setAddMode((v) => !v); setDrawMode(false); setSelectedPinId(null); setSelectedRegionId(null) }}
        >
          {addMode ? '✓ Click the map to place…' : '📍 Add pin'}
        </button>
        <button
          className={drawMode ? 'primary-btn' : 'ghost-btn'}
          onClick={() => { setDrawMode((v) => !v); setAddMode(false); setSelectedPinId(null); setSelectedRegionId(null) }}
        >
          {drawMode ? '✓ Click to draw, click first point to close' : '▱ Add region'}
        </button>
        <button className="ghost-btn" onClick={() => fileRef.current?.click()}>⭱ New map</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={handleUpload} />
        <button
          className="ghost-btn danger"
          onClick={() => currentMap && setConfirmDeleteMap(true)}
        >
          Delete map
        </button>
        <button
          className={showFind ? 'primary-btn' : 'ghost-btn'}
          onClick={() => setShowFind((v) => !v)}
        >
          🔍 Find
        </button>
        <span className="map-hint">{pins.length} pins · {regions.length} regions</span>
      </div>

      <div className="map-body">
        {currentMap && (
          <MapView
            key={currentMap.id}
            map={currentMap}
            pins={visiblePins}
            styles={pinStyles}
            addMode={addMode}
            selectedPinId={selectedPinId}
            onMapClick={handleMapClick}
            onPinClick={(id) => { setSelectedPinId(id); setSelectedRegionId(null); setPanelMode('preview') }}
            onPinMove={(id, lat, lng) => mapRepo.updatePin(id, { lat, lng })}
            focusPinId={focusPinId}
            regions={visibleRegions}
            regionStyles={regionFills}
            selectedRegionId={selectedRegionId}
            drawMode={drawMode}
            onRegionClick={(id) => { setSelectedRegionId(id); setSelectedPinId(null); setPanelMode('preview') }}
            onRegionCreate={handleRegionCreate}
            onRegionEdit={(id, points) => mapRepo.updateRegion(id, { points })}
            focusTarget={focusTarget}
            previewTarget={previewTarget}
            previewCard={previewCard}
          />
        )}

        {showFind && (
          <div className="map-find">
            <div className="map-find-head">
              <input
                autoFocus
                placeholder="Find a pin or region…"
                value={findQuery}
                onChange={(e) => setFindQuery(e.target.value)}
              />
              <button className="tag-x" onClick={() => { setShowFind(false); setFindQuery('') }}>×</button>
            </div>
            <div className="map-find-list">
              {findResults.length === 0 && <p className="muted map-find-empty">No matches</p>}
              {findResults.map((row) => (
                <button
                  key={`${row.kind}-${row.id}`}
                  className="map-find-row"
                  onClick={() => (row.kind === 'pin' ? focusPin(row.id) : focusRegion(row.id))}
                >
                  <span className="map-find-mark">{row.kind === 'pin' ? '📍' : '▱'}</span>
                  <span className="map-find-label">{row.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {legend.length > 0 && (
          <div className="map-legend">
            {legend.map((row) => {
              const hidden = hiddenTypes.has(row.key)
              return (
                <button
                  key={row.key}
                  className={hidden ? 'legend-row hidden' : 'legend-row'}
                  onClick={() => toggleType(row.key)}
                  title={hidden ? 'Show these pins' : 'Hide these pins'}
                >
                  <span className="legend-swatch" style={{ background: row.color }}>{row.icon ?? ''}</span>
                  <span className="legend-name">{row.name}</span>
                  <span className="legend-count">{row.count}</span>
                </button>
              )
            })}
          </div>
        )}

        {selectedPin && panelMode === 'edit' && (
          <div className="pin-panel">
            <div className="pin-panel-head">
              <h3>Pin</h3>
              <button className="tag-x" onClick={() => setSelectedPinId(null)}>×</button>
            </div>
            <label>Label</label>
            <input
              value={selectedPin.label}
              onChange={(e) => mapRepo.updatePin(selectedPin.id, { label: e.target.value })}
            />
            <label>Linked page</label>
            <div className="pin-link-row">
              <select
                value={selectedPin.pageId ?? ''}
                onChange={(e) => mapRepo.updatePin(selectedPin.id, { pageId: e.target.value || null })}
              >
                <option value="">— none —</option>
                {allPages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {!selectedPin.pageId && (
                <button
                  className="mini-btn"
                  title="Create a new page from this pin's label"
                  onClick={() => createLinkedPage(selectedPin.label, (id) => mapRepo.updatePin(selectedPin.id, { pageId: id }))}
                >
                  ＋ New
                </button>
              )}
            </div>
            <label>Opens map</label>
            <select
              value={selectedPin.childMapId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) mapRepo.updatePin(selectedPin.id, { childMapId: v })
                else mapRepo.updatePin(selectedPin.id, (p) => { delete p.childMapId })
              }}
            >
              <option value="">— none —</option>
              {portalTargets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="pin-panel-actions">
              {selectedPin.childMapId && mapsById.has(selectedPin.childMapId) && (
                <button className="ghost-btn" onClick={() => switchToMap(selectedPin.childMapId!)}>Enter map →</button>
              )}
              {selectedPin.pageId && (
                <button className="ghost-btn" onClick={() => navigate(`/page/${selectedPin.pageId}`)}>Open page →</button>
              )}
              <button
                className="ghost-btn danger"
                onClick={() => { mapRepo.removePin(selectedPin.id); setSelectedPinId(null) }}
              >
                Delete pin
              </button>
            </div>
          </div>
        )}

        {selectedRegion && panelMode === 'edit' && (
          <div className="pin-panel">
            <div className="pin-panel-head">
              <h3>Region</h3>
              <button className="tag-x" onClick={() => setSelectedRegionId(null)}>×</button>
            </div>
            <label>Label</label>
            <input
              value={selectedRegion.label}
              onChange={(e) => mapRepo.updateRegion(selectedRegion.id, { label: e.target.value })}
            />
            <label>Linked page</label>
            <div className="pin-link-row">
              <select
                value={selectedRegion.pageId ?? ''}
                onChange={(e) => mapRepo.updateRegion(selectedRegion.id, { pageId: e.target.value || null })}
              >
                <option value="">— none —</option>
                {allPages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {!selectedRegion.pageId && (
                <button
                  className="mini-btn"
                  title="Create a new page from this region's label"
                  onClick={() => createLinkedPage(selectedRegion.label, (id) => mapRepo.updateRegion(selectedRegion.id, { pageId: id }))}
                >
                  ＋ New
                </button>
              )}
            </div>
            <label>Colour</label>
            <div className="region-swatches">
              <button
                className={selectedRegion.color ? 'region-swatch derive' : 'region-swatch derive active'}
                title="Derive from linked page type"
                onClick={() => mapRepo.updateRegion(selectedRegion.id, (r) => { delete r.color })}
              >
                Auto
              </button>
              {TYPE_COLORS.map((c) => (
                <button
                  key={c}
                  className={selectedRegion.color === c ? 'region-swatch active' : 'region-swatch'}
                  style={{ background: c }}
                  title={c}
                  onClick={() => mapRepo.updateRegion(selectedRegion.id, { color: c })}
                />
              ))}
            </div>
            <label>Opens map</label>
            <select
              value={selectedRegion.childMapId ?? ''}
              onChange={(e) => {
                const v = e.target.value
                if (v) mapRepo.updateRegion(selectedRegion.id, { childMapId: v })
                else mapRepo.updateRegion(selectedRegion.id, (r) => { delete r.childMapId })
              }}
            >
              <option value="">— none —</option>
              {portalTargets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="pin-panel-actions">
              {selectedRegion.childMapId && mapsById.has(selectedRegion.childMapId) && (
                <button className="ghost-btn" onClick={() => switchToMap(selectedRegion.childMapId!)}>Enter map →</button>
              )}
              {selectedRegion.pageId && (
                <button className="ghost-btn" onClick={() => navigate(`/page/${selectedRegion.pageId}`)}>Open page →</button>
              )}
              <button
                className="ghost-btn danger"
                onClick={() => { mapRepo.removeRegion(selectedRegion.id); setSelectedRegionId(null) }}
              >
                Delete region
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDeleteMap}
        title="Delete map?"
        confirmLabel="Delete"
        danger
        onConfirm={async () => {
          setConfirmDeleteMap(false)
          if (!currentMap) return
          setSelectedPinId(null)
          setActiveId(null)
          await mapRepo.removeMap(currentMap.id)
        }}
        onCancel={() => setConfirmDeleteMap(false)}
      >
        Delete “{currentMap?.name}” and all its pins? This cannot be undone.
      </ConfirmDialog>
    </div>
  )
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = reject
    img.src = src
  })
}
