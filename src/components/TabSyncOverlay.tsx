import { useTabSync } from '../tabSync'

// A non-dismissable, app-wide overlay shown when another tab imported or deleted
// the world this tab is editing (#185). Once the world was swapped/removed under
// us, any further edit lands in the wrong dataset or a vanishing DB — so the only
// safe action is a reload. Delete lands on the selector (this world is gone).
const COPY: Record<'import' | 'delete', string> = {
  import: 'This world was replaced by an import in another tab.',
  delete: 'This world was deleted in another tab.',
}

export default function TabSyncOverlay() {
  const { reason } = useTabSync()
  if (!reason) return null

  function reload() {
    if (reason === 'delete') window.location.hash = '#/'
    window.location.reload()
  }

  return (
    <div className="tab-sync-overlay" role="alertdialog" aria-modal="true">
      <div className="tab-sync-dialog">
        <span className="tab-sync-icon" aria-hidden="true">⚠</span>
        <p className="tab-sync-msg">{COPY[reason]} Reload to continue.</p>
        <button className="tab-sync-btn" onClick={reload}>Reload</button>
      </div>
    </div>
  )
}
