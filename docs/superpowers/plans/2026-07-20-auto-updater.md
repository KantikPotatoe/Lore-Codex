# Auto Updater Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop shell notices a newer GitHub release, offers it in a banner, downloads it on request, and installs on a second explicit click.

**Architecture:** `tauri-plugin-updater` fetches a minisign-signed `latest.json` attached to the GitHub release. All `@tauri-apps/*` calls stay inside `src/platform.ts` (the lint-enforced seam), which exposes `checkForUpdate()` returning an **`UpdateInfo` handle** carrying its own `download()`/`install()` methods. Pure throttle/dismissal logic lives in `src/updater.ts`; one hook (`useUpdateCheck`) drives both the banner and the Settings panel.

**Tech Stack:** Tauri v2, `tauri-plugin-updater` v2, React 19, Dexie (registry DB for device prefs), Vitest + happy-dom.

> **Refinement vs. the spec:** the spec sketched three free functions
> (`checkForUpdate` / `downloadUpdate` / `installUpdate`). This plan uses a
> **handle object** instead, because `install()` must act on the *same* Tauri
> `Update` instance that `check()` returned — free functions would need a
> module-level mutable holding that instance, which is a race waiting to
> happen. The seam rule is unaffected: the Tauri object never leaves
> `platform.ts`.

## Global Constraints

- TypeScript `strict`. Run `npm run lint`, `npm run build`, `npm run test:run` before claiming any task done.
- **Never** import `@tauri-apps/*` outside `src/platform.ts` — enforced by `no-restricted-imports` in `eslint.config.js`. Never write `'no-restricted-imports': 'off'` in a carve-out; re-declare the bans you keep.
- **Never** import the `db` singleton from UI code — use repositories. (Not relevant here: update prefs live in the **registry** DB via `appSettings.ts`.)
- The three new prefs are **device-level** and go in `src/appSettings.ts` (registry DB), never per-world `meta` — they must be structurally incapable of travelling in a world backup.
- No host `alert()`/`confirm()` — use `ConfirmDialog` if a dialog is ever needed.
- Repo: `KantikPotatoe/Lore-Codex`. Updater endpoint, verbatim:
  `https://github.com/KantikPotatoe/Lore-Codex/releases/latest/download/latest.json`
- Secret names, verbatim: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
- Automatic checks fail **silently** (console only). Manual "Check now" **surfaces** errors.
- Branch: `feat/225-auto-updater`. PR needs a `version:major` label (the issue carries it).

---

### Task 1: Device prefs for the updater

**Files:**
- Modify: `src/appSettings.ts`
- Test: `src/appSettings.test.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `AppSettings.autoUpdateCheck: boolean`, `AppSettings.lastUpdateCheckAt: number | null`, `AppSettings.dismissedUpdateVersion: string | null`; all defaulted in `DEFAULT_APP_SETTINGS`.

- [ ] **Step 1: Write the failing tests**

Add to `src/appSettings.test.ts`, inside the existing `describe('appSettings', ...)`:

```ts
  it('defaults the updater prefs to on, never-checked, nothing dismissed', () => {
    expect(DEFAULT_APP_SETTINGS.autoUpdateCheck).toBe(true)
    expect(DEFAULT_APP_SETTINGS.lastUpdateCheckAt).toBe(null)
    expect(DEFAULT_APP_SETTINGS.dismissedUpdateVersion).toBe(null)
  })

  it('round-trips the updater prefs', async () => {
    await updateAppSettings({
      autoUpdateCheck: false,
      lastUpdateCheckAt: 1_700_000_000_000,
      dismissedUpdateVersion: '0.39.0',
    })
    const a = await getAppSettings()
    expect(a.autoUpdateCheck).toBe(false)
    expect(a.lastUpdateCheckAt).toBe(1_700_000_000_000)
    expect(a.dismissedUpdateVersion).toBe('0.39.0')
  })

  it('rejects wrong-typed updater prefs on read', async () => {
    await registry.appMeta.put({
      key: APP_SETTINGS_KEY,
      value: {
        autoUpdateCheck: 'yes',
        lastUpdateCheckAt: 'never',
        dismissedUpdateVersion: 42,
      },
    })
    const a = await getAppSettings()
    expect(a.autoUpdateCheck).toBe(true)
    expect(a.lastUpdateCheckAt).toBe(null)
    expect(a.dismissedUpdateVersion).toBe(null)
  })
```

The existing test `defaults reproduce today’s behaviour` asserts `DEFAULT_APP_SETTINGS` with `toEqual` against an exact object literal — it will fail once fields are added. Update that literal to:

```ts
    expect(DEFAULT_APP_SETTINGS).toEqual({
      openLastWorld: false,
      spellcheck: true,
      spellcheckLang: '',
      backupOnExit: false,
      defaultBackupDir: null,
      autoUpdateCheck: true,
      lastUpdateCheckAt: null,
      dismissedUpdateVersion: null,
    })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/appSettings.test.ts`
Expected: FAIL — the new fields are `undefined`, and the `toEqual` literal mismatches.

- [ ] **Step 3: Implement**

In `src/appSettings.ts`, add to the `AppSettings` interface after `defaultBackupDir`:

```ts
  /** Check GitHub for a newer release on start. The app's only outbound
   *  request — off means Lore Codex touches the network zero times. */
  autoUpdateCheck: boolean
  /** Epoch ms of the last check, for the 24h throttle. null = never checked. */
  lastUpdateCheckAt: number | null
  /** A version the user dismissed; the banner stays hidden until a different
   *  one appears. null = nothing dismissed. */
  dismissedUpdateVersion: string | null
