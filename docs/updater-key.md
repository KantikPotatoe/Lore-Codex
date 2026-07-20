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
