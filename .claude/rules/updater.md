---
paths:
  - src/updater.ts
  - src/useUpdateCheck.ts
  - src/UpdateCheckContext.tsx
  - src/components/UpdateBanner.tsx
---

# Auto-updater — `src/updater.ts` + `useUpdateCheck.ts` + `UpdateBanner.tsx`

Desktop only. `tauri-plugin-updater` fetches a **minisign-signed** `latest.json`
from `releases/latest/download/` on the GitHub repo; `release.yml` emits and
signs it via `includeUpdaterJson: true` plus the `TAURI_SIGNING_PRIVATE_KEY`
secrets. The pubkey is committed in `tauri.conf.json`; **losing the private key
permanently strands every installed copy** (`docs/updater-key.md`). Signing
also requires `bundle.createUpdaterArtifacts: true` in `tauri.conf.json`
itself — it defaults to `false`, and without it the bundler emits no updater
artifact and no `.sig` at all, so the release ships with no `latest.json`
regardless of whether the workflow secrets are set. This is the single least
discoverable requirement in the whole feature.

`platform.ts` owns the only `@tauri-apps/plugin-updater` import and returns an
**`UpdateInfo` handle** (`version`/`notes`/`download()`/`install()`) rather than
free functions — `install()` must act on the same plugin `Update` instance
`check()` returned, and a module-level "current update" would race. Download and
install are **separate calls on purpose**: on Windows the NSIS installer
terminates the running app, so installing must be a second, explicit click.

`updater.ts` is pure (`shouldCheck` 24h throttle — a future timestamp counts as
due, so a clock rollback can't wedge checking off, and a non-finite
`lastCheckedAt` counts as due too, since `coerceSettings` accepts `NaN`
— `typeof NaN === 'number'` — and `NaN` fails every comparison, so an
unguarded check would silently disable update checking forever; `isDismissed`
is plain string identity, since the plugin decides what's *newer*).
`useUpdateCheck` is the one state machine both consumers read — literally one,
via `UpdateCheckProvider`/`useSharedUpdateCheck` (`src/UpdateCheckContext.tsx`),
which wraps the sidebar shell in `App.tsx`. Calling the hook directly in a
second component would give it its own `pending` handle, letting the banner
dismiss a version the other instance had already downloaded; the shared hook
throws outside the provider rather than falling back silently. Automatic
checks fail **silently**; manual "Check now" in Settings surfaces errors and
bypasses both throttle and dismissal. `lastUpdateCheckAt` is stamped only on a
**successful** check — a failed one hasn't learned anything, and muting checks
for 24h over one network blip would be worse than retrying next launch.

`dismiss()` refuses to run once a check has produced a live handle and moved
past `available` (so `downloading`/`ready`/`installing`/post-install `error`
are all refused, deliberately broader than the states today's UI can dismiss
from): dismissing a downloaded update would both clear the update
handle and record the version as dismissed, stranding an installer already on
disk that `install()` would then no-op on and that automatic checks would
never re-offer. Neither the banner nor the Settings panel renders a dismiss
control once an update is downloaded.

The check is the app's **only** outbound request, governed by the device-level
`autoUpdateCheck` pref (`appSettings.ts`, registry DB — structurally incapable
of travelling in a world backup). Off means automatic checks stop entirely —
Lore Codex never reaches the network on its own — while the explicit "Check
now" button in Settings still reaches it when the user clicks it. That
distinction is what keeps the local-first claim honest: nothing outbound
happens unasked.
