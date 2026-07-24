---
paths:
  - src-tauri/**
  - src/platform.ts
---

# Desktop shell — `src-tauri/` + `src/platform.ts` (transition Phases 0–1)

Tauri v2 wraps the unchanged web app (WebView2; data still in IndexedDB inside the webview). See `docs/desktop-transition-investigation.md` for the full plan.

**The seam** (the `platform.ts` exclusivity rule itself lives in the root `CLAUDE.md` — it applies everywhere, not just here):

- `saveFile(data, name, { defaultDir })` — browser download vs native Save-As pre-filled with `defaultDir`; returns `false` on dialog cancel, and `downloadBackup()` only stamps `lastBackupAt` when saved.
- `openTextFile()` — file input vs native Open; feeds Settings restore and the selector's import wizard.
- `writeAppData(relPath, text)` — shell-only, `false` in browser; pre-import safety copies land in `$APPDATA/backups`.
- `printHtml(html)` — hidden-iframe print on both targets; `printBook` uses it, so no `window.open`.
- `pickDirectory()` — shell-only native folder picker. The path is a **hint that pre-fills the Save dialog, never a write grant**: Tauri only scopes fs writes to paths picked in the *current* session's dialog, so a folder remembered from an earlier session can't be written to.
- `onCloseRequested(handler)` — shell-only; intercepts window close, awaits `handler` (wrapped so a failing/hanging handler can never wedge the window shut), then destroys the window. A no-op in the browser.

`App.tsx` wires the close handler to `backupOnExit()` (`src/backup.ts`), racing it against a 5s timeout so a hung export can't leave the app unclosable. Because `pickDirectory()`'s result is never a write grant, `backupOnExit()` writes to `$APPDATA/backups` instead of the user's chosen folder, and — unlike a normal backup — deliberately does **not** stamp `LAST_BACKUP_KEY`: an `$APPDATA` copy hasn't left the machine, so silencing the backup-reminder banner would be a lie. The only new permission this needed is `core:window:allow-destroy` (no new fs scope, no new Rust deps).

**Migration wizard:** `LoreSelectorRoute`'s "Import World" → `parseBackup` → `importLoreFromBackup(name, json)` (`lores.ts`: registers a world *without* switching, imports via `importBackupInto(target, json)` — the parameterized twin of `importAll` — then the caller `switchLore`s; App-start seeding fills missing built-ins).

**Config & CI:** Shell permissions live in `src-tauri/capabilities/default.json` (dialog save/open + writes to dialog-picked paths + `$APPDATA` writes; keep minimal); CSP is set in `tauri.conf.json` (`img-src data: blob:` is load-bearing). Rust side stays config-only (`lib.rs` registers dialog/fs plugins). `tauri.conf.json` reads `version` from `package.json`; `release.yml` builds the installer on every `v*` tag, and `desktop.yml` runs `cargo check` on `windows-latest` for PRs touching `src-tauri/**` or `package.json` (`build.rs` validates the config, the semver it reads from `package.json`, and the capability ACL — so those regressions fail on the PR, not at release). Web build/tests are unaffected — the shell path is behind feature detection.
