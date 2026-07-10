import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, within, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import MapRoute from './MapRoute'
import { db, mapRepo } from '../db'

afterEach(cleanup)

beforeEach(async () => {
  await db.maps.clear()
  await db.regions.clear()
  await db.pins.clear()
})

async function seedMapWithRegion() {
  const mapId = await db.maps.add({ id: 'm1', name: 'Eriador', image: '', width: 100, height: 100, createdAt: 1 } as never)
  const regionId = await db.regions.add({ id: 'r1', mapId, points: [[0, 0], [0, 10], [10, 10]], label: 'The Shire', pageId: null } as never)
  return { mapId, regionId }
}

describe('MapRoute ?region= deep link', () => {
  it('exposes getRegion on the repo seam', async () => {
    const { regionId } = await seedMapWithRegion()
    const region = await mapRepo.getRegion(regionId)
    expect(region?.label).toBe('The Shire')
    expect(await mapRepo.getRegion('nope')).toBeUndefined()
  })

  it('selects the region named in ?region= (opens its preview panel)', async () => {
    // Note: MapView always renders a region's label as a permanent map tooltip
    // regardless of selection (MapView.tsx ~248), so asserting on the label
    // text alone (as a bare `screen.findByText('The Shire')`) would pass even
    // without the deep-link effect wired up. Assert on the preview *dialog*
    // instead — that only mounts when `focusRegion` actually selects it.
    const { regionId } = await seedMapWithRegion()
    render(
      <MemoryRouter initialEntries={[`/map?region=${regionId}`]}>
        <MapRoute />
      </MemoryRouter>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'Marker preview' })
    expect(within(dialog).getByText('The Shire')).toBeTruthy()
  })

  it('is a silent no-op for a stale region id', async () => {
    await seedMapWithRegion()
    render(
      <MemoryRouter initialEntries={['/map?region=deleted']}>
        <MapRoute />
      </MemoryRouter>,
    )
    // Let the map (and its regions) finish loading before asserting nothing
    // opened — the preview dialog, not the always-on map tooltip, is the
    // selection-only signal (see note above).
    await screen.findByText('Delete map')
    expect(screen.queryByRole('dialog', { name: 'Marker preview' })).toBeNull()
  })
})