```

Add to `DEFAULT_APP_SETTINGS`:

```ts
  autoUpdateCheck: true,
  lastUpdateCheckAt: null,
  dismissedUpdateVersion: null,
```

Add to `coerceSettings`, before `return out`:

```ts
  if (typeof stored.autoUpdateCheck === 'boolean') out.autoUpdateCheck = stored.autoUpdateCheck
  if (typeof stored.lastUpdateCheckAt === 'number' || stored.lastUpdateCheckAt === null) {
    out.lastUpdateCheckAt = stored.lastUpdateCheckAt
  }
  if (typeof stored.dismissedUpdateVersion === 'string' || stored.dismissedUpdateVersion === null) {
    out.dismissedUpdateVersion = stored.dismissedUpdateVersion
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/appSettings.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/appSettings.ts src/appSettings.test.ts
git commit -m "feat: device prefs for the update check (#225)"
```

---

### Task 2: Pure throttle and dismissal logic

**Files:**
- Create: `src/updater.ts`
- Test: `src/updater.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `CHECK_INTERVAL_MS: number`, `CHECK_DELAY_MS: number`, `shouldCheck(args: { enabled: boolean; lastCheckedAt: number | null; now: number }): boolean`, `isDismissed(version: string, dismissedVersion: string | null): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/updater.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shouldCheck, isDismissed, CHECK_INTERVAL_MS } from './updater'

const NOW = 1_700_000_000_000

describe('shouldCheck', () => {
  it('never checks when the pref is off, however stale', () => {
    expect(shouldCheck({ enabled: false, lastCheckedAt: null, now: NOW })).toBe(false)
    expect(shouldCheck({ enabled: false, lastCheckedAt: 0, now: NOW })).toBe(false)
  })

  it('checks when it has never checked', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: null, now: NOW })).toBe(true)
  })

  it('does not check again inside the interval', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - 1000, now: NOW })).toBe(false)
  })

  it('checks once the interval has fully elapsed', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - CHECK_INTERVAL_MS, now: NOW })).toBe(true)
  })

  it('does not check one millisecond early', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - CHECK_INTERVAL_MS + 1, now: NOW })).toBe(false)
  })

  it('checks when the stored timestamp is in the future', () => {
    // A clock change (or a hand-edited row) must not wedge checking off forever.
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW + 999_999, now: NOW })).toBe(true)
  })
})

describe('isDismissed', () => {
  it('is false when nothing was dismissed', () => {
    expect(isDismissed('0.39.0', null)).toBe(false)
  })

  it('is true for the exact version dismissed', () => {
    expect(isDismissed('0.39.0', '0.39.0')).toBe(true)
  })

  it('is false for any different version — a newer release re-surfaces', () => {
    expect(isDismissed('0.40.0', '0.39.0')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/updater.test.ts`
Expected: FAIL — `Failed to resolve import "./updater"`.

- [ ] **Step 3: Implement**

Create `src/updater.ts`:

```ts
// Pure decision logic for the desktop auto-updater (#225). No Tauri, no
// React, no Dexie — the shell calls live in `platform.ts` and the state
// lives in `appSettings.ts`, so everything decidable is decidable in a test.

/** How long to wait between automatic checks. Launching the app five times in
 *  a morning must cost GitHub one request, not five. "Check now" in Settings
 *  bypasses this deliberately. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** How long after mount the banner waits before checking, so the request never
 *  competes with loading a world. Exported so the test drives the same number
 *  the component does, rather than hard-coding a duplicate. */
export const CHECK_DELAY_MS = 2000

/** Whether an automatic check is due.
 *
 *  A `lastCheckedAt` in the future is treated as due rather than ignored: a
 *  clock rollback (or a hand-edited registry row) would otherwise disable
 *  update checks until real time caught up, which could be years. */
export function shouldCheck(args: {
  enabled: boolean
  lastCheckedAt: number | null
  now: number
}): boolean {
  const { enabled, lastCheckedAt, now } = args
  if (!enabled) return false
  if (lastCheckedAt === null) return true
  if (lastCheckedAt > now) return true
  return now - lastCheckedAt >= CHECK_INTERVAL_MS
}

/** Whether this exact version was dismissed.
 *
 *  String identity is the whole rule — no semver comparison anywhere in our
 *  code. The plugin decides what counts as *newer*; we only need to know
 *  whether this is the same one the user already waved away, so a later
 *  release re-surfaces the banner on its own. */
export function isDismissed(version: string, dismissedVersion: string | null): boolean {
  return dismissedVersion !== null && dismissedVersion === version
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/updater.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/updater.ts src/updater.test.ts
git commit -m "feat: pure throttle and dismissal logic for updates (#225)"
```

---

### Task 3: Signing key, release pipeline, and Rust wiring

**Files:**
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`, `package.json`
- Create: `docs/updater-key.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the `@tauri-apps/plugin-updater` npm package and the registered Rust plugin that Task 4's `platform.ts` imports.

> **This task contains a manual maintainer step that cannot be automated.**
> The build will not produce working updates without a real keypair, and the
> private key must never pass through agent context. Step 1 is a gate: do not
> proceed past it with a placeholder pubkey.

- [ ] **Step 1: Generate the signing keypair (maintainer, local shell)**

Run locally — **not** via an agent:

```bash
npx tauri signer generate -w $HOME/.tauri/lore-codex.key
```

Enter a password when prompted. The command prints a **public key** (base64) and writes the private key to `~/.tauri/lore-codex.key`.

Then:
1. Copy the private key file contents **and** the password into your password manager.
2. Add two repository secrets at `https://github.com/KantikPotatoe/Lore-Codex/settings/secrets/actions`:
   - `TAURI_SIGNING_PRIVATE_KEY` — the full contents of `~/.tauri/lore-codex.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password
3. Keep the printed **public key** at hand for Step 4.

Verify: `gh secret list` shows both names.

- [ ] **Step 2: Add the dependencies**

```bash
npm install @tauri-apps/plugin-updater
```

In `src-tauri/Cargo.toml`, add a target-gated section after the existing `[dependencies]` block (the updater is desktop-only and will not compile for mobile targets):

```toml
[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
tauri-plugin-updater = "2"
```

- [ ] **Step 3: Register the plugin**

In `src-tauri/src/lib.rs`, inside `.setup(|app| { ... })`, before the existing `if cfg!(debug_assertions)` block:

```rust
      // Desktop-only: backs checkForUpdate/download/install in the frontend's
      // platform seam (src/platform.ts). The HTTP fetch happens here in Rust,
      // not the webview, so the app's CSP stays closed.
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
```

- [ ] **Step 4: Configure the endpoint and pubkey**

In `src-tauri/tauri.conf.json`, add a top-level `"plugins"` key as a sibling of `"bundle"` (replace `PASTE_PUBLIC_KEY_HERE` with the real key printed in Step 1 — this is the one value in this plan that comes from outside it):

```json
  "plugins": {
    "updater": {
      "endpoints": [
        "https://github.com/KantikPotatoe/Lore-Codex/releases/latest/download/latest.json"
      ],
      "pubkey": "PASTE_PUBLIC_KEY_HERE",
      "windows": {
        "installMode": "passive"
      }
    }
  }
```

`/latest/download/` always resolves to the newest release, so this endpoint never needs maintenance. `installMode: "passive"` shows the NSIS progress UI without prompting through the whole wizard, and works with the existing `currentUser` install mode.

- [ ] **Step 5: Grant the capability**

In `src-tauri/capabilities/default.json`, add to `"permissions"` after `"core:window:allow-destroy"`:

```json
    "updater:default",
```

And extend the `"description"` string by appending, before its closing quote:
` checkForUpdate/download/install = the auto-updater (#225), which fetches a minisign-signed manifest from the GitHub release and runs the NSIS installer.`

- [ ] **Step 6: Emit the signed manifest in CI**

In `.github/workflows/release.yml`, in the `Build and release` step, add the two signing vars to the existing `env:` block:

```yaml
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
```

And add to the step's `with:` block, after `prerelease: false`:

```yaml
          includeUpdaterJson: true
```

Also update the step's comment above it to mention the manifest:

```yaml
      # Runs beforeBuildCommand (tsc -b && vite build), compiles the shell,
      # bundles the NSIS installer, signs an updater manifest (latest.json),
      # and uploads both to a release for the tag.
```

- [ ] **Step 7: Document key custody**

Create `docs/updater-key.md`:

```markdown
# Updater signing key

The desktop auto-updater (#225) verifies every update against a minisign
public key baked into each build (`src-tauri/tauri.conf.json` →
`plugins.updater.pubkey`). This is **separate from code signing** — the
installer itself remains unsigned, so SmartScreen still asks on first run.

## Where the key lives

- **Private key + password:** the maintainer's password manager, and the
  GitHub Actions secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Nowhere else. Never in the repo.
- **Public key:** committed in `tauri.conf.json`. It is meant to be public.

## If the private key is lost

Every installed copy is permanently stranded: it will reject any update not
signed by the key it was built with. The only recovery is publishing a build
with a new pubkey, which existing users must install **manually** — the exact
failure the updater exists to prevent. This is why the password manager copy
matters: GitHub secrets are write-only and cannot be read back.

## If the private key leaks

Someone who could also control the update endpoint could publish a signed
malicious update. Rotate by generating a new keypair, replacing the secrets
and the pubkey, and shipping a release; users on the old key must reinstall
manually.

## Regenerating

    npx tauri signer generate -w $HOME/.tauri/lore-codex.key
```

- [ ] **Step 8: Verify the shell still compiles**

Run: `cd src-tauri && cargo check`
Expected: finishes without errors. `build.rs` validates `tauri.conf.json` and the capability ACL, so a bad permission name or malformed plugins block fails here rather than at release time.

If `cargo` is not on PATH, it is at `$HOME/.cargo/bin/cargo`.

- [ ] **Step 9: Verify the web build is unaffected**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass. Nothing imports the new npm package yet.

- [ ] **Step 10: Commit**

```bash
git add src-tauri package.json package-lock.json .github/workflows/release.yml docs/updater-key.md
git commit -m "build: sign and publish updater manifests on release (#225)"
```

---

### Task 4: The platform seam

**Files:**
- Modify: `src/platform.ts`
- Test: `src/platform.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/plugin-updater` (Task 3).
- Produces:
  - `export interface UpdateInfo { version: string; currentVersion: string; notes: string; download(onProgress: (pct: number | null) => void): Promise<void>; install(): Promise<void> }`
  - `export async function checkForUpdate(): Promise<UpdateInfo | null>`
  - `export async function appVersion(): Promise<string | null>`

- [ ] **Step 1: Write the failing test**

Add to the top of `src/platform.test.ts`, alongside the existing `vi.mock` calls:

```ts
vi.mock('@tauri-apps/plugin-updater', () => ({ check: vi.fn() }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn() }))
```

Add to the imports-under-test on line 2: `checkForUpdate, appVersion`.

Add alongside the other mock imports:

```ts
import { check } from '@tauri-apps/plugin-updater'
import { getVersion } from '@tauri-apps/api/app'
```

Then append these describes to the file:

```ts
describe('checkForUpdate', () => {
  it('resolves null in a plain browser without touching the plugin', async () => {
    expect(await checkForUpdate()).toBe(null)
    expect(check).not.toHaveBeenCalled()
  })

  it('resolves null in the shell when no update is available', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue(null)
    expect(await checkForUpdate()).toBe(null)
  })

  it('maps the plugin update onto the seam shape', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0',
      currentVersion: '0.38.0',
      body: 'Notes here',
      download: vi.fn(),
      install: vi.fn(),
    } as never)

    const update = await checkForUpdate()
    expect(update?.version).toBe('0.39.0')
    expect(update?.currentVersion).toBe('0.38.0')
    expect(update?.notes).toBe('Notes here')
  })

  it('tolerates a missing release body', async () => {
    enterTauri()
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0',
      currentVersion: '0.38.0',
      body: undefined,
      download: vi.fn(),
      install: vi.fn(),
    } as never)

    expect((await checkForUpdate())?.notes).toBe('')
  })

  it('reports download progress as a 0-100 percentage', async () => {
    enterTauri()
    const download = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: 'Started', data: { contentLength: 200 } })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Finished' })
    })
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download, install: vi.fn(),
    } as never)

    const seen: (number | null)[] = []
    const update = await checkForUpdate()
    await update?.download((pct) => seen.push(pct))
    expect(seen).toEqual([0, 25, 50, 100])
  })

  it('reports indeterminate progress when the server sends no length', async () => {
    enterTauri()
    const download = vi.fn(async (onEvent: (e: unknown) => void) => {
      onEvent({ event: 'Started', data: {} })
      onEvent({ event: 'Progress', data: { chunkLength: 50 } })
      onEvent({ event: 'Finished' })
    })
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download, install: vi.fn(),
    } as never)

    const seen: (number | null)[] = []
    const update = await checkForUpdate()
    await update?.download((pct) => seen.push(pct))
    expect(seen).toEqual([null, null, 100])
  })

  it('delegates install to the plugin update', async () => {
    enterTauri()
    const install = vi.fn(async () => {})
    vi.mocked(check).mockResolvedValue({
      version: '0.39.0', currentVersion: '0.38.0', body: '', download: vi.fn(), install,
    } as never)

    await (await checkForUpdate())?.install()
    expect(install).toHaveBeenCalledOnce()
  })
})

describe('appVersion', () => {
  it('resolves null in a plain browser', async () => {
    expect(await appVersion()).toBe(null)
    expect(getVersion).not.toHaveBeenCalled()
  })

  it('reads the shell version', async () => {
    enterTauri()
    vi.mocked(getVersion).mockResolvedValue('0.38.0')
    expect(await appVersion()).toBe('0.38.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/platform.test.ts`
Expected: FAIL — `checkForUpdate` and `appVersion` are not exported.

- [ ] **Step 3: Implement**

Append to `src/platform.ts`:

```ts
/**
 * A pending update, with the shell plumbing already bound to it.
 *
 * This is a handle rather than three free functions on purpose: `install()`
 * must act on the *same* plugin `Update` instance that `check()` returned, and
 * a module-level variable holding "the current update" would be a race the
 * moment two checks overlap. The plugin object itself never escapes this
 * module — only these plain fields and methods do.
 */
export interface UpdateInfo {
  /** The version on offer, e.g. "0.39.0". */
  version: string
  /** The version currently running. */
  currentVersion: string
  /** Release notes; '' when the release has no body. */
  notes: string
  /**
   * Download the installer, reporting progress as 0-100. `null` means
   * indeterminate: the server sent no content length, so a percentage would
   * be a lie and the UI should show a spinner instead of a filled bar.
   *
   * Downloading does NOT install — see `install()`.
   */
  download(onProgress: (pct: number | null) => void): Promise<void>
  /**
   * Run the downloaded installer. **This terminates the running app** on
   * Windows: NSIS has to replace the executable it would otherwise be
   * holding open. That is why download and install are separate — the app
   * must never disappear out from under an author mid-sentence.
   */
  install(): Promise<void>
}

/**
 * Ask GitHub whether a newer signed release exists.
 *
 * Resolves `null` in the browser (always) and in the shell when the running
 * version is current. Throws if the network is unreachable or the manifest
 * fails signature verification — callers decide whether that is worth
 * surfacing (an automatic check swallows it; an explicit one reports it).
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isTauri()) return null
  const { check } = await import('@tauri-apps/plugin-updater')
  const update = await check()
  if (!update) return null

  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? '',
    async download(onProgress) {
      let total = 0
      let received = 0
      await update.download((event) => {
        if (event.event === 'Started') {
          total = event.data.contentLength ?? 0
          onProgress(total > 0 ? 0 : null)
        } else if (event.event === 'Progress') {
          received += event.data.chunkLength
          onProgress(total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null)
        } else if (event.event === 'Finished') {
          onProgress(100)
        }
      })
    },
    install() {
      return update.install()
    },
  }
}

/**
 * The running shell's version, from the bundle metadata (which
 * `tauri.conf.json` reads from `package.json`). `null` in the browser, where
 * there is no installed app to have a version.
 */
export async function appVersion(): Promise<string | null> {
  if (!isTauri()) return null
  const { getVersion } = await import('@tauri-apps/api/app')
  return getVersion()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/platform.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/platform.ts src/platform.test.ts
git commit -m "feat: expose the updater through the platform seam (#225)"
```

---

### Task 5: The `useUpdateCheck` hook

**Files:**
- Create: `src/useUpdateCheck.ts`
- Test: `src/useUpdateCheck.test.tsx`

**Interfaces:**
- Consumes: `checkForUpdate`, `UpdateInfo` (Task 4); `shouldCheck`, `isDismissed` (Task 2); `getAppSettings`, `updateAppSettings` (Task 1).
- Produces: `UpdateState` union and `useUpdateCheck(): { state: UpdateState; check(manual: boolean): Promise<void>; download(): Promise<void>; install(): Promise<void>; dismiss(): Promise<void> }`.

- [ ] **Step 1: Write the failing test**

Create `src/useUpdateCheck.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { registry } from './registryDb'
import { updateAppSettings } from './appSettings'

vi.mock('./platform', () => ({ checkForUpdate: vi.fn() }))
import { checkForUpdate } from './platform'
import { useUpdateCheck } from './useUpdateCheck'

function fakeUpdate(over: Partial<{ download: unknown; install: unknown }> = {}) {
  return {
    version: '0.39.0',
    currentVersion: '0.38.0',
    notes: 'Notes',
    download: vi.fn(async (onProgress: (pct: number | null) => void) => { onProgress(100) }),
    install: vi.fn(async () => {}),
    ...over,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await registry.appMeta.clear()
})

// useLiveQuery-adjacent hooks leave subscriptions alive without this.
afterEach(() => cleanup())

describe('useUpdateCheck', () => {
  it('starts idle', () => {
    const { result } = renderHook(() => useUpdateCheck())
    expect(result.current.state.status).toBe('idle')
  })

  it('reports no update when the shell says there is none', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state.status).toBe('none')
  })

  it('surfaces an available update', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state).toEqual({ status: 'available', version: '0.39.0', notes: 'Notes' })
  })

  it('stamps lastUpdateCheckAt after a check', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await waitFor(async () => {
      const { lastUpdateCheckAt } = await (await import('./appSettings')).getAppSettings()
      expect(typeof lastUpdateCheckAt).toBe('number')
    })
  })

  it('skips an automatic check that the throttle rejects', async () => {
    await updateAppSettings({ lastUpdateCheckAt: Date.now() })
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(checkForUpdate).not.toHaveBeenCalled()
    expect(result.current.state.status).toBe('idle')
  })

  it('runs a manual check even when the throttle would reject it', async () => {
    await updateAppSettings({ lastUpdateCheckAt: Date.now() })
    vi.mocked(checkForUpdate).mockResolvedValue(null)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(checkForUpdate).toHaveBeenCalledOnce()
  })

  it('skips an automatic check when the pref is off', async () => {
    await updateAppSettings({ autoUpdateCheck: false })
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(checkForUpdate).not.toHaveBeenCalled()
  })

  it('hides a dismissed version on an automatic check', async () => {
    await updateAppSettings({ dismissedUpdateVersion: '0.39.0' })
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(result.current.state.status).toBe('none')
  })

  it('shows a dismissed version anyway on a manual check', async () => {
    await updateAppSettings({ dismissedUpdateVersion: '0.39.0' })
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state.status).toBe('available')
  })

  it('swallows an automatic check failure', async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(false) })
    expect(result.current.state.status).toBe('idle')
  })

  it('surfaces a manual check failure', async () => {
    vi.mocked(checkForUpdate).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    expect(result.current.state).toEqual({ status: 'error', message: 'offline' })
  })

  it('moves through downloading to ready', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.download() })
    expect(result.current.state).toEqual({ status: 'ready', version: '0.39.0' })
  })

  it('surfaces a download failure', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(
      fakeUpdate({ download: vi.fn(async () => { throw new Error('disk full') }) }) as never,
    )
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.download() })
    expect(result.current.state).toEqual({ status: 'error', message: 'disk full' })
  })

  it('records the dismissed version', async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(fakeUpdate() as never)
    const { result } = renderHook(() => useUpdateCheck())
    await act(async () => { await result.current.check(true) })
    await act(async () => { await result.current.dismiss() })
    expect(result.current.state.status).toBe('none')
    const { getAppSettings } = await import('./appSettings')
    expect((await getAppSettings()).dismissedUpdateVersion).toBe('0.39.0')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/useUpdateCheck.test.tsx`
Expected: FAIL — `Failed to resolve import "./useUpdateCheck"`.

- [ ] **Step 3: Implement**

Create `src/useUpdateCheck.ts`:

```ts
import { useCallback, useRef, useState } from 'react'
import { checkForUpdate, type UpdateInfo } from './platform'
import { getAppSettings, updateAppSettings } from './appSettings'
import { shouldCheck, isDismissed } from './updater'

/** The whole updater lifecycle as one discriminated union, so the banner and
 *  the Settings panel read the same source and cannot disagree about state. */
export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'none' }
  | { status: 'available'; version: string; notes: string }
  | { status: 'downloading'; version: string; pct: number | null }
  | { status: 'ready'; version: string }
  | { status: 'installing' }
  | { status: 'error'; message: string }

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function useUpdateCheck() {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  // The pending update handle lives in a ref, not state: it is a live object
  // with methods, not render data, and stashing it in state would make every
  // progress tick a fresh object identity for no benefit.
  const pending = useRef<UpdateInfo | null>(null)

  /**
   * @param manual true when the user asked (Settings → "Check now"), which
   *   bypasses the 24h throttle, ignores a previous dismissal, and surfaces
   *   errors. An automatic check does none of those: it is background work,
   *   and "couldn't reach GitHub" is not news the user asked for.
   */
  const check = useCallback(async (manual: boolean) => {
    const settings = await getAppSettings()
    if (!manual && !shouldCheck({
      enabled: settings.autoUpdateCheck,
      lastCheckedAt: settings.lastUpdateCheckAt,
      now: Date.now(),
    })) return

    setState({ status: 'checking' })
    try {
      const update = await checkForUpdate()
      await updateAppSettings({ lastUpdateCheckAt: Date.now() })
      if (!update) {
        pending.current = null
        setState({ status: 'none' })
        return
      }
      // A dismissal silences the banner, not the Settings panel: if you came
      // looking, you get an answer.
      if (!manual && isDismissed(update.version, settings.dismissedUpdateVersion)) {
        pending.current = null
        setState({ status: 'none' })
        return
      }
      pending.current = update
      setState({ status: 'available', version: update.version, notes: update.notes })
    } catch (err) {
      if (manual) setState({ status: 'error', message: message(err) })
      else {
        console.warn('[updater] check failed', err)
        setState({ status: 'idle' })
      }
    }
  }, [])

  const download = useCallback(async () => {
    const update = pending.current
    if (!update) return
    setState({ status: 'downloading', version: update.version, pct: null })
    try {
      await update.download((pct) => setState({ status: 'downloading', version: update.version, pct }))
      setState({ status: 'ready', version: update.version })
    } catch (err) {
      setState({ status: 'error', message: message(err) })
    }
  }, [])

  const install = useCallback(async () => {
    const update = pending.current
    if (!update) return
    setState({ status: 'installing' })
    try {
      // On Windows this does not return: the NSIS installer terminates the
      // app to replace it. The catch is for the cases where it fails first.
      await update.install()
    } catch (err) {
      setState({ status: 'error', message: message(err) })
    }
  }, [])

  const dismiss = useCallback(async () => {
    const update = pending.current
    if (update) await updateAppSettings({ dismissedUpdateVersion: update.version })
    pending.current = null
    setState({ status: 'none' })
  }, [])

  return { state, check, download, install, dismiss }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/useUpdateCheck.test.tsx`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add src/useUpdateCheck.ts src/useUpdateCheck.test.tsx
git commit -m "feat: useUpdateCheck state machine (#225)"
```

---

### Task 6: The update banner

**Files:**
- Create: `src/components/UpdateBanner.tsx`
- Test: `src/components/UpdateBanner.test.tsx`
- Modify: `src/App.tsx`, `src/index.css`

**Interfaces:**
- Consumes: `useUpdateCheck` (Task 5), `isTauri` (existing).
- Produces: the default-exported `UpdateBanner` component, mounted in `App.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/components/UpdateBanner.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { CHECK_DELAY_MS } from '../updater'
import type { UpdateState } from '../useUpdateCheck'

const check = vi.fn(async () => {})
const download = vi.fn(async () => {})
const install = vi.fn(async () => {})
const dismiss = vi.fn(async () => {})
let state: UpdateState = { status: 'idle' }

vi.mock('../useUpdateCheck', () => ({
  useUpdateCheck: () => ({ state, check, download, install, dismiss }),
}))
vi.mock('../platform', () => ({ isTauri: vi.fn(() => true) }))

import { isTauri } from '../platform'
import UpdateBanner from './UpdateBanner'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(isTauri).mockReturnValue(true)
  state = { status: 'idle' }
})
afterEach(() => cleanup())

describe('UpdateBanner', () => {
  it('renders nothing while idle', () => {
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing in a plain browser and never checks', () => {
    vi.mocked(isTauri).mockReturnValue(false)
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
    expect(check).not.toHaveBeenCalled()
  })

  it('runs an automatic check on mount in the shell, after a delay', async () => {
    // Fake timers, because the banner deliberately waits CHECK_DELAY_MS before
    // checking so it never competes with loading a world — longer than
    // waitFor's default 1s patience.
    vi.useFakeTimers()
    try {
      render(<UpdateBanner />)
      expect(check).not.toHaveBeenCalled() // not immediately
      await act(async () => { vi.advanceTimersByTime(CHECK_DELAY_MS) })
      expect(check).toHaveBeenCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels the pending check if unmounted first', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(<UpdateBanner />)
      unmount()
      vi.advanceTimersByTime(CHECK_DELAY_MS)
      expect(check).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('offers the update when one is available', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    expect(screen.getByText(/0\.39\.0 is available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /download/i })).toBeTruthy()
  })

  it('downloads when asked', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    fireEvent.click(screen.getByRole('button', { name: /download/i }))
    expect(download).toHaveBeenCalledOnce()
  })

  it('shows a determinate percentage while downloading', () => {
    state = { status: 'downloading', version: '0.39.0', pct: 42 }
    render(<UpdateBanner />)
    expect(screen.getByText(/42%/)).toBeTruthy()
  })

  it('shows indeterminate progress when there is no percentage', () => {
    state = { status: 'downloading', version: '0.39.0', pct: null }
    render(<UpdateBanner />)
    expect(screen.getByText(/Downloading…/)).toBeTruthy()
  })

  it('warns that restarting closes the app, and installs on click', () => {
    state = { status: 'ready', version: '0.39.0' }
    render(<UpdateBanner />)
    expect(screen.getByText(/close/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /restart/i }))
    expect(install).toHaveBeenCalledOnce()
  })

  it('offers no dismiss once the update is downloaded', () => {
    // The hook refuses to dismiss from `ready` (it would strand the installer
    // and hide the version from automatic checks), so the banner must not
    // render a control that would do nothing.
    state = { status: 'ready', version: '0.39.0' }
    render(<UpdateBanner />)
    expect(screen.queryByTitle(/dismiss/i)).toBeNull()
  })

  it('dismisses on the close button', () => {
    state = { status: 'available', version: '0.39.0', notes: '' }
    render(<UpdateBanner />)
    // The × carries title="Dismiss until the next version", which is its
    // accessible name — there is no visible label to match on.
    fireEvent.click(screen.getByTitle(/dismiss/i))
    expect(dismiss).toHaveBeenCalledOnce()
  })

  it('stays silent on an error — Settings is where errors belong', () => {
    state = { status: 'error', message: 'offline' }
    const { container } = render(<UpdateBanner />)
    expect(container.firstChild).toBeNull()
  })
})
```

This uses `fireEvent` and plain `expect(container.firstChild).toBeNull()`, matching the repo's existing component tests (`DocumentLinks.test.tsx`, `References.test.tsx`). The project has **no** `@testing-library/user-event` and **no** `jest-dom` — do not add either.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/UpdateBanner.test.tsx`
Expected: FAIL — `Failed to resolve import "./UpdateBanner"`.

