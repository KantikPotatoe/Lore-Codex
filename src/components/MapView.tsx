import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw'
import 'leaflet-draw/dist/leaflet.draw.css'
import type { WorldMap, MapPin, MapRegion } from '../db'
import { showPageHover, scheduleWikiHoverClose } from '../wikiLinkHover'

// leaflet-draw augments polygon layers with an `editing` handler and adds the
// L.Draw.* / L.Draw.Event globals, but @types/leaflet-draw doesn't surface the
// per-layer handle, so we narrow it locally.
type EditablePolygon = L.Polygon & {
  editing: { enable(): void; disable(): void; enabled(): boolean }
}

export interface PinMarkerStyle {
  color: string
  icon: string | null
  portal?: boolean // pin opens a child map — show a drill-down badge
}

/** A request to centre the map on a pin or region. `nonce` changes on every
 *  request so re-selecting the same target re-pans. */
export interface FocusTarget {
  kind: 'pin' | 'region'
  id: string
  nonce: number
}

interface Props {
  map: WorldMap
  pins: MapPin[]
  styles: Map<string, PinMarkerStyle>
  addMode: boolean
  selectedPinId: string | null
  onMapClick: (lat: number, lng: number) => void
  onPinClick: (pinId: string) => void
  onPinMove: (pinId: string, lat: number, lng: number) => void
  focusPinId?: string | null
  regions: MapRegion[]
  regionStyles: Map<string, { color: string; portal?: boolean }>
  selectedRegionId: string | null
  drawMode: boolean
  onRegionClick: (id: string) => void
  onRegionCreate: (points: [number, number][]) => void
  onRegionEdit: (id: string, points: [number, number][]) => void
  focusTarget?: FocusTarget | null
  previewTarget?: { kind: 'pin' | 'region'; id: string } | null
  previewCard?: React.ReactNode
}

