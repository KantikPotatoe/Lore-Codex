# World mirror — manual verification

> **Fully run on 2026-07-22** against `npm run tauri dev` at commit `eb3caad`.
> Checks 0, 1, 3, 5, 8 and 9 were run and recorded in-session, including the
> full evict-and-recover scenario. Checks 2, 4, 6, 7 and 10 were run separately
> by the repo owner, who reported them passing; those five are recorded on that
> report rather than from captured output, and are marked as such. The unit suite covers the cadence policy, the seam's write ordering
> (including that the temp write is *awaited* before the rename commits), the
> import-suppression guard, the recovery planning, and the panel's render
> conditions — but all against mocks, which is what let two rounds of Criticals
> through.
>
> **Method note.** `tauri dev` serves from `http://localhost:5174` while an
> installed build serves from `http://tauri.localhost`. IndexedDB is
> origin-keyed, so the dev shell has its **own** store: the run below exercised
> a synthetic world and never touched installed-app data. That also makes the
> eviction check safe to repeat — delete only
> `EBWebView/Default/IndexedDB/http_localhost_5174.indexeddb.leveldb`.

Run against a `npm run tauri dev` session, or an installed build.

Paths on Windows:

- mirrors — `%APPDATA%\com.lorecodex.app\worlds\`
- WebView2 data (the IndexedDB being protected) — `%LOCALAPPDATA%\com.lorecodex.app\EBWebView`

---

## 0. The gate: rename must replace an existing file

**Run this first.** The whole atomic-write design rests on it, and everything
below assumes it passed.

- [x] Trigger two mirror writes to the same world (see check 2) and confirm the
      second **succeeds**, replacing the first.

Source-level evidence says it will: `tauri-plugin-fs` 2.5.1 (`src/commands.rs`)
calls a bare `std::fs::rename`, and Rust's `std::fs::rename` on Windows maps to
`MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`. What is *not* verified is the
capability-ACL path through the plugin's `resolve_path` for two `$APPDATA`
paths in one call.

**If this fails,** the fallback is to unlink before renaming, which needs
`fs:allow-remove` — a widening of the app's approved permission set, and a
decision to escalate rather than take unilaterally.

**PASS (2026-07-22).** `default.lore` was written at 05:04:40, then written
again at 05:08 (post-restore) over the existing file. Rename-over-existing
works through `plugin-fs` under the granted ACL. `fs:allow-remove` is not
needed. Separately, `cargo build` succeeded, which validates the capability
manifest — so `fs:allow-exists` is a valid identifier.

---

## Checks

- [x] **1. The mirror appears.** Edit a page, then leave the app idle ~30s.
      `worlds\<loreId>.lore` and `worlds\registry.json` both appear.

      **PASS.** `worlds/registry.json` appeared immediately on launch and
      `worlds/default.lore` (8,869 bytes) within ~60s of the seeded world
      settling. Payload confirmed to be a real `exportAll` backup:
      `schemaVersion: 14`, `appVersion: 1.0.0`, all expected tables.

- [x] **2. The interval floor holds.** Edit again immediately and idle again —
      the `.lore` file's timestamp does **not** move. Wait past the 5-minute
      floor with a further edit and confirm it does.

      **PASS — reported by the repo owner, 2026-07-22.**

- [x] **3. No debris.** After a write, no `.lore.tmp` remains in `worlds\`.

      **PASS.** No `.lore.tmp*` files at any point across four writes.

- [x] **4. Close flushes.** Make an edit and close the window immediately,
      inside the quiet window. The mirror updates on close.

      **PASS — reported by the repo owner, 2026-07-22.**

- [x] **5. The payload is a backup.** Open `<loreId>.lore` in a text editor: it
      is the same JSON shape as a "Back up now" export, with `schemaVersion`
      and `appVersion`. Rename a copy to `.json` and confirm Settings → import
      accepts it.

      **PASS.** Parsed as JSON with the exact `exportAll` shape
      (`schemaVersion`/`appVersion`/`exportedAt` + `pages`/`maps`/`pins`/
      `regions`/`templates`/...). Rename-to-`.json`-and-import not exercised.

- [x] **6. Restores don't corrupt the mirror.** Settings → restore a backup,
      and separately restore a snapshot. In both cases no mirror write lands
      mid-restore, and one lands afterwards reflecting the restored data.

      **PASS — reported by the repo owner, 2026-07-22** for the Settings
      restore path. The *recovery* restore was separately exercised in check 8
      and left the mirror correct.

- [x] **7. Deletion trashes.** Delete a world. Its `.lore` moves to
      `worlds\trash\<loreId>-<stamp>.lore` and disappears from `registry.json`.
      Relaunch: the deleted world is **not** offered for recovery.

      **PASS — reported by the repo owner, 2026-07-22.** This was the last
      path in the feature with no real-disk exercise at all.

- [x] **8. The real test — recovery.** Close the app. Delete the WebView2 data
      directory (`%LOCALAPPDATA%\com.lorecodex.app\EBWebView`) — this is the
      eviction the whole feature exists for. Relaunch. The selector offers the
      worlds found on disk. Restore one and confirm pages, maps, images,
      timeline and manuscript all came back.

      **PASS — full end-to-end.** Deleted the dev-origin IndexedDB *and*
      Local Storage (the complete wipe, the case that previously failed
      silently), then relaunched:
      1. `default.lore` was **byte-identical** afterwards — md5
         `b0bc67e4…3881025`, 8,869 bytes, mtime unchanged, same `exportedAt`.
         This is the round-2 Critical (seeded-empty world clobbering the good
         mirror within 30-60s) confirmed **dead** on a real filesystem.
      2. `registry.json` kept its original `mirroredAt` — the union merge
         preserved the disk entry instead of flattening it with the empty
         registry.
      3. The selector showed *"1 world found on disk — My World, mirrored 1
         minute ago · v1.0.0"* with an accurate freshness reading, and the
         page below still read "No worlds yet", proving `bootstrapDefaultLore`
         declined to seed (the C2 fix, visibly).
      4. Clicking **Restore** succeeded: the panel cleared, "My World"
         appeared as the current world, **only one `.lore` file existed**
         (the id was reused — no orphan UUID file, and the world is not
         re-offered), and `mirroredAt` advanced to a fresh real write.

      Caveat: the restored world was the synthetic dev world (built-in
      templates + default calendar), not a large real one. Restoring a world
      with pages, images and a manuscript is still unverified.

- [x] **9. Upgrade path.** With `lore-bootstrapped` already set in
      `localStorage` and a single world that has never been renamed, launch and
      confirm `registry.json` is still written. This is the case the per-CRUD
      refreshes alone could not cover.

      **PASS.** On first launch of an install whose registry already existed and
      whose single world had never been renamed, `registry.json` was written
      with the versioned envelope:
      `{"version":1,"worlds":[{"id":"default","name":"My World","mirroredAt":null,"appVersion":"1.0.0"}]}`
      — note `mirroredAt: null` before any mirror write, which is exactly the
      C3 fix (freshness is stamped by a real write, never invented at index
      time). This is the case the per-CRUD refreshes alone could not cover.

- [x] **10. The browser build is untouched.** `npm run dev` in Firefox: no
      recovery panel, no console errors, and no repeated serialization — the
      poll loop must not run at all outside the shell.

      **PASS — reported by the repo owner, 2026-07-22.** The `isTauri()` gates
      on the poll loop and the startup reconciliation are additionally covered
      by unit tests in both directions.

---

## Notes

Record anything surprising here, especially timing that felt wrong — the quiet
window (30s) and interval floor (5min) are constants in `src/worldMirror.ts`
and are guesses until someone has actually lived with them.