- [ ] **Step 3: Implement the component**

Create `src/components/UpdateBanner.tsx`:

```tsx
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/UpdateBanner.test.tsx`
Expected: PASS, 12 tests.

- [ ] **Step 5: Add the styles**

In `src/index.css`, immediately after the `.backup-banner-x:hover` rule (currently line 998), add:

```css

/* --- Update banner -------------------------------------------------------- */
/* Deliberately the calmer sibling of .backup-banner: an available update is
   good news, not a warning, so it reads blue-slate rather than amber. */
.update-banner {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  background: linear-gradient(180deg, #1e2c3a, #16212e); border-bottom: 1px solid #2f4a63;
  color: #dceaf6; padding: 9px 18px; font-size: 14px;
}
.update-progress {
  flex: 1; max-width: 260px; height: 6px; border-radius: 3px;
  background: #0f1922; overflow: hidden;
}
.update-progress-fill {
  height: 100%; background: linear-gradient(90deg, var(--accent-soft), var(--accent));
  transition: width 160ms ease-out;
}
```

- [ ] **Step 6: Mount it in the shell**

In `src/App.tsx`, add to the imports after line 5 (`import StorageErrorBanner ...`):

```ts
import UpdateBanner from './components/UpdateBanner'
```

Then in the sidebar-shell return, add it directly above `<BackupBanner />`:

