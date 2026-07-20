# Auto Updater — design

Issue: [#225](https://github.com/KantikPotatoe/Lore-Codex/issues/225) · Date: 2026-07-20

## Problem

The desktop shell ships as an unsigned NSIS installer attached to a GitHub
release on every `v*` tag. Nothing tells a running copy that a newer release
exists. Updating means noticing the repo has moved, downloading the installer,
and re-running it — friction measured against a release cadence of days, which
in practice means installed copies drift and stay drifted.

## Decision

Full in-app updates via `tauri-plugin-updater`: the app checks GitHub for a
signed update manifest, shows a banner when one is newer, downloads it on
request, and installs on a second, explicit click.

Rejected: *notify-only* (a banner linking to the release page) — cheaper, no
signing key to own, but it preserves exactly the friction this issue exists to
remove. *Fetch-the-installer-ourselves* — most of the plumbing of a real
updater with none of its payoff.

## The local-first tension

Lore Codex makes zero outbound network requests today, and "nothing leaves the
machine" is a stated property of the product. An update check contacts GitHub,
which necessarily observes the requesting IP and the timing of each check.

This is resolved, not waved away: the check is governed by a device-level
`autoUpdateCheck` preference, on by default, switchable off in Settings. The
docs claim becomes "no data leaves the machine unless you leave update checks
on" — which stays true. The request itself is a bare GET carrying no
identifiers or telemetry beyond what any HTTP request carries.

## Key custody

The minisign private key is the root of trust. Every installed build pins the
matching **public** key and refuses any update not signed by it.

- **Losing the key** permanently strands every installed copy. Recovery
  means shipping a new build with a new pubkey, installed manually — the exact
  failure this feature exists to prevent.
- **Leaking the key**, combined with control of the update endpoint, permits a
  signed malicious update. Low probability for a personal tool; not zero.

Custody: generated locally with a password, stored in the maintainer's password
manager, and mirrored into GitHub Actions secrets. Two copies, neither in the
repository. GitHub secrets alone is rejected — they are write-only, so an
accidental deletion is unrecoverable.

Generation is a **manual maintainer step**, deliberately outside any automated
tooling so the private key never passes through a transcript or agent context:

```
npx tauri signer generate -w $HOME/.tauri/lore-codex.key
```

Secrets to create on the repo: `TAURI_SIGNING_PRIVATE_KEY`,
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Release infrastructure

| File | Change |
|---|---|
| `.github/workflows/release.yml` | `includeUpdaterJson: true` on the `tauri-action` step; the two signing env vars |
| `src-tauri/tauri.conf.json` | `plugins.updater`: `pubkey` + one endpoint |
| `src-tauri/Cargo.toml` | `tauri-plugin-updater`; `tauri-plugin-process` only if empirically needed |
| `src-tauri/src/lib.rs` | register the plugin(s) behind `#[cfg(desktop)]` |
| `src-tauri/capabilities/default.json` | `updater:default` (+ `process:allow-restart` if used) |

Endpoint: `https://github.com/KantikPotatoe/Lore-Codex/releases/latest/download/latest.json`.
The `/latest/download/` path always resolves to the newest release, so the
endpoint is written once and never maintained.

**No CSP change is expected.** The updater performs its HTTP fetch in Rust, not
the webview, so `connect-src` stays closed. This is an expectation to verify
during implementation, not an assumption to build on — if the check fails in the
shell with a CSP violation, the finding is that this was wrong.

## Application architecture

### `src/platform.ts` — the shell seam

Three additions. Per the existing lint-enforced rule, this is the **only**
module permitted to import `@tauri-apps/*`:

- `checkForUpdate(): Promise<UpdateInfo | null>` — resolves `null` in the
  browser, unconditionally.
- `downloadUpdate(onProgress: (pct: number) => void): Promise<void>`
- `installUpdate(): Promise<void>`

Download and install are **separate calls**, not one `downloadAndInstall`. This
is what makes "download now, restart when you're ready" possible: on Windows the
NSIS installer terminates the running app to replace its files, so an
install-on-download would close the app under an author mid-scene.

### `src/updater.ts` — pure decision logic

No Tauri imports, no React, fully unit-testable:

- `shouldCheck({ enabled, lastCheckedAt, now }): boolean` — the 24h throttle.
- `isDismissed(version, dismissedVersion): boolean` — string equality. No
  semver comparison is needed anywhere in our code; the plugin decides whether
  the remote version is newer, and dismissal only needs "is this the same
  version I already dismissed".

### `src/appSettings.ts` — three device-level fields

`autoUpdateCheck: boolean` (default `true`), `lastUpdateCheckAt: number | null`,
`dismissedUpdateVersion: string | null`. Validated in `coerceSettings` in the
existing style. These belong in the registry DB rather than per-world `meta`:
none is a property of a world, and living in the registry makes them
structurally incapable of travelling inside a world backup.

### `src/useUpdateCheck.ts` — one hook, one state machine

`idle → checking → available → downloading(pct) → ready → installing`, plus a
terminal `error`. Both consumers read this one hook, so the banner and the
Settings panel can never disagree about state.

### `src/components/UpdateBanner.tsx`

Structurally and stylistically a sibling of `BackupBanner` — same placement in
`App.tsx`, same CSS idiom. Dismissal writes `dismissedUpdateVersion`, so a
dismissed version stays dismissed until a *newer* one appears.

### `SettingsRoute` — an "Updates" section

Current version, the `autoUpdateCheck` toggle, a "Check now" button that
bypasses the throttle and surfaces errors inline, and the last-checked
timestamp. Hidden entirely when `!isTauri()`.

## Flow

Startup, after a ~2s delay so the check never competes with world load →
`shouldCheck` → check → if an update exists and is not dismissed, the banner
appears. "Download" → progress → "Ready — Restart to install" → `installUpdate()`.

Manual "Check now" bypasses the throttle.

## Failure handling

Automatic checks fail **silently** — logged, not surfaced. No network, GitHub
down, and rate-limiting are all non-problems, and a banner announcing them is
pure noise. Manual checks **do** surface errors, because there the user asked.

A signature mismatch causes the plugin to refuse the update; it is treated as
"no update available" and logged.

## Testing

Unit tests cover `updater.ts` (throttle boundaries including exactly-24h,
dismissal identity) and the `appSettings` coercion of the three new fields,
including malformed stored values. The hook is tested against a mocked platform
seam across the state machine, including the error path.

**The signed download-and-install path cannot be exercised in CI** — it requires
a real signed release built from the real private key. That path is verified
manually, once, against the first release that ships after this lands. This
limitation is stated rather than papered over: until that manual verification
happens, the end-to-end update is untested code.

## Out of scope

Rollback to a previous version. Update channels (beta/stable). Delta updates.
macOS and Linux targets — the bundle is Windows/NSIS only today.
