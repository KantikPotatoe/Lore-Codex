import { afterEach, describe, expect, it, vi } from 'vitest'
import { StrictMode, useState } from 'react'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GraphView from './GraphView'
import type { DrawnGraphData } from '../graphColor'
import type { GraphCam } from '../useGraphPrefs'

// react-force-graph can't run here (no canvas in happy-dom), and the bug isn't
// in its drawing anyway — it's in *when* it invokes our callbacks. react-kapsule
// propagates every changed prop by calling the vanilla force-graph setter from
// inside its own render body (react-kapsule.mjs:105-110), and force-graph's
// width/height and graphData setters re-zoom via `zoom.scaleTo`, which fires
// d3-zoom's `end` event synchronously → `onZoomEnd`. So the faithful stand-in is
// a component that calls `onZoomEnd` during render. Once — a real one fires per
// prop change, but one is enough to trip React, and looping would hang the test.
type ZoomEnd = (t: { k: number; x: number; y: number }) => void

// `latest` also exposes the live handler so a test can fire a *post-mount*
// report, the way a real pan or zoom gesture does.
const { latest } = vi.hoisted(() => ({
  latest: { onZoomEnd: null as ZoomEnd | null, renders: 0 },
}))

vi.mock('react-force-graph-2d', () => ({
  default: (props: { onZoomEnd?: ZoomEnd }) => {
    latest.onZoomEnd = props.onZoomEnd ?? null
    if (latest.renders === 0) {
      latest.renders = 1
      props.onZoomEnd?.({ k: 2, x: 30, y: 40 })
    }
    return <div data-testid="force-graph" />
  },
}))

// GraphMinimap only mounts once the container has a measured size, which it
// never gets here, so it stays out of the tree.
const EMPTY: DrawnGraphData = { nodes: [], links: [] }

const noop = () => {}

afterEach(() => {
  cleanup()
  latest.renders = 0
  latest.onZoomEnd = null
  vi.restoreAllMocks()
})

/** Mirrors GraphRoute: owns the camera state and hands the setter to GraphView. */
function Host({ onCam }: { onCam: (c: GraphCam) => void }) {
  const [cam, setCam] = useState<GraphCam | null>(null)
  return (
    <>
      <GraphView
        data={EMPTY}
        showArrows={false}
        colorBy="type"
        tagFilter={{ tags: [], mode: 'any' }}
        islandColors={new Map()}
        selectedId={null}
        path={null}
        onSelect={noop}
        onGhostClick={noop}
        onPinNode={noop}
        initialCam={null}
        onCamChange={(c) => {
          setCam(c)
          onCam(c)
        }}
      />
      <span data-testid="cam">{cam ? `${cam.k},${cam.x},${cam.y}` : 'none'}</span>
    </>
  )
}

describe('GraphView camera reporting', () => {
  it('does not set parent state while react-force-graph is rendering', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCam = vi.fn()

    render(
      <MemoryRouter>
        <Host onCam={onCam} />
      </MemoryRouter>,
    )
    await waitFor(() => expect(onCam).toHaveBeenCalled())

    const setStateDuringRender = errors.mock.calls
      .map((args) => args.map(String).join(' '))
      .filter((msg) => msg.includes('while rendering a different component'))
    expect(setStateDuringRender).toEqual([])
  })

  // A deferred report has to survive StrictMode's dev double-mount, which runs
  // the unmount cleanup between the two mounts while keeping the component's
  // refs. A cleanup that cancels the pending flush without also clearing the
  // stored timer id leaves every later report looking already-scheduled, and
  // the camera stops persisting for the rest of the page's life.
  it('keeps reporting after StrictMode remounts the component', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCam = vi.fn()

    const { getByTestId } = render(
      <StrictMode>
        <MemoryRouter>
          <Host onCam={onCam} />
        </MemoryRouter>
      </StrictMode>,
    )

    // The during-render report is scheduled and then discarded by the remount's
    // cleanup — fine, the real app re-reports and the hydration guard would have
    // dropped that one anyway. What must survive is everything after: this is a
    // later pan/zoom, and it has to land.
    await act(async () => {
      latest.onZoomEnd?.({ k: 3, x: 11, y: 22 })
      await new Promise((r) => setTimeout(r, 0))
    })

    await waitFor(() => expect(getByTestId('cam').textContent).toBe('3,11,22'))
  })

  it('still delivers the reported camera', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onCam = vi.fn()

    const { getByTestId } = render(
      <MemoryRouter>
        <Host onCam={onCam} />
      </MemoryRouter>,
    )

    await waitFor(() => expect(getByTestId('cam').textContent).toBe('2,30,40'))
    expect(onCam).toHaveBeenCalledWith({ k: 2, x: 30, y: 40 })
  })
})