```tsx
        <UpdateBanner />
        <BackupBanner />
```

Leave the `/` lore-selector branch alone: the picker is a full-screen route with no shell, and an update bar there would fight the atmosphere for no gain — the banner appears as soon as a world is open.

- [ ] **Step 7: Verify the whole suite**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/UpdateBanner.tsx src/components/UpdateBanner.test.tsx src/App.tsx src/index.css
git commit -m "feat: update banner in the app shell (#225)"
```

---

### Task 7: The Settings panel

**Files:**
- Modify: `src/routes/SettingsRoute.tsx`

**Interfaces:**
- Consumes: `useUpdateCheck` (Task 5), `appVersion` (Task 4), `AppSettings.autoUpdateCheck` (Task 1), the existing `setApp` helper and `desktop` flag in `SettingsRoute`.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Add the imports and state**

In `src/routes/SettingsRoute.tsx`, extend the platform import on line 26:

```ts
import { openTextFile, isTauri, pickDirectory, appVersion } from '../platform'
```

Add after it:

```ts
import { useUpdateCheck } from '../useUpdateCheck'
```

Inside the component, after the existing `const desktop = isTauri()` line (currently line 78) and its `setApp` helper, add:

```ts
  const { state: updateState, check: runUpdateCheck, download: downloadUpdate, install: installUpdate } = useUpdateCheck()
  const [version, setVersion] = useState<string | null>(null)
  useEffect(() => { appVersion().then(setVersion) }, [])