// We use a "Simple" coordinate system so the map is just the flat image, with
// pixel-based coordinates instead of real-world latitude/longitude.
export default function MapView({
  map, pins, styles, addMode, selectedPinId, onMapClick, onPinClick, onPinMove, focusPinId,
  regions, regionStyles, selectedRegionId, drawMode, onRegionClick, onRegionCreate, onRegionEdit,
  focusTarget,
  previewTarget, previewCard,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const polygonsRef = useRef<Map<string, L.Polygon>>(new Map())
  // id of the region whose vertices are currently being edited, or null.
  const editingRef = useRef<string | null>(null)
  // Keep latest callbacks in a ref so we can attach handlers once.
  const cbRef = useRef({ onMapClick, onPinClick, onPinMove, onRegionClick, onRegionCreate, onRegionEdit })
  useEffect(() => {
    cbRef.current = { onMapClick, onPinClick, onPinMove, onRegionClick, onRegionCreate, onRegionEdit }
  })

  // Latest pins / regions / modes for delegated + layer handlers.
  const pinsRef = useRef(pins)
  const addModeRef = useRef(addMode)
  const regionsRef = useRef(regions)
  const drawModeRef = useRef(drawMode)
  // True between a pin's dragstart and dragend, to suppress hover previews.
  const draggingRef = useRef(false)
  // Overlay wrapper that holds the preview card, positioned over the marker.
  const overlayRef = useRef<HTMLDivElement>(null)
  // Latest selection ids, read by the delegated hover handler to skip the
  // marker whose preview card is already open (avoids a double card).
  const selectedPinIdRef = useRef(selectedPinId)
  const selectedRegionIdRef = useRef(selectedRegionId)
  useEffect(() => {
    pinsRef.current = pins
    addModeRef.current = addMode
    regionsRef.current = regions
    drawModeRef.current = drawMode
    selectedPinIdRef.current = selectedPinId
    selectedRegionIdRef.current = selectedRegionId
  })

  // Create the Leaflet map once per world-map image.
  useEffect(() => {
    if (!containerRef.current) return
    const bounds: L.LatLngBoundsExpression = [[0, 0], [map.height, map.width]]
    const lmap = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -4,
      maxZoom: 4,
      zoomControl: true,
      attributionControl: false,
    })
    // A map whose image failed import sanitization is stored with image: ''
    // (see sanitizeBackup). L.imageOverlay('') renders a blank tile with pins
    // floating over nothing, so skip it and let the render show why. The effect
    // is keyed on map.image, so a re-upload restores the overlay without a remount.
    if (map.image) L.imageOverlay(map.image, bounds).addTo(lmap)
    lmap.fitBounds(bounds)
    lmap.on('click', (e) => cbRef.current.onMapClick(e.latlng.lat, e.latlng.lng))
    mapRef.current = lmap
    const markers = markersRef.current
    const polygons = polygonsRef.current
    return () => {
      // Persist any in-progress vertex edit before the layers are destroyed
      // (e.g. the user switches maps or navigates away mid-edit).
      const editing = editingRef.current
      if (editing) {
        const p = polygons.get(editing) as EditablePolygon | undefined
        if (p?.editing?.enabled()) {
          const ring = p.getLatLngs()[0] as L.LatLng[]
          cbRef.current.onRegionEdit(editing, ring.map((ll) => [ll.lat, ll.lng] as [number, number]))
        }
      }
      lmap.remove()
      mapRef.current = null
      markers.clear()
      polygons.clear()
      editingRef.current = null
    }
  }, [map.id, map.image, map.width, map.height])

  // Reflect add-mode in the cursor.
  useEffect(() => {
    const el = containerRef.current
    if (el) el.style.cursor = addMode ? 'crosshair' : ''
  }, [addMode])

  // Pin hover → page preview, reusing the app-wide popover bus. Delegated on the
  // map container so it survives Leaflet re-creating marker elements. Suppressed
  // while dragging or placing a pin (mirrors editor edit-mode suppression).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    function over(e: MouseEvent) {
      if (addModeRef.current || draggingRef.current) return
      const icon = (e.target as HTMLElement).closest('.pin-icon[data-pin-id]') as HTMLElement | null
      if (!icon) return
      if (icon.dataset.pinId === selectedPinIdRef.current) return
      const pin = pinsRef.current.find((p) => p.id === icon.dataset.pinId)
      if (!pin?.pageId) return
      showPageHover(pin.pageId, pin.label, icon.getBoundingClientRect())
    }
    function out(e: MouseEvent) {
      const icon = (e.target as HTMLElement).closest('.pin-icon[data-pin-id]')
      // Ignore moves that stay inside the same pin (parent→child), so crossing
      // .pin-dot/.pin-label doesn't schedule a close — mirrors mouseleave.
      if (icon && !icon.contains(e.relatedTarget as Node)) scheduleWikiHoverClose()
    }
    el.addEventListener('mouseover', over)
    el.addEventListener('mouseout', out)
    return () => {
      el.removeEventListener('mouseover', over)
      el.removeEventListener('mouseout', out)
    }
  }, [])

  // Sync markers with the pins array and their derived styles.
  useEffect(() => {
    const lmap = mapRef.current
    if (!lmap) return
    const existing = markersRef.current
    const seen = new Set<string>()

    for (const pin of pins) {
      seen.add(pin.id)
      const selected = pin.id === selectedPinId
      const style = styles.get(pin.id) ?? { color: '#a0a0a0', icon: null }
      const icon = makeIcon(pin, style, selected)
      let marker = existing.get(pin.id)
      if (marker) {
        marker.setLatLng([pin.lat, pin.lng])
        marker.setIcon(icon)
      } else {
        const m = L.marker([pin.lat, pin.lng], { icon, draggable: !addMode }).addTo(lmap)
        marker = m
        m.on('click', (e) => {
          L.DomEvent.stopPropagation(e) // don't also fire a map click
          cbRef.current.onPinClick(pin.id)
        })
        m.on('dragstart', () => {
          draggingRef.current = true
          scheduleWikiHoverClose()
        })
        m.on('dragend', () => {
          draggingRef.current = false
          const { lat, lng } = m.getLatLng()
          cbRef.current.onPinMove(pin.id, lat, lng)
        })
        existing.set(pin.id, m)
      }
      // Dragging is disabled while placing a new pin to avoid click/drag conflicts.
      if (marker.dragging) {
        if (addMode) {
          marker.dragging.disable()
        } else {
          marker.dragging.enable()
        }
      }
    }

    // Remove markers whose pins were deleted or filtered out.
    for (const [id, marker] of existing) {
      if (!seen.has(id)) {
        marker.remove()
        existing.delete(id)
      }
    }
  }, [pins, styles, selectedPinId, addMode])

  // Sync polygons with the regions array and their derived fill colours. Polygons
  // live in the default overlay pane (z 400), below the marker pane (z 600), so
  // pins stay clickable on top.
  useEffect(() => {
    const lmap = mapRef.current
    if (!lmap) return
    const existing = polygonsRef.current
    const seen = new Set<string>()

    for (const region of regions) {
      if (region.points.length < 3) continue
      seen.add(region.id)
      const selected = region.id === selectedRegionId
      const entry = regionStyles.get(region.id)
      const fill = entry?.color ?? '#a0a0a0'
      const labelText = entry?.portal ? `${region.label} ⤵` : region.label
      const style: L.PathOptions = {
        color: fill,
        fillColor: fill,
        fillOpacity: selected ? 0.45 : 0.25,
        weight: selected ? 3 : 2,
      }
      const poly = existing.get(region.id)
      if (poly) {
        // Don't fight the user's in-progress vertex edits on this layer.
        if (editingRef.current !== region.id) poly.setLatLngs(region.points)
        poly.setStyle(style)
        poly.setTooltipContent(labelText)
      } else {
        const p = L.polygon(region.points, style).addTo(lmap)
        p.bindTooltip(labelText, { permanent: true, direction: 'center', className: 'region-label' })
        p.on('click', (e) => {
          // While placing a pin or drawing a region, let the click reach the
          // map beneath so it can drop a pin / feed the drawer instead of
          // selecting this region.
          if (addModeRef.current || drawModeRef.current) return
          L.DomEvent.stopPropagation(e) // don't also fire a map click
          cbRef.current.onRegionClick(region.id)
        })
        p.on('mouseover', () => {
          if (drawModeRef.current || editingRef.current) return
          if (region.id === selectedRegionIdRef.current) return
          const r = regionsRef.current.find((x) => x.id === region.id)
          if (!r?.pageId) return
          const el = p.getElement() as HTMLElement | null
          if (el) showPageHover(r.pageId, r.label, el.getBoundingClientRect())
        })
        p.on('mouseout', () => scheduleWikiHoverClose())
        existing.set(region.id, p)
      }
    }

    for (const [id, poly] of existing) {
      if (!seen.has(id)) {
        poly.remove()
        existing.delete(id)
      }
    }
  }, [regions, regionStyles, selectedRegionId])

  // While drawMode is on, enable leaflet-draw's polygon drawer. On completion we
  // hand the vertices up; the new polygon is rendered from state (not added here),
  // so there's no duplicate layer.
  useEffect(() => {
    const lmap = mapRef.current
    if (!lmap || !drawMode) return
    const drawer = new L.Draw.Polygon(lmap as L.DrawMap, {
      allowIntersection: true,
      shapeOptions: { color: '#e0a458', weight: 2 },
    })
    drawer.enable()
    const onCreated = (e: L.LeafletEvent) => {
      const layer = (e as unknown as { layer: L.Polygon }).layer
      const ring = layer.getLatLngs()[0] as L.LatLng[]
      const points = ring.map((ll) => [ll.lat, ll.lng] as [number, number])
      if (points.length >= 3) cbRef.current.onRegionCreate(points)
    }
    lmap.on(L.Draw.Event.CREATED, onCreated)
    return () => {
      drawer.disable()
      lmap.off(L.Draw.Event.CREATED, onCreated)
    }
  }, [drawMode])

  // Enable vertex editing on the selected region; when selection leaves a region
  // that was being edited, disable editing and persist its new shape.
  useEffect(() => {
    const polys = polygonsRef.current
    const prev = editingRef.current
    if (prev && prev !== selectedRegionId) {
      const p = polys.get(prev) as EditablePolygon | undefined
      if (p?.editing?.enabled()) {
        p.editing.disable()
        const ring = p.getLatLngs()[0] as L.LatLng[]
        cbRef.current.onRegionEdit(prev, ring.map((ll) => [ll.lat, ll.lng] as [number, number]))
      }
      editingRef.current = null
    }
    if (selectedRegionId) {
      const p = polys.get(selectedRegionId) as EditablePolygon | undefined
      if (p?.editing && !p.editing.enabled()) {
        p.editing.enable()
        editingRef.current = selectedRegionId
      }
    }
  }, [selectedRegionId, regions])

  // Pan to a deep-linked pin once its marker exists. `focusedRef` ensures we pan
  // once per target rather than on every pins update (e.g. while dragging).
  const focusedRef = useRef<string | null>(null)
  useEffect(() => {
    const lmap = mapRef.current
    if (!lmap || !focusPinId || focusedRef.current === focusPinId) return
    const pin = pins.find((p) => p.id === focusPinId)
    if (!pin) return
    focusedRef.current = focusPinId
    lmap.setView([pin.lat, pin.lng], Math.max(lmap.getZoom(), 1))
  }, [focusPinId, pins])

  // Centre the map on a pin or region requested by the route (find panel / drill).
  // `focusTarget.nonce` changes per request so re-selecting the same target re-pans.
  useEffect(() => {
    const lmap = mapRef.current
    if (!lmap || !focusTarget) return
    if (focusTarget.kind === 'pin') {
      const pin = pinsRef.current.find((p) => p.id === focusTarget.id)
      if (pin) lmap.setView([pin.lat, pin.lng], Math.max(lmap.getZoom(), 1))
    } else {
      const poly = polygonsRef.current.get(focusTarget.id)
      if (poly) lmap.fitBounds(poly.getBounds())
    }
  }, [focusTarget])

  // Position the preview overlay over its marker and keep it there as the map
  // pans/zooms. Coordinates are container points; the overlay is a sibling of
  // the map canvas inside the position:relative .map-body, so they align.
  useEffect(() => {
    const lmap = mapRef.current
    const el = overlayRef.current
    if (!lmap || !el || !previewTarget) return
    const update = () => {
      let latlng: L.LatLng | null = null
      if (previewTarget.kind === 'pin') {
        const pin = pinsRef.current.find((p) => p.id === previewTarget.id)
        if (pin) latlng = L.latLng(pin.lat, pin.lng)
      } else {
        const poly = polygonsRef.current.get(previewTarget.id)
        if (poly) latlng = poly.getBounds().getCenter()
      }
      if (!latlng) return
      const pt = lmap.latLngToContainerPoint(latlng)
      el.style.left = `${pt.x}px`
      el.style.top = `${pt.y}px`
    }
    update()
    lmap.on('move zoom zoomanim resize', update)
    return () => { lmap.off('move zoom zoomanim resize', update) }
  }, [previewTarget, pins, regions])

  return (
    <>
      <div ref={containerRef} className="map-canvas" />
      {!map.image && (
        <div className="map-image-missing" role="status">
          This map’s image could not be restored from the backup. Its pins and regions
          are intact — upload a replacement image to see them in place.
        </div>
      )}
      {previewCard && (
        <div ref={overlayRef} className="map-preview-anchor">{previewCard}</div>
      )}
    </>
  )
}

// A small teardrop pin rendered as an HTML element, tinted by its type colour
// with an optional emoji above the dot. Linked pins carry data-pin-id so the
// delegated hover handler can resolve them back to a page.
function makeIcon(pin: MapPin, style: PinMarkerStyle, selected: boolean): L.DivIcon {
  const safe = pin.label.replace(/</g, '&lt;')
  const emoji = style.icon ? `<span class="pin-emoji">${style.icon}</span>` : ''
  const portal = style.portal ? '<span class="pin-portal" title="Opens another map">⤵</span>' : ''
  const idAttr = pin.pageId ? ` data-pin-id="${pin.id}"` : ''
  return L.divIcon({
    className: 'pin-icon-wrap',
    html:
      `<div class="pin-icon${selected ? ' selected' : ''}"${idAttr}>${emoji}` +
      `<span class="pin-dot" style="background:${style.color}"></span>${portal}` +
      `<span class="pin-label">${safe}</span></div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
  })
}
