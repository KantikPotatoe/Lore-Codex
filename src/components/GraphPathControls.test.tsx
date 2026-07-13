import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { db } from '../db'
import GraphPathControls from './GraphPathControls'

// PagePicker reads pages through useLiveQuery, so the DB must be cleaned between
// tests and the React tree unmounted (an unmounted liveQuery otherwise touches
// `window` at teardown).
afterEach(async () => {
  cleanup()
  await db.pages.clear()
})

const noop = () => {}

describe('GraphPathControls', () => {
  it('reports the hop count of a found path', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'path', nodes: ['a', 'b', 'c'] }}
      />,
    )
    expect(screen.getByText('2 hops')).toBeTruthy()
  })

  it('singularises a one-hop path', () => {
    render(
      <GraphPathControls
        fromId="a" toId="b" onFrom={noop} onTo={noop}
        result={{ kind: 'path', nodes: ['a', 'b'] }}
      />,
    )
    expect(screen.getByText('1 hop')).toBeTruthy()
  })

  it('blames the filters when a path exists only in the unfiltered graph', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'hidden' }}
      />,
    )
    expect(screen.getByText(/No path with current filters/)).toBeTruthy()
  })

  it('says so when the pages are genuinely unconnected', () => {
    render(
      <GraphPathControls
        fromId="a" toId="c" onFrom={noop} onTo={noop}
        result={{ kind: 'none' }}
      />,
    )
    expect(screen.getByText(/aren’t connected/)).toBeTruthy()
  })

  it('asks for two different pages when both endpoints are the same', () => {
    render(
      <GraphPathControls
        fromId="a" toId="a" onFrom={noop} onTo={noop} result={null}
      />,
    )
    expect(screen.getByText('Pick two different pages')).toBeTruthy()
  })

  it('clears both endpoints', () => {
    const onFrom = vi.fn()
    const onTo = vi.fn()
    render(
      <GraphPathControls
        fromId="a" toId="b" onFrom={onFrom} onTo={onTo}
        result={{ kind: 'path', nodes: ['a', 'b'] }}
      />,
    )
    screen.getByRole('button', { name: 'Clear' }).click()
    expect(onFrom).toHaveBeenCalledWith(null)
    expect(onTo).toHaveBeenCalledWith(null)
  })
})