```

(`useState`/`useEffect` are already imported in this file.)

- [ ] **Step 2: Add the section**

Insert a new `<section>` immediately **before** the `<section className="settings-section danger-zone">` block (currently line 375):

```tsx
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
              ? 'Asks GitHub once a day whether a newer release exists. This is the only time Lore Codex touches the network — turn it off and nothing ever leaves this machine.'
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
          <div className="settings-actions">
            <button className="ghost-btn" onClick={() => void downloadUpdate()}>Download {updateState.version}</button>
          </div>
        )}
        {updateState.status === 'ready' && (
          <div className="settings-actions">
            <button className="ghost-btn" onClick={() => void installUpdate()}>Restart to install</button>
          </div>
        )}
      </section>
```

- [ ] **Step 3: Verify it renders in the browser build**

Run: `npm run dev`, open `http://localhost:5174/#/settings`.
Expected: an "Updates" section above Danger zone, version showing `—`, both controls greyed out with "Desktop app only" hints. Stop the dev server.

- [ ] **Step 4: Verify the suite**

Run: `npm run lint && npm run build && npm run test:run`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/routes/SettingsRoute.tsx
git commit -m "feat: Updates section in Settings (#225)"
```

---

### Task 8: Documentation and the manual verification gate

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/updater-manual-verification.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Document the architecture**

In `CLAUDE.md`, add a new subsection immediately after the `### Desktop shell — src-tauri/ + src/platform.ts` section:

