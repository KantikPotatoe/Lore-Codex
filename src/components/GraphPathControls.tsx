import type { PathResult } from '../db'
import PagePicker from './PagePicker'

/** What the readout says for each outcome. Pure, so the wording is pinned by
 *  tests without rendering the graph canvas. */
function readout(result: PathResult | null, sameTwice: boolean): string {
  if (sameTwice) return 'Pick two different pages'
  if (!result) return ''
  if (result.kind === 'none') return 'These pages aren’t connected'
  if (result.kind === 'hidden') return 'No path with current filters — one exists in the unfiltered graph'
  const hops = result.nodes.length - 1
  return `${hops} hop${hops === 1 ? '' : 's'}`
}

/** The "how is this villain connected to that city?" control: two page pickers
 *  and the answer. The pickers offer every real page, not just the visible ones —
 *  an endpoint that a filter has hidden must still be pickable, since that is
 *  exactly the case the "filters are hiding it" message explains. */
export default function GraphPathControls({
  fromId, toId, onFrom, onTo, result,
}: {
  fromId: string | null
  toId: string | null
  onFrom: (id: string | null) => void
  onTo: (id: string | null) => void
  result: PathResult | null
}) {
  const sameTwice = fromId !== null && fromId === toId
  const message = readout(result, sameTwice)

  return (
    <div className="graph-path">
      <span className="graph-path-label">Path</span>
      <PagePicker
        multiple={false}
        placeholder="From…"
        value={fromId ? [fromId] : []}
        onChange={(ids) => onFrom(ids[0] ?? null)}
      />
      <span className="graph-path-arrow">→</span>
      <PagePicker
        multiple={false}
        placeholder="To…"
        value={toId ? [toId] : []}
        onChange={(ids) => onTo(ids[0] ?? null)}
      />
      {message && <span className="graph-path-msg">{message}</span>}
      {(fromId || toId) && (
        <button
          className="ghost-btn"
          onClick={() => {
            onFrom(null)
            onTo(null)
          }}
        >
          Clear
        </button>
      )}
    </div>
  )
}
