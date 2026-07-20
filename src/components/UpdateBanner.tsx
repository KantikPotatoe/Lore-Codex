import { useEffect } from 'react'
import { useUpdateCheck } from '../useUpdateCheck'
import { CHECK_DELAY_MS } from '../updater'
import { isTauri } from '../platform'

// A sibling of BackupBanner: same bar, same placement, same dismiss idiom.
// Desktop only — a browser tab has nothing to install.
//
// Errors are deliberately invisible here. An automatic check that failed is
// not news; the Settings panel reports failures, because there the user asked.
export default function UpdateBanner() {
  const { state, check, download, install, dismiss } = useUpdateCheck()
  const desktop = isTauri()

  useEffect(() => {
    if (!desktop) return
    // A beat after mount, so the check never competes with loading a world.
    const t = setTimeout(() => { void check(false) }, CHECK_DELAY_MS)
    return () => clearTimeout(t)
  }, [desktop, check])

  if (!desktop) return null

  if (state.status === 'available') {
    return (
      <div className="update-banner">
        <span>✦ Lore Codex {state.version} is available.</span>
        <div className="backup-banner-actions">
          <button className="backup-banner-btn" onClick={() => void download()}>Download</button>
          <button className="backup-banner-x" title="Dismiss until the next version" onClick={() => void dismiss()}>×</button>
        </div>
      </div>
    )
  }

  if (state.status === 'downloading') {
    return (
      <div className="update-banner">
        <span>{state.pct === null ? 'Downloading…' : `Downloading ${state.version}… ${state.pct}%`}</span>
        {state.pct !== null && (
          <div className="update-progress" role="progressbar" aria-valuenow={state.pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="update-progress-fill" style={{ width: `${state.pct}%` }} />
          </div>
        )}
      </div>
    )
  }

  if (state.status === 'ready') {
    return (
      <div className="update-banner">
        <span>✦ {state.version} is ready. Restarting will close the app and run the installer.</span>
        <div className="backup-banner-actions">
          <button className="backup-banner-btn" onClick={() => void install()}>Restart to install</button>
          {/* No dismiss here, deliberately. The installer is already on disk;
              dismissing would record the version and hide it from every future
              automatic check while install() no-ops on a cleared handle. The
              hook refuses it too — this just avoids rendering a dead control. */}
        </div>
      </div>
    )
  }

  if (state.status === 'installing') {
    return <div className="update-banner"><span>Installing… the app will close.</span></div>
  }

  // idle / checking / none / error — nothing worth a bar.
  return null
}