```markdown
### Auto-updater — `src/updater.ts` + `useUpdateCheck.ts` + `UpdateBanner.tsx`

Desktop only. `tauri-plugin-updater` fetches a **minisign-signed** `latest.json`
from `releases/latest/download/` on the GitHub repo; `release.yml` emits and
signs it via `includeUpdaterJson: true` plus the `TAURI_SIGNING_PRIVATE_KEY`
secrets. The pubkey is committed in `tauri.conf.json`; **losing the private key
permanently strands every installed copy** (`docs/updater-key.md`).

`platform.ts` owns the only `@tauri-apps/plugin-updater` import and returns an
**`UpdateInfo` handle** (`version`/`notes`/`download()`/`install()`) rather than
free functions — `install()` must act on the same plugin `Update` instance
`check()` returned, and a module-level "current update" would race. Download and
install are **separate calls on purpose**: on Windows the NSIS installer
terminates the running app, so installing must be a second, explicit click.

`updater.ts` is pure (`shouldCheck` 24h throttle — a future timestamp counts as
due, so a clock rollback can't wedge checking off; `isDismissed` is plain string
identity, since the plugin decides what's *newer*). `useUpdateCheck` is the one
state machine both consumers read. Automatic checks fail **silently**; manual
"Check now" in Settings surfaces errors and bypasses both throttle and dismissal.

The check is the app's **only** outbound request, governed by the device-level
`autoUpdateCheck` pref (`appSettings.ts`, registry DB — structurally incapable
of travelling in a world backup). Off means Lore Codex touches the network zero
times, which is what keeps the local-first claim honest.
```

