import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  getMeta,
  importAll,
  restoreSnapshot,
  parseBackup,
  getSnapshots,
  countAll,
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
import { openTextFile, isTauri, pickDirectory, appVersion, readRegistryMirror } from '../platform'
import { useSharedUpdateCheck } from '../UpdateCheckContext'
import { getAppSettings, updateAppSettings, DEFAULT_APP_SETTINGS, SPELLCHECK_LANGS, type AppSettings } from '../appSettings'
import { withMirroringSuspended, getMirrorHealth, mirrorFilePath, type MirrorHealth } from '../worldMirrorSync'
import { parseDiskRegistry } from '../worldRecovery'
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
  const lastBackup = useLiveQuery(() => getMeta<number>(LAST_BACKUP_KEY), [])
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

  // App-level (device) prefs live in the registry DB, not this world's meta —
  // they are not properties of a world and must not travel in its backups.
  const app = useLiveQuery(() => getAppSettings(), [])
  const a = app ?? DEFAULT_APP_SETTINGS
  const desktop = isTauri()
  function setApp(patch: Partial<AppSettings>) {
    updateAppSettings(patch) // useLiveQuery re-reads; no local mirror to drift
  }

  const { state: updateState, check: runUpdateCheck, download: downloadUpdate, install: installUpdate } = useSharedUpdateCheck()
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { appVersion().then(setVersion) }, [])

  useEffect(() => {
    isStoragePersisted().then(setPersisted)
  }, [])

  // World-mirror health (#174 I4): getMirrorHealth() is a plain accessor over
  // module state, not a live subscription — poll it while this page is open
  // so a write landing in the background (the 30s cadence, or a close-flush
  // from a previous session) doesn't leave a stale readout on screen for the
  // rest of the visit. Desktop-only: the mirror never runs in the browser, so
  // there is nothing to poll there.
  const [mirrorHealth, setMirrorHealth] = useState<MirrorHealth | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    const read = () => setMirrorHealth(getMirrorHealth())
    read()
    const id = setInterval(read, 5000)
    return () => clearInterval(id)
  }, [])

  // World-index readability (#174 task r3, item 3): every registry.json
  // writer (syncRegistryMirror/dropFromRegistryMirror/stampRegistryMirrored)
  // correctly refuses to write when the disk read comes back unreadable —
  // but a refusal that never surfaces means `mirroredAt` freezes, new worlds
  // never enter the index, and the mirror-health block above still reports a
  // healthy "Last written N ago" (it only tracks writeWorldMirror outcomes,
  // not whether that write's stamp into the index actually landed). Polled
  // on the same cadence as mirror health, for the same reason: a write
  // landing in the background, or the index becoming readable/unreadable
  // between renders, must not leave a stale readout for the rest of the
  // visit. Display-only — this route never writes registry.json, so
  // degrading `ok: false` to a plain boolean here is safe (worldRecovery.ts).
  const [indexReadable, setIndexReadable] = useState<boolean | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const read = () => {
      readRegistryMirror()
        .then((r) => {
          if (!cancelled) setIndexReadable(parseDiskRegistry(r).ok)
        })
        // Only reachable if the dynamic plugin-fs import itself fails. Treat it
        // as "cannot read the index", which is what this readout exists to
        // report — never leave it stuck on the last good value.
        .catch(() => { if (!cancelled) setIndexReadable(false) })
    }
    read()
    const id = setInterval(read, 5000)
    return () => { cancelled = true; clearInterval(id) }
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
    setPendingImport({ json: opened.text, current: await countAll(), incoming, kind: 'backup' })
  }

  async function confirmImport() {
    if (!pendingImport) return
    const { json, kind } = pendingImport
    setPendingImport(null)
    setBusy(true)
    try {
      await downloadPreImportBackup()
      if (kind === 'snapshot') {
        // Suspend the mirror poll across the clear-then-repopulate window: a
        // write landing mid-restore would export a stale/incomplete active
        // world and rename it over a perfectly good mirror (#174).
        // restoreSnapshot carries the identical clear-and-repopulate shape as
        // importAll below, for the same reason.
        await withMirroringSuspended(() => restoreSnapshot(json))
        setNotice({ title: 'Snapshot restored', body: 'Your text was rolled back to this snapshot. Images and maps were kept as they are now.' })
      } else {
        // Suspend the mirror poll across the clear-then-repopulate window: a
        // write landing mid-import would export a stale/incomplete active
        // world and rename it over a perfectly good mirror (#174).
        await withMirroringSuspended(() => importAll(json))
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

      {/* General */}
      <section className="settings-section">
        <h2>General</h2>
        <label className="settings-field">
          <span className="settings-label">Open the last world on launch</span>
          <input
            type="checkbox"
            checked={a.openLastWorld}
            onChange={(e) => setApp({ openLastWorld: e.target.checked })}
          />
          <span className="settings-hint">
            Skip the world picker and go straight back to whichever world you were last in.
          </span>
        </label>
      </section>

      {/* Editor */}
      <section className="settings-section">
        <h2>Editor</h2>
        <label className="settings-field">
          <span className="settings-label">Check spelling as I write</span>
          <input
            type="checkbox"
            checked={a.spellcheck}
            onChange={(e) => setApp({ spellcheck: e.target.checked })}
          />
          <span className="settings-hint">
            Underlines misspelled words in the page and manuscript editors.
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-label">Spellcheck language</span>
          <select
            value={a.spellcheckLang}
            onChange={(e) => setApp({ spellcheckLang: e.target.value })}
          >
            {SPELLCHECK_LANGS.map((l) => (
              <option key={l.id || 'system'} value={l.id}>{l.label}</option>
            ))}
          </select>
          <span className="settings-hint">
            The dictionary comes from your browser or operating system — a language you
            haven't installed there quietly falls back to the system default.
          </span>
        </label>
        <label className="settings-field">
          <span className="settings-label">Auto-link page titles in body text</span>
          <input
            type="checkbox"
            checked={s.autolinkEnabled}
            onChange={(e) => setField({ autolinkEnabled: e.target.checked })}
          />
          <span className="settings-hint">
            Links the first mention of another page's title in each page's body. Your own
            [[links]] always take precedence.
          </span>
        </label>
      </section>

      {/* Auto-snapshots */}
      <section className="settings-section">
        <h2>Auto-snapshots</h2>
        <label className="settings-field">
          <span className="settings-label">Snapshot after this many changes</span>
          <input
            type="number" min={1} max={100} value={s.snapshotChangeThreshold}
            onChange={setNumField('snapshotChangeThreshold')}
          />
          <span className="settings-hint">A snapshot is taken once this many pages have changed.</span>
        </label>
        <label className="settings-field">
          <span className="settings-label">…or after this many hours of activity</span>
          <input
            type="number" min={1} max={100} value={s.snapshotTimeHours}
            onChange={setNumField('snapshotTimeHours')}
          />
          <span className="settings-hint">…or once this long has passed with at least one change.</span>
        </label>
        <label className="settings-field">
          <span className="settings-label">Keep newest snapshots</span>
          <input
            type="number" min={1} max={100} value={s.snapshotRetention}
            onChange={setNumField('snapshotRetention')}
          />
          <span className="settings-hint">Older snapshots are pruned beyond this count.</span>
        </label>

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
                    setPendingImport({ json: snap.data, current: await countAll(), incoming, kind: 'snapshot' })
                  }}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        )}
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
          <span className="settings-label">Warn me to back up after this many days</span>
          <input
            type="number" min={1} max={100} value={s.backupOverdueDays}
            onChange={setNumField('backupOverdueDays')}
          />
          <span className="settings-hint">A banner nags you once this many days pass without a backup.</span>
        </label>

        <div className="settings-cta">
          <button className="primary-btn" disabled={busy} onClick={handleBackup}>
            {busy ? 'Backing up…' : '⭳ Back up now'}
          </button>
          <button className="ghost-btn" onClick={handleRestore}>⭱ Restore from backup</button>
          <button className="ghost-btn" disabled={exporting} onClick={handleExportHtml}>
            {exporting ? 'Exporting…' : 'Export as HTML'}
          </button>
        </div>

        <label className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Back up when I close the app</span>
          <input
            type="checkbox"
            disabled={!desktop}
            checked={a.backupOnExit}
            onChange={(e) => setApp({ backupOnExit: e.target.checked })}
          />
          <span className="settings-hint">
            {desktop
              ? 'Writes a copy into the app’s data folder on exit, if anything changed. It’s a safety net, not an off-machine backup — it doesn’t clear the reminder above.'
              : 'Desktop app only. A browser can’t finish saving a file while the tab is closing.'}
          </span>
        </label>

        <div className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Default backup folder</span>
          <button
            className="mini-btn"
            disabled={!desktop}
            aria-label="Default backup folder"
            onClick={async () => {
              const dir = await pickDirectory()
              if (dir) setApp({ defaultBackupDir: dir })
            }}
          >
            {a.defaultBackupDir ? 'Change…' : 'Choose…'}
          </button>
          <span className="settings-hint">
            {desktop
              ? a.defaultBackupDir
                ? `“Back up now” opens here: ${a.defaultBackupDir}`
                : 'Pick a cloud-synced folder and “Back up now” will open there — one click instead of navigating every time.'
              : 'Desktop app only. Browsers always save to their own downloads folder.'}
          </span>
        </div>

        <div className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">World file</span>
          <span>{desktop ? mirrorFilePath() : '—'}</span>
          <span className="settings-hint">
            {desktop
              ? mirrorHealth?.lastSuccessAt
                ? `An always-current copy of this world, kept automatically inside the app's data folder as a durability net if the browser storage is ever lost. Last written ${timeAgo(mirrorHealth.lastSuccessAt)}.`
                : "An always-current copy of this world, kept automatically inside the app's data folder as a durability net if the browser storage is ever lost. Last written: never — expected right after launch, before the first quiet moment; it writes on its own as you keep editing."
              : 'Desktop app only. A browser has no filesystem to mirror to.'}
          </span>
          {desktop && mirrorHealth?.lastError && (
            <span className="settings-hint-danger">
              Last write failed {timeAgo(mirrorHealth.lastError.at)}: {mirrorHealth.lastError.message}
            </span>
          )}
          {desktop && indexReadable === false && (
            <span className="settings-hint-danger">
              The world index (registry.json) can't be read right now, so nothing new can be
              recorded into it — mirrors keep being written, but new or updated worlds won't be
              findable from them, and the durability net is effectively off until this is fixed.
            </span>
          )}
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

      <section className="settings-section">
        <h2>Updates</h2>

        <div className="settings-field">
          <span className="settings-label">Version</span>
          <span>{version ?? '—'}</span>
          <span className="settings-hint">
            {desktop
              ? 'The installed desktop version.'
              : 'Running in a browser — updates arrive when the page reloads.'}
          </span>
        </div>

        <label className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Check for updates automatically</span>
          <input
            type="checkbox"
            disabled={!desktop}
            checked={a.autoUpdateCheck}
            onChange={(e) => setApp({ autoUpdateCheck: e.target.checked })}
          />
          <span className="settings-hint">
            {desktop
              ? 'Asks GitHub once a day whether a newer release exists. This is the only time Lore Codex reaches the network on its own — turn it off and it never does. “Check now” below still works when you ask for it.'
              : 'Desktop app only.'}
          </span>
        </label>

        <div className={`settings-field${desktop ? '' : ' is-disabled'}`}>
          <span className="settings-label">Check now</span>
          <button
            className="mini-btn"
            disabled={!desktop || updateState.status === 'checking' || updateState.status === 'downloading'}
            onClick={() => void runUpdateCheck(true)}
          >
            {updateState.status === 'checking' ? 'Checking…' : 'Check now'}
          </button>
          <span className="settings-hint">
            {updateState.status === 'none' && 'You’re on the latest version.'}
            {updateState.status === 'available' && `Version ${updateState.version} is available.`}
            {updateState.status === 'downloading' &&
              (updateState.pct === null ? 'Downloading…' : `Downloading… ${updateState.pct}%`)}
            {updateState.status === 'ready' && `${updateState.version} is ready — restarting will close the app.`}
            {updateState.status === 'error' && `Couldn’t check: ${updateState.message}`}
            {(updateState.status === 'idle' || updateState.status === 'checking' || updateState.status === 'installing') &&
              (desktop ? 'Ignores the once-a-day limit.' : 'Desktop app only.')}
          </span>
        </div>

        {updateState.status === 'available' && (
          <div className="settings-cta">
            <button className="ghost-btn" onClick={() => void downloadUpdate()}>Download {updateState.version}</button>
          </div>
        )}
        {updateState.status === 'ready' && (
          <div className="settings-cta">
            <button className="ghost-btn" onClick={() => void installUpdate()}>Restart to install</button>
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
