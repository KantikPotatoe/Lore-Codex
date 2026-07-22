# World mirror — manual verification

> **Nothing in this checklist has been run yet.** Every box below is unchecked
> because the mirror touches a real filesystem, and none of it can be exercised
> in CI. The unit suite covers the cadence policy, the seam's write ordering
> (including that the temp write is *awaited* before the rename commits), the
> import-suppression guard, the recovery planning, and the panel's render
> conditions — all against mocks. **Until this list is run, the feature is
> tested only against a filesystem that does not exist.**

Run against a `npm run tauri dev` session, or an installed build.

Paths on Windows:

- mirrors — `%APPDATA%\com.lorecodex.app\worlds\`
- WebView2 data (the IndexedDB being protected) — `%LOCALAPPDATA%\com.lorecodex.app\EBWebView`

---

## 0. The gate: rename must replace an existing file

**Run this first.** The whole atomic-write design rests on it, and everything
below assumes it passed.

- [ ] Trigger two mirror writes to the same world (see check 2) and confirm the
      second **succeeds**, replacing the first.

Source-level evidence says it will: `tauri-plugin-fs` 2.5.1 (`src/commands.rs`)
calls a bare `std::fs::rename`, and Rust's `std::fs::rename` on Windows maps to
`MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`. What is *not* verified is the
capability-ACL path through the plugin's `resolve_path` for two `$APPDATA`
paths in one call.

**If this fails,** the fallback is to unlink before renaming, which needs
`fs:allow-remove` — a widening of the app's approved permission set, and a
decision to escalate rather than take unilaterally.

Result: _______________

---

## Checks

- [ ] **1. The mirror appears.** Edit a page, then leave the app idle ~30s.
      `worlds\<loreId>.lore` and `worlds\registry.json` both appear.

      Result: _______________

- [ ] **2. The interval floor holds.** Edit again immediately and idle again —
      the `.lore` file's timestamp does **not** move. Wait past the 5-minute
      floor with a further edit and confirm it does.

      Result: _______________

- [ ] **3. No debris.** After a write, no `.lore.tmp` remains in `worlds\`.

      Result: _______________

- [ ] **4. Close flushes.** Make an edit and close the window immediately,
      inside the quiet window. The mirror updates on close.

      Result: _______________

- [ ] **5. The payload is a backup.** Open `<loreId>.lore` in a text editor: it
      is the same JSON shape as a "Back up now" export, with `schemaVersion`
      and `appVersion`. Rename a copy to `.json` and confirm Settings → import
      accepts it.

      Result: _______________

- [ ] **6. Restores don't corrupt the mirror.** Settings → restore a backup,
      and separately restore a snapshot. In both cases no mirror write lands
      mid-restore, and one lands afterwards reflecting the restored data.

      Result: _______________

- [ ] **7. Deletion trashes.** Delete a world. Its `.lore` moves to
      `worlds\trash\<loreId>-<stamp>.lore` and disappears from `registry.json`.
      Relaunch: the deleted world is **not** offered for recovery.

      Result: _______________

- [ ] **8. The real test — recovery.** Close the app. Delete the WebView2 data
      directory (`%LOCALAPPDATA%\com.lorecodex.app\EBWebView`) — this is the
      eviction the whole feature exists for. Relaunch. The selector offers the
      worlds found on disk. Restore one and confirm pages, maps, images,
      timeline and manuscript all came back.

      Result: _______________

- [ ] **9. Upgrade path.** With `lore-bootstrapped` already set in
      `localStorage` and a single world that has never been renamed, launch and
      confirm `registry.json` is still written. This is the case the per-CRUD
      refreshes alone could not cover.

      Result: _______________

- [ ] **10. The browser build is untouched.** `npm run dev` in Firefox: no
      recovery panel, no console errors, and no repeated serialization — the
      poll loop must not run at all outside the shell.

      Result: _______________

---

## Notes

Record anything surprising here, especially timing that felt wrong — the quiet
window (30s) and interval floor (5min) are constants in `src/worldMirror.ts`
and are guesses until someone has actually lived with them.
