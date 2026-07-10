import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { act } from 'react'
import L from 'leaflet'
import 'leaflet-draw'
import MapView from './MapView'
import type { WorldMap, MapRegion } from '../db'

// Real leaflet + leaflet-draw run fine under the suite-default happy-dom env, so
// these drive the actual library rather than a mock: the point is to pin the
// contract MapView depends on, not the calls it makes.
//
// The load-bearing one is `draw:created` handing back a layer that is NOT on the
// map — MapView renders regions from React state, so if a future drawing library
// added the layer itself (leaflet-geoman's `pm:create` does), every drawn region
// would render twice. See docs/leaflet-draw-succession.md §3.1.

afterEach(cleanup)

const WORLD: WorldMap = {
  id: 'm1', name: 'Aldoria', image: 'data:image/png;base64,iVBORw0KGgo=',
  width: 100, height: 100, createdAt: 0,
}

function region(over: Partial<MapRegion> = {}): MapRegion {
  return { id: 'r1', mapId: 'm1', points: [[0, 0], [0, 10], [10, 10]], label: 'Vale', pageId: null, ...over }
}

/** MapView's props, with the bits each test cares about overridable. */
function props(over: Partial<React.ComponentProps<typeof MapView>> = {}) {
  return {
    map: WORLD,
    pins: [], styles: new Map(), addMode: false, selectedPinId: null,
    onMapClick: vi.fn(), onPinClick: vi.fn(), onPinMove: vi.fn(),
    regions: [], regionStyles: new Map(), selectedRegionId: null, drawMode: false,
    onRegionClick: vi.fn(), onRegionCreate: vi.fn(), onRegionEdit: vi.fn(),
    ...over,
  }
}

// MapView never exposes its L.Map, so capture the one it builds. `L.map` is a
// factory on the shared default export, so spying patches the instance MapView imports.
let lmap: L.Map
beforeEach(() => {
  vi.spyOn(L, 'map').mockImplementation(((el: HTMLElement, opts?: L.MapOptions) => {
    lmap = new L.Map(el, opts)
    return lmap
  }) as typeof L.map)
})
afterEach(() => vi.restoreAllMocks())

/** Polygons currently on the map. Vertex editing adds marker layers, so filter by type. */
function polygonsOnMap(): L.Polygon[] {
  const out: L.Polygon[] = []
  lmap.eachLayer((l) => { if (l instanceof L.Polygon) out.push(l) })
  return out
}

const ring = (p: L.Polygon) => (p.getLatLngs()[0] as L.LatLng[]).map((ll) => [ll.lat, ll.lng])

/** Fire the event leaflet-draw emits when the user closes a polygon. */
function drawPolygon(points: [number, number][]) {
  act(() => { lmap.fire(L.Draw.Event.CREATED, { layer: L.polygon(points) } as never) })
}

describe('draw mode', () => {
  it('hands the drawn ring up and leaves no polygon layer behind', () => {
    const onRegionCreate = vi.fn()
    render(<MapView {...props({ drawMode: true, onRegionCreate })} />)

    drawPolygon([[0, 0], [0, 10], [10, 10]])

    expect(onRegionCreate).toHaveBeenCalledTimes(1)
    expect(onRegionCreate).toHaveBeenCalledWith([[0, 0], [0, 10], [10, 10]])
    // The canary: regions render from state, so the drawer must not add a layer.
    expect(polygonsOnMap()).toHaveLength(0)
  })

  it('rejects a degenerate polygon of fewer than 3 points', () => {
    const onRegionCreate = vi.fn()
    render(<MapView {...props({ drawMode: true, onRegionCreate })} />)

    drawPolygon([[0, 0], [0, 10]])

    expect(onRegionCreate).not.toHaveBeenCalled()
  })

  it('detaches the created listener when draw mode is left', () => {
    const onRegionCreate = vi.fn()
    const { rerender } = render(<MapView {...props({ drawMode: true, onRegionCreate })} />)
    rerender(<MapView {...props({ drawMode: false, onRegionCreate })} />)

    drawPolygon([[0, 0], [0, 10], [10, 10]])

    expect(onRegionCreate).not.toHaveBeenCalled()
  })

  it('disables the drawer when draw mode is left', () => {
    const disable = vi.spyOn(L.Draw.Polygon.prototype, 'disable')
    const { rerender } = render(<MapView {...props({ drawMode: true })} />)
    expect(disable).not.toHaveBeenCalled()

    rerender(<MapView {...props({ drawMode: false })} />)

    expect(disable).toHaveBeenCalled()
  })
})

describe('vertex editing', () => {
  /** The per-layer handle leaflet-draw attaches to polygons. */
  const editing = (p: L.Polygon) =>
    (p as unknown as { editing: { enabled(): boolean } }).editing

  it('enables editing on the selected region and not on unselected ones', () => {
    const regions = [region(), region({ id: 'r2', points: [[20, 20], [20, 30], [30, 30]] })]
    const { rerender } = render(<MapView {...props({ regions })} />)
    expect(polygonsOnMap().every((p) => !editing(p).enabled())).toBe(true)

    rerender(<MapView {...props({ regions, selectedRegionId: 'r1' })} />)

    const [r1, r2] = polygonsOnMap()
    expect(editing(r1).enabled()).toBe(true)
    expect(editing(r2).enabled()).toBe(false)
  })

  it('persists the reshaped ring when the region is deselected', () => {
    const onRegionEdit = vi.fn()
    const regions = [region()]
    const { rerender } = render(<MapView {...props({ regions, selectedRegionId: 'r1', onRegionEdit })} />)

    // Stand in for the user dragging a vertex: leaflet-draw mutates the polygon in place.
    const poly = polygonsOnMap()[0]
    act(() => { poly.setLatLngs([[0, 0], [0, 10], [10, 10], [5, 5]]) })

    rerender(<MapView {...props({ regions, selectedRegionId: null, onRegionEdit })} />)

    expect(onRegionEdit).toHaveBeenCalledExactlyOnceWith('r1', [[0, 0], [0, 10], [10, 10], [5, 5]])
    expect(editing(poly).enabled()).toBe(false)
  })

  it('does not overwrite the polygon being edited when regions re-render', () => {
    const regions = [region()]
    const { rerender } = render(<MapView {...props({ regions, selectedRegionId: 'r1' })} />)
    const poly = polygonsOnMap()[0]
    act(() => { poly.setLatLngs([[0, 0], [0, 10], [10, 10], [5, 5]]) })

    // A regions update while editing (e.g. a sibling region's colour changed) must
    // leave the in-progress shape alone — otherwise the drag is silently reverted.
    rerender(<MapView {...props({ regions: [...regions], selectedRegionId: 'r1' })} />)

    expect(ring(poly)).toHaveLength(4)
  })

  it('persists an in-progress edit when the map unmounts mid-drag', () => {
    const onRegionEdit = vi.fn()
    const regions = [region()]
    const { unmount } = render(<MapView {...props({ regions, selectedRegionId: 'r1', onRegionEdit })} />)
    const poly = polygonsOnMap()[0]
    act(() => { poly.setLatLngs([[1, 1], [1, 11], [11, 11]]) })

    unmount()

    expect(onRegionEdit).toHaveBeenCalledExactlyOnceWith('r1', [[1, 1], [1, 11], [11, 11]])
  })

  it('leaves an unedited region alone on unmount', () => {
    const onRegionEdit = vi.fn()
    const { unmount } = render(<MapView {...props({ regions: [region()] })} />)

    unmount()

    expect(onRegionEdit).not.toHaveBeenCalled()
  })
})
