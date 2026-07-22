import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Navigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import {
  listLores,
  currentLoreId,
  switchLore,
  createLore,
  renameLore,
  deleteLore,
  setLoreBanner,
  importLoreFromBackup,
  type Lore,
} from '../lores'
import { parseBackup, type BackupCounts } from '../db'
import { openTextFile, readRegistryMirror, readWorldMirror } from '../platform'
import { parseDiskRegistry, plannedRecovery, type RecoverableWorld } from '../worldRecovery'
import { timeAgo } from '../backup'
import { compressImage } from '../imageUtils'
import { getAppSettings, shouldOpenLastWorld } from '../appSettings'
import { CURRENT_LORE_KEY } from '../loreId'
import ConfirmDialog from '../components/ConfirmDialog'
import EmptyState from '../components/EmptyState'

// Only the first arrival at "/" in a page's life may auto-redirect. switchLore()
// and deleteLore() both reload the page, so this resets exactly when it should.
let startupHandled = false

// "Startup" = the page LOADED at the picker. A later client-side arrival at "/"
// is the user ASKING for the picker (Sidebar's "Switch world"), and must never be
// redirected away. switchLore() reloads to #/home, so a mount-based guard (i.e.
// "has this route mounted before in this page's life?") would misread the FIRST
// click after any reload as a cold launch — the route never mounted at #/home,
// so `startupHandled` was still false, and the deliberate click got bounced
// straight back (a dead click; a second click then worked, because the bounced
// mount had set the flag). Read once at module scope, before React mounts.
const loadedAtRoot =
  !window.location.hash || window.location.hash === '#' || window.location.hash === '#/'

/** A world name derived from a backup's filename — the stem, unless it's one
 *  of our own timestamped export names, which make poor world names. */
function nameFromFilename(filename: string): string {
  const stem = filename.replace(/\.json$/i, '').trim()
  if (!stem || /^lore-(backup|pre-import|export)/i.test(stem)) return 'Imported World'
  return stem
}

