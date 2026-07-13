import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getMeta } from '../db'
import {
  LAST_BACKUP_KEY,
  latestChangeTime,
  hasUnbackedUpChanges,
  unbackedChangeCount,
  isBackupOverdue,
  downloadBackup,
  timeAgo,
} from '../backup'
import { getSettings } from '../settings'

// A thin reminder bar shown across the app whenever there is data that hasn't
// been backed up yet. Dismissible for the current session.
export default function BackupBanner() {
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)

  const lastBackup = useLiveQuery(() => getMeta<number>(LAST_BACKUP_KEY), [])
  const latestChange = useLiveQuery(() => latestChangeTime(), []) ?? 0
  const count = useLiveQuery(() => unbackedChangeCount(lastBackup ?? null), [lastBackup, latestChange]) ?? 0
  const overdueDays = useLiveQuery(async () => (await getSettings()).backupOverdueDays, []) ?? 7

  const needsBackup = hasUnbackedUpChanges(lastBackup ?? null, latestChange)
  if (dismissed || !needsBackup) return null

  // Escalate styling when a backup is overdue: never taken, or older than the configured days.
  const urgent = isBackupOverdue(lastBackup ?? null, overdueDays)

  async function backup() {
    setBusy(true)
    try {
      await downloadBackup()
    } finally {
      setBusy(false)
    }
  }

  const noun = `change${count === 1 ? '' : 's'}`
  const message = lastBackup == null
    ? `⚠ ${count} ${noun} and no backup yet.`
    : `⚠ ${count} ${noun} since your last backup (${timeAgo(lastBackup)}).`

  return (
    <div className={`backup-banner${urgent ? ' is-urgent' : ''}`}>
      <span>{message}</span>
      <div className="backup-banner-actions">
        <button className="backup-banner-btn" disabled={busy} onClick={backup}>
          {busy ? 'Backing up…' : 'Back up now'}
        </button>
        <button className="backup-banner-x" title="Dismiss for now" onClick={() => setDismissed(true)}>×</button>
      </div>
    </div>
  )
}
