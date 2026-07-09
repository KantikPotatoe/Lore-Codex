import { categoryColor, type GraphNode } from '../db'

export default function HubsOrphansPanel({
  hubs,
  isolated,
  onSelect,
}: {
  hubs: GraphNode[]
  isolated: GraphNode[]
  onSelect: (id: string) => void
}) {
  return (
    <aside className="graph-panel">
      <section>
        <h3>Hubs</h3>
        {hubs.length === 0 ? (
          <p className="muted">No connected pages yet.</p>
        ) : (
          <ul>
            {hubs.map((n) => (
              <li key={n.id}>
                <button onClick={() => onSelect(n.id)}>
                  <span className="dot" style={{ background: categoryColor(n.category) }} />
                  <span className="t">{n.title}</span>
                  <span className="deg">{n.degree}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h3>Isolated <span className="count">{isolated.length}</span></h3>
        {isolated.length === 0 ? (
          <p className="muted">Every page is connected. 🎉</p>
        ) : (
          <ul>
            {isolated.map((n) => (
              <li key={n.id}>
                <button onClick={() => onSelect(n.id)}>
                  <span className="dot" style={{ background: categoryColor(n.category) }} />
                  <span className="t">{n.title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  )
}