export default function LoreSelectorRoute() {
  const [pendingDelete, setPendingDelete] = useState<Lore | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [creating, setCreating] = useState(false)
  const bannerInputRef = useRef<HTMLInputElement>(null)
  const [bannerTargetId, setBannerTargetId] = useState<string | null>(null)
  // Import-world wizard (desktop transition: how Firefox-era worlds migrate).
  const [pendingWizard, setPendingWizard] = useState<{
    json: string
    counts: BackupCounts
    name: string
  } | null>(null)
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  // Worlds found on disk that the registry DB doesn't know about (#174 — the
  // storage-was-wiped case). One read of a known path on mount, never a
  // directory listing; see worldRecovery.ts.
  const [diskWorlds, setDiskWorlds] = useState<RecoverableWorld[] | null>(null)
  const [restoring, setRestoring] = useState<string | null>(null)

  const loresRaw = useLiveQuery(listLores, [])
  const lores = loresRaw ?? []
  const appSettings = useLiveQuery(() => getAppSettings(), [])
  const activeId = currentLoreId()

  const autoOpen =
    loresRaw !== undefined &&
    appSettings !== undefined &&
    shouldOpenLastWorld({
      openLastWorld: appSettings.openLastWorld,
      storedLoreId: localStorage.getItem(CURRENT_LORE_KEY),
      knownIds: loresRaw.map((l) => l.id),
      // The page didn't load at the picker, so this mount is a deliberate
      // "Switch world" click, not a launch — treat startup as already handled.
      startupHandled: startupHandled || !loadedAtRoot,
    })

  useEffect(() => {
    // Set in an effect, never during render — mutating module state while
    // rendering violates react-hooks/purity (and would misfire under StrictMode).
    // Gated on both queries having resolved: an empty-deps effect fires in the
    // first passive-effect pass, before either useLiveQuery result can arrive
    // (Dexie resolves on a later microtask) — so by the time the data landed,
    // startupHandled was already true and the redirect could never fire on a
    // real cold launch. Only mark it handled once the decision was actually made.
    if (loresRaw === undefined || appSettings === undefined) return
    startupHandled = true
  }, [loresRaw, appSettings])

  useEffect(() => {
    let cancelled = false
    readRegistryMirror()
      .then((text) => { if (!cancelled) setDiskWorlds(parseDiskRegistry(text)) })
      .catch(() => { if (!cancelled) setDiskWorlds([]) })
    return () => { cancelled = true }
  }, [])

  // Derived, not mirrored into state via an effect (this repo lints
  // setState-in-effect): the offer is a pure function of the disk read and
  // the live registry list.
  const recoverable = diskWorlds && loresRaw ? plannedRecovery(diskWorlds, loresRaw) : []

  async function handleCreate() {
    setCreating(true)
    await createLore() // triggers reload — setCreating never resolves visually
  }

  async function handleImportWorld() {
    const opened = await openTextFile()
    if (!opened) return
    try {
      const { counts } = parseBackup(opened.text)
      setPendingWizard({ json: opened.text, counts, name: nameFromFilename(opened.name) })
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'That file could not be read.')
    }
  }

  async function confirmImportWorld() {
    if (!pendingWizard || importing) return
    setImporting(true)
    try {
      const id = await importLoreFromBackup(pendingWizard.name, pendingWizard.json)
      setPendingWizard(null)
      switchLore(id) // reloads into the new world; App's start effect seeds any missing built-ins
    } catch (err) {
      setPendingWizard(null)
      setNotice(err instanceof Error ? err.message : 'The import failed. Nothing was created.')
    } finally {
      setImporting(false)
    }
  }

  async function restoreWorld(world: RecoverableWorld) {
    setRestoring(world.id)
    try {
      const json = await readWorldMirror(world.id)
      if (!json) throw new Error('That world file could not be read.')
      // parseBackup runs inside importLoreFromBackup and throws before any
      // world is registered, so a corrupt mirror leaves nothing behind.
      // Reuse the disk entry's own id: a recovered world IS the world, so it
      // keeps its identity and its file. A fresh id here would leave this
      // disk entry — real mirroredAt, still absent from the registry —
      // satisfying plannedRecovery forever, offering the same restore again
      // on every launch (see importLoreFromBackup's doc comment).
      await importLoreFromBackup(world.name, json, world.id)
      setDiskWorlds((prev) => prev?.filter((w) => w.id !== world.id) ?? null)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'That world could not be restored.')
    } finally {
      setRestoring(null)
    }
  }

  function startRename(lore: Lore) {
    setRenamingId(lore.id)
    setRenameValue(lore.name)
  }

  async function commitRename(id: string) {
    await renameLore(id, renameValue)
    setRenamingId(null)
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !bannerTargetId) return
    const dataUrl = await compressImage(file, 1200)
    await setLoreBanner(bannerTargetId, dataUrl)
    e.target.value = ''
    setBannerTargetId(null)
  }

  function openBannerPicker(id: string) {
    setBannerTargetId(id)
    bannerInputRef.current?.click()
  }

  // Still loading: render nothing rather than flashing the picker for a frame
  // before redirecting away from it.
  if (loresRaw === undefined || appSettings === undefined) return null
  if (autoOpen) return <Navigate to="/home" replace />

  return (
    <div className="lore-selector">
      {/* Branded hero */}
      <header className="lore-hero">
        <h1 className="lore-hero-title">Lore Codex</h1>
        <p className="lore-hero-tagline">Choose a world to enter, or forge a new one.</p>
        <hr className="lore-hero-rule" />
        <div className="lore-hero-actions">
          <button className="primary-btn" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating…' : '＋ New World'}
          </button>
          <button className="ghost-btn" onClick={handleImportWorld} disabled={importing}>
            {importing ? 'Importing…' : '⬆ Import World'}
          </button>
        </div>
      </header>

      {/* Worlds found on disk but missing from the registry (#174) — the
          storage-was-wiped case this feature exists for. Offers only; never
          writes anything without a click, and renders nothing when there's
          nothing to recover, which is the normal case for every install. */}
      {recoverable.length > 0 && (
        <section className="recovery-panel" aria-labelledby="recovery-heading">
          <h2 id="recovery-heading">
            {recoverable.length} world{recoverable.length === 1 ? '' : 's'} found on disk
          </h2>
          <p>
            These were mirrored to this computer but aren’t in your library — most
            likely the app’s local storage was cleared. Restoring re-imports them.
          </p>
          <ul>
            {recoverable.map((w, i) => (
              <li key={`${w.id}-${i}`}>
                <span className="recovery-name">{w.name}</span>
                <span className="recovery-meta">
                  mirrored {timeAgo(w.mirroredAt)}
                  {w.appVersion ? ` · v${w.appVersion}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => void restoreWorld(w)}
                  disabled={restoring !== null}
                >
                  {restoring === w.id ? 'Restoring…' : 'Restore'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Worlds grid */}
      <div className="lore-grid">
        {lores.map((lore, i) => {
          const isActive = lore.id === activeId
          return (
            <div
              key={lore.id}
              className={`world-card${isActive ? ' world-card--active' : ''}`}
              style={{ '--stagger-i': Math.min(i, 12) } as CSSProperties}
            >
              {/* The gateway. The image sits on its own layer so the hover zoom scales it
                  without dragging the decorated initial and the "Enter →" whisper with it. */}
              <div className="world-card-banner" onClick={() => switchLore(lore.id)}>
                <div
                  className="world-card-banner-img"
                  style={lore.banner ? { backgroundImage: `url(${lore.banner})` } : undefined}
                />
                {!lore.banner && (
                  <span className="world-card-initial">{lore.name.charAt(0).toUpperCase()}</span>
                )}
                <span className="world-card-enter">Enter →</span>
              </div>

              {/* The mat. */}
              <div className="world-card-mat">
                <div className="world-card-title-row">
                  {renamingId === lore.id ? (
                    <input
                      className="lore-rename-input"
                      value={renameValue}
                      autoFocus
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={() => commitRename(lore.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(lore.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                    />
                  ) : (
                    <>
                      <button
                        className="world-card-name"
                        onClick={() => switchLore(lore.id)}
                        title="Open this world"
                      >
                        {lore.name}
                      </button>
                      {isActive && <span className="world-card-badge">Current</span>}
                    </>
                  )}
                </div>

                <span className="world-card-date">
                  Founded {new Date(lore.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* Handling controls, over the banner — never on the engraved mat. Icon-only,
                  so aria-label is their only accessible name, and it names the world: N
                  cards render at once and "Rename world" alone would be ambiguous. */}
              <div className="world-card-actions">
                <button
                  className="world-card-action"
                  aria-label={`Rename ${lore.name}`}
                  title="Rename world"
                  onClick={() => startRename(lore)}
                >✎</button>
                <button
                  className="world-card-action"
                  aria-label={`Change banner for ${lore.name}`}
                  title="Change banner"
                  onClick={() => openBannerPicker(lore.id)}
                >🖼</button>
                <button
                  className="world-card-action danger"
                  aria-label={`Delete ${lore.name}`}
                  title="Delete world"
                  onClick={() => setPendingDelete(lore)}
                >✕</button>
              </div>
            </div>
          )
        })}

        {/* Add-world tile — shown alongside existing worlds */}
        {lores.length > 0 && (
          <button
            className="world-card-add"
            onClick={handleCreate}
            disabled={creating}
            style={{ '--stagger-i': Math.min(lores.length, 12) } as CSSProperties}
          >
            <span className="world-card-add-icon">＋</span>
            <span>{creating ? 'Creating…' : 'New World'}</span>
          </button>
        )}
      </div>

      {/* Empty state — shown when no worlds exist */}
      {lores.length === 0 && (
        <div className="lore-empty">
          <EmptyState icon="❧" title="No worlds yet — your stories await.">
            <button className="primary-btn" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create your first world'}
            </button>
            <p className="empty-hint">
              Coming from the browser version? Use <strong>Import World</strong> above with a
              backup file (Settings → Back up now, once per world) to bring each world across.
            </p>
          </EmptyState>
        </div>
      )}

      {/* Hidden banner file input */}
      <input
        ref={bannerInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={handleBannerChange}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={pendingDelete !== null}
        danger
        title={`Delete "${pendingDelete?.name}"?`}
        confirmLabel="Delete world"
        cancelLabel="Cancel"
        onConfirm={async () => {
          if (pendingDelete) {
            await deleteLore(pendingDelete.id)
            setPendingDelete(null)
          }
        }}
        onCancel={() => setPendingDelete(null)}
      >
        <p>This permanently deletes all pages, maps, templates, and snapshots in this world. <strong>This cannot be undone.</strong></p>
      </ConfirmDialog>

      {/* Import-world confirmation (name + counts) */}
      <ConfirmDialog
        open={pendingWizard !== null}
        title="Import as a new world?"
        confirmLabel={importing ? 'Importing…' : 'Import world'}
        cancelLabel="Cancel"
        onConfirm={confirmImportWorld}
        onCancel={() => setPendingWizard(null)}
      >
        {pendingWizard && (
          <>
            <p>
              This backup contains {pendingWizard.counts.pages} pages ·{' '}
              {pendingWizard.counts.maps} maps · {pendingWizard.counts.events} events ·{' '}
              {pendingWizard.counts.books} books. It becomes a brand-new world — nothing
              existing is touched.
            </p>
            <label className="dialog-field">
              <span>World name</span>
              <input
                value={pendingWizard.name}
                autoFocus
                onChange={(e) =>
                  setPendingWizard((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                }
              />
            </label>
          </>
        )}
      </ConfirmDialog>

      {/* Import problem notice */}
      <ConfirmDialog
        open={notice !== null}
        hideCancel
        title="Could not import"
        confirmLabel="OK"
        onConfirm={() => setNotice(null)}
        onCancel={() => setNotice(null)}
      >
        <p>{notice}</p>
      </ConfirmDialog>
    </div>
  )
}