- [ ] **Step 2: Write the manual verification checklist**

Create `docs/updater-manual-verification.md`:

```markdown
# Updater — manual verification

The signed download-and-install path **cannot be tested in CI**: it needs a
real release signed with the real private key. Unit tests cover the throttle,
the dismissal rule, the seam's event mapping, and the state machine — but the
end-to-end update is untested code until the checklist below is run.

Run this once, against the first release that ships after #225 lands.

## Setup

1. Merge #225 and let `version-bump.yml` tag a release (the PR carries
   `version:major`, so this is the first version with updater support).
2. Confirm the release has **both** the `.exe` installer and `latest.json`
   attached. If `latest.json` is missing, the signing secrets did not reach
   `tauri-action` — fix that before continuing.
3. Install that release. This build is the *starting point*: it can only
   update to something newer.
4. Ship one more release (any trivial patch).

## Checks

- [ ] Launch the installed app. Within a few seconds, the update banner
      appears naming the newer version.
- [ ] The banner did **not** appear on the lore selector (`/`), only once a
      world is open.
- [ ] Click **Download**. Progress advances and reaches "Restart to install".
- [ ] Click the **×** instead on a fresh launch: the banner goes away and does
      not return on relaunch.
- [ ] Settings → Updates → **Check now** still reports the update after
      dismissing it (a manual check ignores dismissal).
- [ ] Click **Restart to install**. The app closes, the NSIS installer runs,
      and the app reopens on the new version.
- [ ] Settings → Updates shows the new version number.
- [ ] Turn **Check for updates automatically** off, relaunch, and confirm no
      banner appears.
- [ ] **Open a world and confirm the data survived the update** — pages, maps,
      manuscripts. An in-place NSIS upgrade should not touch the WebView2 data
      directory, but this is the check that matters most if it ever does.

## Negative check (optional, recommended once)

Corrupt the `pubkey` in a local build, point it at the real endpoint, and
confirm the check fails closed — the app must report no update rather than
installing an unverified one.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md docs/updater-manual-verification.md
git commit -m "docs: auto-updater architecture and manual verification (#225)"
```

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/225-auto-updater
gh pr create --title "feat: desktop auto-updater (#225)" --label "version:major" --body "$(cat <<'EOF'
Closes #225.

