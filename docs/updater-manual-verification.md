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
