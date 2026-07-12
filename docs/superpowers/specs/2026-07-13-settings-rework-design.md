# Settings rework — design

**Issue:** #173 · **Date:** 2026-07-13 · **Version label:** `version:minor`

## Problem

Settings today exposes four per-world numbers, one checkbox, and the backup/danger controls.
Issue #173 asks for five more options and a margin fix. Two things block a naive implementation:

1. **`LoreSettings` is per-world.** It lives in that world's `meta` row and travels inside its
   backups (schema v12). Most of what #173 asks for is not a property of a world — "open the last
   world I was in" is *about* worlds, and spellcheck / exit-backup / backup folder are properties of
   *this machine*. Storing them per-world would duplicate them per world, ship them inside backups,
   and lose them when a world is deleted.
2. **The desktop shell grants no standing filesystem scope.** `src-tauri/capabilities/default.json`
   says so deliberately: the dialog plugin adds picked paths to the fs scope *at runtime*. A folder
   picked in an earlier session therefore has **no write permission at next launch**, so a silent
   "save my backup into that folder on exit" cannot work under today's ACL.

## Scope

**In:** open-last-world · spellcheck + language · backup on exit · default backup folder · the
layout fix.
**Out:** **theme** (the app has one committed parchment identity and just had an atmosphere pass;
a theme system is its own issue). Answered on #173 rather than silently dropped.

## Decisions

### App-level settings store

New `src/appSettings.ts`, backed by a new `appMeta` table on the existing **`lore-registry` DB**
(`src/lores.ts`, version 1 → 2). The table is a keyed bag — `{ key: string; value: unknown }`,
primary key `key` — matching the per-world `meta` store, with all of `AppSettings` under a single
`app-settings` row (one write, no partial-field races).

```ts
export interface AppSettings {
  openLastWorld: boolean         // default false — today's behaviour is the picker
  spellcheck: boolean            // default true  — today's behaviour (contenteditable spellchecks by default)
  spellcheckLang: string         // default ''    — let the OS decide
  backupOnExit: boolean          // default false — desktop-only effect
  defaultBackupDir: string | null // default null — desktop-only
}
```

Every default reproduces today's behaviour, so an absent row is a no-op.

It mirrors `settings.ts`'s **validate-on-read** discipline: a corrupt or out-of-type value falls
back to its default rather than propagating. Living in the registry DB means these prefs
*structurally cannot* leak into a world's backup — strictly better than the `LOCAL_ONLY_META_KEYS`
exclusion list, which only works if someone remembers to update it. Reads go through `useLiveQuery`,
the app's one reactivity idiom. Per-world `LoreSettings` is untouched.

### Open last world

Pure `shouldOpenLastWorld()` in `appSettings.ts`; `LoreSelectorRoute` renders
`<Navigate to="/home" replace>` when it returns true. Three guards, each load-bearing:

- a **module-scope "startup already handled" flag**, so "switch world" in-session reaches the picker
  instead of bouncing straight back to the world you just left;
- the remembered world **must still exist** in the registry;
- `CURRENT_LORE_KEY` must be **present** in localStorage. `deleteLore()` removes that key, so
  deleting your active world lands on the picker rather than silently opening `default`.

`switchLore()` reloads the page, which resets the module flag — correct, since `currentLoreId()` is
by then the newly chosen world.

### Spellcheck + language

`editorProps.attributes: { spellcheck, lang }` on both Tiptap editors (`LoreEditor` and the
manuscript `SceneEditor`). The language list is **curated**, not enumerated: the set of installed
dictionaries is not exposed to web content. The hint text states plainly that the dictionary comes
from the browser/OS, so an uninstalled language falls back silently.

### Backup on exit — desktop only

`platform.ts` gains `onCloseRequested(handler)` (a no-op in the browser, per the seam rule: no
`@tauri-apps/*` import lives outside that module). On close, when the pref is on **and** there are
unbacked changes: `exportAll()` → `writeAppData('backups/exit-<date>.json')` → close. The handler is
wrapped so that **a failure still lets the window close** — a settings toggle must never wedge the
app shut.

It deliberately **does not stamp `lastBackupAt`**. An `$APPDATA` copy is a safety net, not a backup
that has left the machine; silencing the nag banner would tell the user their data is safe off-disk
when it isn't.

In the browser this is not offered at all. `beforeunload` cannot await an async IndexedDB export,
Firefox blocks unload-triggered downloads, and nothing is actually lost on close (IndexedDB
persists) — a half-working toggle is worse than an honest "Desktop app only".

### Default backup folder — desktop only

`pickDirectory()` in `platform.ts` (native directory dialog). The stored path is passed as
`saveFile(data, name, { defaultDir })`, so "Back up now" opens the Save dialog already inside the
user's cloud-synced folder. `platform.ts` stays ignorant of settings — the caller (`backup.ts`)
passes the directory, preserving the seam.

**Rejected:** `tauri-plugin-persisted-scope` (a new Rust dependency plus a standing persisted write
grant) and a static `$HOME/**` fs scope (the broadest option, and it contradicts the capability
file's "deliberately minimal"). Both would let exit-backups land straight in the cloud folder; the
cost is a permanently wider write surface for the webview. Chosen instead: **no new permissions, no
new Rust deps** — exit-backups go to `$APPDATA`, and the folder pref only pre-fills the dialog.

## Layout

`.settings-field` becomes a real settings **row**: a `1fr auto` grid — label + one-line description
left, control right-aligned, hairline divider between rows. This fixes #173's "margin": the column
is in fact centred (measured: 880px inside a 959px content area, symmetric 34.5px gutters), but the
*controls* hug the left edge of each 800px card, marooning a 120px input beside ~600px of dead
space. The row grid closes that gap and gives the new descriptions somewhere to live.

Sections: **General** (open last world) · **Editor** (spellcheck, language, autolink — folded in
from "Linking") · **Auto-snapshots** · **Backup & data** (+ the two desktop rows) · **Danger zone**.

Desktop-only rows render in the browser as **disabled with a "Desktop app only" note** — the feature
set stays legible instead of invisible.

## Testing

Vitest: `appSettings` defaults + coercion round-trip (including corrupt values from a hand-edited
DB) · `shouldOpenLastWorld` truth table (pref off · missing world · deleted-key case · in-session
revisit) · the exit-backup decision function · a render test for the row layout and the desktop-only
disabling. The Tauri code paths stay behind `isTauri()` and are not unit-tested, consistent with how
the shell seam is treated today.