Desktop-only auto-updater. The shell checks GitHub once a day for a newer
signed release, offers it in a banner, downloads on request, and installs on
a second explicit click (the NSIS installer terminates the app, so that step
is never implicit).

- `src/updater.ts` — pure 24h throttle + dismissal identity
- `src/platform.ts` — the only `@tauri-apps/plugin-updater` import; returns an
  `UpdateInfo` handle so `install()` acts on the instance `check()` returned
- `useUpdateCheck` — one state machine behind both the banner and Settings
- `autoUpdateCheck` device pref — off means zero outbound requests, ever

Requires the `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
repo secrets. See `docs/updater-key.md` — losing that key strands every
installed copy.

**Not covered by CI:** the signed download-and-install path needs a real
signed release. `docs/updater-manual-verification.md` is the checklist to run
against the first release after this merges; until then that path is untested.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage:** Decision → Tasks 3-7. Local-first tension → Task 1 (`autoUpdateCheck`) + Task 7 (toggle + copy) + Task 8 (docs). Key custody → Task 3 Steps 1, 7. Release infrastructure table → Task 3 Steps 2-6. CSP expectation → Task 3 Step 3 comment; verified in practice by Task 8's checklist. `platform.ts` seam → Task 4. `updater.ts` → Task 2. `appSettings` → Task 1. Hook → Task 5. Banner → Task 6. Settings section → Task 7. Flow (2s delay, throttle bypass) → Task 6 Step 3, Task 5. Failure handling → Task 5 (silent vs. surfaced), Task 6 (error renders nothing). Testing incl. the stated CI gap → Tasks 1-7 + Task 8 Step 2. Out of scope items are absent from the plan, as intended.

**Deviation from spec, recorded:** the seam is an `UpdateInfo` handle rather than three free functions. Rationale in the header and in `CLAUDE.md`.

**Type consistency:** `UpdateInfo` (Task 4) is consumed by name in Task 5. `UpdateState` (Task 5) is imported by the Task 6 test. `shouldCheck`/`isDismissed` signatures match between Tasks 2 and 5. `checkForUpdate`/`appVersion` match between Tasks 4, 5, and 7. `autoUpdateCheck`/`lastUpdateCheckAt`/`dismissedUpdateVersion` are spelled identically in Tasks 1, 5, and 7. The hook's returned names (`state`, `check`, `download`, `install`, `dismiss`) are destructured consistently in Tasks 5, 6, and 7.

**Placeholders:** one intentional external value — `PASTE_PUBLIC_KEY_HERE` in Task 3 Step 4, which comes from the maintainer-run keygen in Step 1 and is called out as a gate. No other TBDs.
