import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  db,
  importAll,
  restoreSnapshot,
  parseBackup,
  getSnapshots,
  type BackupCounts,
} from '../db'
import {
  LAST_BACKUP_KEY,
  downloadBackup,
  downloadPreImportBackup,
  latestChangeTime,
  hasUnbackedUpChanges,
  unbackedChangeCount,
  isStoragePersisted,
  requestPersistentStorage,
  timeAgo,
} from '../backup'
import { exportAsHtml } from '../htmlExport'
import { getSettings, updateSettings, DEFAULT_SETTINGS, type LoreSettings } from '../settings'
import { deleteLore, currentLoreId } from '../lores'
import { openTextFile, isTauri } from '../platform'
import ConfirmDialog from '../components/ConfirmDialog'

export default function SettingsRoute() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingImport, setPendingImport] = useState<{
    json: string
    current: BackupCounts
    incoming: BackupCounts
    // 'backup' replaces everything; 'snapshot' replaces text but keeps images/maps.
    kind: 'backup' | 'snapshot'
  } | null>(null)
  // In-app acknowledgement dialog — host alert() is unreliable in the shell's
  // webview (and jarring in the browser).
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null)

  const snapshots = useLiveQuery(() => getSnapshots(), []) ?? []
  const lastBackup = useLiveQuery(async () => (await db.meta.get(LAST_BACKUP_KEY))?.value as number | undefined, [])
  const latestChange = useLiveQuery(() => latestChangeTime(), []) ?? 0
  const needsBackup = hasUnbackedUpChanges(lastBackup ?? null, latestChange)
  const unbacked = useLiveQuery(() => unbackedChangeCount(lastBackup ?? null), [lastBackup, latestChange]) ?? 0

  // Settings: load once into a draft so rapid edits to different fields don't
  // clobber each other (mirrors HomeRoute's HomeConfig pattern).
  const savedSettings = useLiveQuery(() => getSettings(), [])
  const [draft, setDraft] = useState<LoreSettings | null>(null)
  if (savedSettings !== undefined && draft === null) setDraft(savedSettings)
  const s = draft ?? savedSettings ?? DEFAULT_SETTINGS

  function setField(patch: Partial<LoreSettings>) {
    setDraft((prev) => ({ ...(prev ?? savedSettings ?? DEFAULT_SETTINGS), ...patch }))
  }
  // Clearing a number input makes valueAsNumber NaN; dropping it keeps a bad value
  // out of settings (a NaN snapshot threshold makes `changed < NaN` always false).
  function setNumField(key: keyof LoreSettings) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.valueAsNumber
      if (Number.isFinite(v)) setField({ [key]: v } as Partial<LoreSettings>)
    }
  }
  useEffect(() => {
    if (draft) updateSettings(draft)
  }, [draft])

  useEffect(() => {
    isStoragePersisted().then(setPersisted)
  }, [])

  async function handleBackup() {
    setBusy(true)
    try { await downloadBackup() } finally { setBusy(false) }
  }
  async function handleExportHtml() {
    setExporting(true)
    try { await exportAsHtml() } finally { setExporting(false) }
  }
  async function enablePersist() {
    setPersisted(await requestPersistentStorage())
  }

  async function loadCounts(): Promise<BackupCounts> {
    const [pages, maps, pins, regions, templates, calendars, events, images, docLinks,
      books, chapters, scenes, plotlines, beats] = await Promise.all([
      db.pages.count(), db.maps.count(), db.pins.count(), db.regions.count(),
      db.templates.count(), db.calendars.count(), db.events.count(), db.images.count(),
      db.docLinks.count(), db.books.count(), db.chapters.count(), db.scenes.count(),
      db.plotlines.count(), db.beats.count(),
    ])
    return {
      pages, maps, pins, regions, templates, calendars, events, images, docLinks,
      books, chapters, scenes, plotlines, beats,
    }
  }

  async function handleRestore() {
    const opened = await openTextFile() // native Open dialog in the shell, file input in the browser
    if (!opened) return
    let incoming: BackupCounts
    try {
      incoming = parseBackup(opened.text).counts
    } catch (err) {
      setNotice({
        title: 'Could not read backup',
        body: err instanceof Error ? err.message : 'That file could not be read.',
      })
      return
    }
    setPendingImport({ json: opened.text, current: await loadCounts(), incoming, kind: 'backup' })
  }

  async function confirmImport() {
    if (!pendingImport) return
    const { json, kind } = pendingImport
    setPendingImport(null)
    setBusy(true)
    try {
      await downloadPreImportBackup()
      if (kind === 'snapshot') {
        await restoreSnapshot(json)
        setNotice({ title: 'Snapshot restored', body: 'Your text was rolled back to this snapshot. Images and maps were kept as they are now.' })
      } else {
        await importAll(json)
        setNotice({ title: 'Backup restored', body: 'Your codex was replaced with the backup contents.' })
      }
    } catch (err) {
      // importAll rolls the transaction back on failure (e.g. a crafted backup with
      // duplicate ids), so the current data survives — but the user still needs to
      // know it didn't take, rather than seeing nothing happen.
      setNotice({
        title: 'Import failed',
        body: err instanceof Error ? `${err.message} Your data was not changed.` : 'Import failed. Your data was not changed.',
      })
    } finally { setBusy(false) }
  }

  const fmtCounts = (c: BackupCounts) =>
    `${c.pages} pages · ${c.maps} maps · ${c.pins} pins · ${c.regions} regions · ${c.templates} page-types · ${c.calendars} calendars · ${c.events} events · ${c.books} books · ${c.scenes} scenes`

  return (
    <div className="settings-page">
      <h1 className="settings-title">Settings</h1>

      {/* Auto-snapshots */}
      <section className="settings-section">
        <h2>Auto-snapshots</h2>
        <div className="settings-controls">
          <label className="settings-field">
            <span>Snapshot after this many changes</span>
            <input
              type="number" min={1} max={100} value={s.snapshotChangeThreshold}
              onChange={setNumField('snapshotChangeThreshold')}
            />
          </label>
          <label className="settings-field">
            <span>…or after this many hours of activity</span>
            <input
              type="number" min={1} max={100} value={s.snapshotTimeHours}
              onChange={setNumField('snapshotTimeHours')}
            />
          </label>
          <label className="settings-field">
            <span>Keep newest snapshots</span>
            <input
              type="number" min={1} max={100} value={s.snapshotRetention}
              onChange={setNumField('snapshotRetention')}
            />
          </label>
        </div>

        {snapshots.length === 0 ? (
          <p className="empty-hint">No snapshots yet. They're taken automatically as you edit.</p>
        ) : (
          <div className="snapshot-list">
            {snapshots.map((snap) => (
              <div key={snap.id} className="snapshot-row">
                <div className="snapshot-meta">
                  <span className="snapshot-time">{new Date(snap.timestamp).toLocaleString()}</span>
                  <span className="snapshot-count">{snap.editCount} pages changed</span>
                </div>
                <button
                  className="ghost-btn"
                  disabled={busy}
                  onClick={async () => {
                    const { counts: incoming } = parseBackup(snap.data)
                    setPendingImport({ json: snap.data, current: await loadCounts(), incoming, kind: 'snapshot' })
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Linking */}
      <section className="settings-section">
        <h2>Linking</h2>
        <label className="settings-field settings-field-check">
          <input
            type="checkbox"
            checked={s.autolinkEnabled}
            onChange={(e) => setField({ autolinkEnabled: e.target.checked })}
          />
          <span>Auto-link page titles in body text</span>
        </label>
        <p className="empty-hint">
          Links the first mention of another page's title in each page's body. Your own
          [[links]] always take precedence.
        </p>
      </section>

      {/* Backup & data */}
      <section className="settings-section backup">
        <h2>Backup &amp; data</h2>

        <div className="backup-status">
          <div className={`status-row ${needsBackup ? 'warn' : 'ok'}`}>
            <span className="status-dot" />
            {needsBackup
              ? `${unbacked} change${unbacked === 1 ? '' : 's'} not backed up yet.`
              : 'All changes are backed up.'}
            <span className="status-sub">Last backup: {timeAgo(lastBackup ?? null)}</span>
          </div>
          <div className={`status-row ${persisted ? 'ok' : 'warn'}`}>
            <span className="status-dot" />
            {persisted === null
              ? 'Checking browser storage…'
              : persisted
                ? 'Browser storage is persistent — Firefox won\'t auto-clear your data.'
                : 'Browser storage is best-effort (could be auto-cleared).'}
            {persisted === false && <button className="mini-btn" onClick={enablePersist}>Make persistent</button>}
          </div>
        </div>

        <label className="settings-field">
          <span>Warn me to back up after this many days</span>
          <input
            type="number" min={1} max={100} value={s.backupOverdueDays}
            onChange={setNumField('backupOverdueDays')}
          />
        </label>

        <div className="home-cta">
          <button className="primary-btn" disabled={busy} onClick={handleBackup}>
            {busy ? 'Backing up…' : '⭳ Back up now'}
          </button>
          <button className="ghost-btn" onClick={handleRestore}>⭱ Restore from backup</button>
          <button className="ghost-btn" disabled={exporting} onClick={handleExportHtml}>
            {exporting ? 'Exporting…' : 'Export as HTML'}
          </button>
        </div>

        {isTauri() ? (
          <div className="backup-tip">
            <strong>💡 Keep backups safe (recommended):</strong>
            <p>
              <strong>Back up now</strong> opens a Save dialog — point it at a folder inside{' '}
              <em>Dropbox</em>, <em>OneDrive</em>, or <em>Google Drive</em> so every backup is
              copied off this machine automatically. A recovery copy is also written to the
              app's data folder before any restore.
            </p>
          </div>
        ) : (
          <div className="backup-tip">
            <strong>💡 Make backups automatic &amp; safe (recommended):</strong>
            <p>
              Your lore is saved inside Firefox. To keep a copy that survives even if the browser is
              cleared, point Firefox's downloads at a cloud-synced folder:
            </p>
            <ol className="backup-steps" aria-label="Backup steps">
              <li>
                <strong>Make a synced folder.</strong> Anywhere inside <em>Dropbox</em>,{' '}
                <em>OneDrive</em>, or <em>Google Drive</em> — e.g. <code>Lore Backups</code>.
              </li>
              <li>
                <strong>Point Firefox at it.</strong> <em>Settings → General → Files and
                Applications → Downloads</em>, then set "Save files to" to that folder.
              </li>
              <li>
                <strong>Click "Back up now" when warned.</strong> The file lands in your synced folder and
                is copied to the cloud automatically.
              </li>
            </ol>
          </div>
        )}
      </section>

      {/* Danger zone */}
      <section className="settings-section danger-zone">
        <h2>Danger zone</h2>
        <p className="empty-hint">Deleting this world removes all its pages, maps, and history. This cannot be undone — back up first.</p>
        <button className="danger-btn" onClick={() => setConfirmDelete(true)}>Delete this world</button>
      </section>

      <ConfirmDialog
        open={pendingImport !== null}
        danger
        title={pendingImport?.kind === 'snapshot' ? 'Restore this snapshot?' : 'Replace your codex?'}
        confirmLabel={pendingImport?.kind === 'snapshot' ? 'Restore text' : 'Replace everything'}
        cancelLabel="Cancel"
        onConfirm={confirmImport}
        onCancel={() => setPendingImport(null)}
      >
        {pendingImport && (
          <>
            {pendingImport.kind === 'snapshot' ? (
              <p><strong>This rolls your writing back to this snapshot.</strong> Your images and maps are kept as they are now — snapshots don’t version those (use a full backup for that).</p>
            ) : (
              <p><strong>This replaces everything currently in your codex.</strong></p>
            )}
            <p>
              <strong>Current:</strong> {fmtCounts(pendingImport.current)}<br />
              <strong>Incoming:</strong> {fmtCounts(pendingImport.incoming)}
            </p>
            <p>A recovery copy of your current data is saved first. <strong>This cannot be undone.</strong></p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmDelete}
        danger
        title="Delete this world?"
        confirmLabel="Delete world"
        cancelLabel="Cancel"
        onConfirm={() => deleteLore(currentLoreId())}
        onCancel={() => setConfirmDelete(false)}
      >
        <p><strong>This permanently deletes the active world and everything in it.</strong></p>
        <p>This cannot be undone. Make sure you have a backup first.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={notice !== null}
        hideCancel
        title={notice?.title ?? ''}
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      >
        <p>{notice?.body}</p>
      </ConfirmDialog>
    </div>
  )
}
