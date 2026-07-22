import Dexie from 'dexie'
import { CURRENT_LORE_KEY, currentLoreId, dbNameFor } from './loreId'
import { broadcastWorldChange } from './tabSync'
import { registry, type Lore } from './registryDb'
import { writeRegistryMirror, readRegistryMirror, trashWorldMirror, withRegistryMirrorLock } from './platform'
import { parseDiskRegistry, serializeDiskRegistry } from './worldRecovery'
import { mergeWorldIndex, dropWorldFromIndex } from './worldIndex'
import pkg from '../package.json'

// The registry DB now lives in registryDb.ts so `appSettings.ts` can reach it
// without importing this module (whose world-CRUD is mocked wholesale in
// LoreSelectorRoute.test.tsx). Re-exported so every existing call site keeps
// importing `registry` / `Lore` from './lores'.
export { registry }
export type { Lore }

// Marks that the one-time default-world seeding has happened. Without this,
// an empty registry is indistinguishable from a fresh install, so deleting
// every world would silently recreate one on the next load.
const BOOTSTRAPPED_KEY = 'lore-bootstrapped'

// Re-export so callers can import everything from one place
export { currentLoreId } from './loreId'

export function setCurrentLore(id: string): void {
  localStorage.setItem(CURRENT_LORE_KEY, id)
}

export function switchLore(id: string): void {
  setCurrentLore(id)
  window.location.hash = '#/home'
  window.location.reload()
}

export function listLores(): Promise<Lore[]> {
  return registry.lores.orderBy('createdAt').toArray()
}

export function getLore(id: string): Promise<Lore | undefined> {
  return registry.lores.get(id)
}

/** Add a world to the registry WITHOUT switching to it. Returns the new id.
 *  The migration wizard needs this split: it must fill the new world's DB
 *  before switchLore() reloads the page.
 *
 *  `id` is optional and defaults to a fresh `crypto.randomUUID()` — every
 *  existing caller (the import wizard, `createLore`) is unaffected. It exists
 *  for `importLoreFromBackup`'s recovery path: a world restored from its disk
 *  mirror must keep its original id (see that function's doc comment) rather
 *  than minting a new one, which would leave the original disk entry an
 *  unclaimed, forever-recoverable ghost. `registry.lores.add()` throws on a
 *  duplicate key, so a caller that (incorrectly) reuses a live id fails
 *  atomically here — nothing is half-added. */
export async function registerLore(name: string, id?: string): Promise<string> {
  const loreId = id ?? crypto.randomUUID()
  const now = Date.now()
  await registry.lores.add({
    id: loreId,
    name: name.trim() || 'Untitled World',
    banner: null,
    createdAt: now,
    updatedAt: now,
  })
  await syncRegistryMirror()
  return loreId
}

export async function createLore(name = 'Untitled World'): Promise<void> {
  const id = await registerLore(name)
  switchLore(id)
}

/**
 * The migration-wizard core: create a new world and import a backup into it —
 * validating the backup FIRST so an invalid file never leaves a half-made
 * world behind. The caller decides whether to switchLore(id) afterwards.
 * Built-ins missing from old backups are seeded by the App start effect once
 * the world is switched to.
 *
 * `id` is optional and, when omitted, `registerLore` mints a fresh one — the
 * import wizard's existing call sites are unaffected. `restoreWorld`
 * (LoreSelectorRoute) passes the disk entry's own id: a recovered world IS
 * the world, so it must keep its identity rather than being re-registered
 * under a new uuid. Minting a fresh id there would leave the original disk
 * entry — real `mirroredAt`, still absent from the registry — satisfying
 * `plannedRecovery` forever, offering the same restore on every launch and
 * minting a duplicate world on every click. Reusing the id is safe:
 * `plannedRecovery` only ever offers entries absent from the registry, so
 * `registry.lores.add()` inside `registerLore` cannot collide with a live
 * world — and if it somehow did (e.g. two disk entries sharing an id), the
 * add() throws before any DB is touched, so nothing is half-created.
 */
export async function importLoreFromBackup(name: string, json: string, id?: string): Promise<string> {
  const { importBackupInto, parseBackup, LoreDB } = await import('./db')
  parseBackup(json) // throws on an invalid file before anything is created
  const newId = await registerLore(name, id)
  const target = new LoreDB(dbNameFor(newId))
  try {
    await importBackupInto(target, json)
  } catch (err) {
    // Roll the registry DB row back so a failed import leaves no ghost world.
    // This part is always correct regardless of caller: plannedRecovery only
    // ever offers ids absent from the registry, so on the recovery path too,
    // registerLore() just created this row fresh (see its doc comment) — it
    // never pre-existed.
    await registry.lores.delete(newId)
    // The DATABASE, by contrast, is only safe to delete when `id` was omitted
    // (#174 task r3, item 2). When `id` is omitted, `registerLore` minted a
    // fresh `crypto.randomUUID()` that could not have named any existing
    // database — this call created it, so deleting it on rollback removes
    // only the half-imported data this call itself wrote.
    //
    // When `id` IS supplied, the caller is `restoreWorld` (LoreSelectorRoute)
    // reusing a disk entry's original id for identity — and with id reuse,
    // restoring e.g. 'default' after an eviction targets the id `db` is
    // ALREADY bound to (the live, currently-open database), not a fresh one.
    // `Dexie.delete` on a live database's name deletes the underlying
    // IndexedDB out from under the open connection unconditionally — Dexie
    // then silently reopens it empty on the next access, with no error
    // reaching any reader: live queries just report an empty world, and this
    // page-life's `seedTemplates()` has already run so it won't re-seed
    // either. A failed restore must leave the live world exactly as it was
    // before the click, not erase it.
    if (id === undefined) {
      await Dexie.delete(dbNameFor(newId))
    }
    // The ON-DISK index entry is a different story (#174 I-A). When `id` is
    // omitted, registerLore() minted a fresh uuid and registerLore()'s own
    // syncRegistryMirror() above wrote THAT id into the on-disk index for the
    // first time (mirroredAt: null, since nothing was ever mirrored for it) —
    // a ghost that only this call created, and only this call should clean up
    // (a plain syncRegistryMirror() union would never remove it, so it must be
    // dropped explicitly, the same way deleteLore does).
    //
    // But when `id` IS supplied, the caller is restoreWorld (LoreSelectorRoute):
    // the disk entry pre-existed this call, with a real mirroredAt pointing at
    // an actual, good `.lore` file written in some earlier session —
    // registerLore()'s sync only merged it, never created it. Dropping it here
    // would delete the only pointer to that surviving file; nothing else ever
    // enumerates the worlds/ directory, so it would become permanently
    // unrecoverable while the file itself sits untouched on disk. Only drop
    // in the ghost-cleanup case this rollback was originally written for.
    // Best-effort (dropFromRegistryMirror swallows its own failures), so this
    // cannot mask or replace the original error being rethrown below.
    if (id === undefined) {
      await dropFromRegistryMirror(newId)
    }
    throw err
  } finally {
    target.close()
  }
  return newId
}

export async function renameLore(id: string, name: string): Promise<void> {
  await registry.lores.update(id, { name: name.trim() || 'Untitled World', updatedAt: Date.now() })
  await syncRegistryMirror()
}

export async function setLoreBanner(id: string, banner: string | null): Promise<void> {
  await registry.lores.update(id, { banner, updatedAt: Date.now() })
  await syncRegistryMirror()
}

export async function deleteLore(id: string): Promise<void> {
  broadcastWorldChange(id, 'delete') // freeze other tabs viewing this world
  const isActive = id === currentLoreId()
  await Dexie.delete(dbNameFor(id))
  await registry.lores.delete(id)
  // Trash the world's mirror file FIRST, then re-index. If the order were
  // reversed and the process died between the two steps, registry.json would
  // advertise a world whose file is gone.
  await trashWorldMirror(id, mirrorStamp())
  // A plain syncRegistryMirror() (union) would NOT remove this id: the merge
  // never rebuilds from the registry, so an entry only disappears when
  // something explicitly drops it. Deletion is that explicit drop.
  await dropFromRegistryMirror(id)
  if (isActive) {
    localStorage.removeItem(CURRENT_LORE_KEY)
    // Reload to re-initialize the db singleton; land on the lore selector.
    window.location.hash = '#/'
    window.location.reload()
  }
}

// In-flight guard: React StrictMode double-invokes the startup effect in dev, so
// bootstrapDefaultLore() can be called twice at once. The localStorage flag is
// only set after the async add, so both calls would pass the guard and both add
// id:'default', and the loser would reject with a duplicate-key ConstraintError.
// Sharing one in-flight promise makes the second caller await the first instead.
// (A transaction won't work here — the body reads a second DB via getMeta and a
// dynamic import, which a registry transaction can't span.)
let bootstrapping: Promise<void> | null = null

export function bootstrapDefaultLore(): Promise<void> {
  return (bootstrapping ??= doBootstrapDefaultLore().finally(() => { bootstrapping = null }))
}

async function doBootstrapDefaultLore(): Promise<void> {
  // Seed exactly once. An empty registry after this flag is set means the user
  // deliberately deleted all their worlds — leave it empty so the lore selector
  // can show its empty state instead of silently recreating a world.
  if (localStorage.getItem(BOOTSTRAPPED_KEY)) return
  const count = await registry.lores.count()
  if (count > 0) {
    localStorage.setItem(BOOTSTRAPPED_KEY, '1') // backfill for pre-flag installs
    return
  }

  // An empty registry is normally a genuine first run. But deleting the
  // WebView2 profile takes localStorage with it too, so BOOTSTRAPPED_KEY is
  // gone right along with the registry — and without this check, seeding
  // 'default' right here would register the id the eviction wiped, and
  // plannedRecovery's set-difference would then filter the real disk mirror
  // out as "already known", never offering it back (#174 C2). Ask the on-disk
  // index (readRegistryMirror resolves 'absent' in the browser, so this check
  // is inert there) whether it names a world with an actual .lore file behind
  // it (mirroredAt !== null — an entry can be on disk with no file, just a
  // registry-only record `syncRegistryMirror` wrote before anything was
  // mirrored, and there is nothing to restore from that). If so, this is a
  // lost-store, not a first run: leave the registry empty (and the flag
  // unset, so this check runs again next launch too) for the lore selector's
  // recovery panel to offer the world back instead of silently recreating it.
  //
  // An UNREADABLE index (parsed.ok === false — #174 Defect 1) gets the same
  // "don't seed" treatment as a genuine disk-only world, not the "must be a
  // first run" treatment: we cannot tell the difference from here, and
  // seeding 'default' on a guess would risk exactly the id collision this
  // whole check exists to prevent, the moment the index becomes readable
  // again.
  const parsed = parseDiskRegistry(await readRegistryMirror())
  if (!parsed.ok || parsed.entries.some((w) => w.mirroredAt !== null)) return

  // Only read the legacy home-config title when db.ts is pointing at 'lore-app'.
  // If the active lore is already set to something else, skip the title migration.
  let name = 'My World'
  if (currentLoreId() === 'default') {
    const { getMeta } = await import('./db')
    const savedConfig = await getMeta<{ title?: string }>('home-config')
    const legacyTitle = savedConfig?.title?.trim()
    if (legacyTitle) name = legacyTitle
  }

  const now = Date.now()
  await registry.lores.add({ id: 'default', name, banner: null, createdAt: now, updatedAt: now })
  localStorage.setItem(BOOTSTRAPPED_KEY, '1')
}

/**
 * Refresh `<app-data>/worlds/registry.json` — the index that lets recovery
 * find world files with a single read of a known path instead of a directory
 * listing (which would need an fs permission this app does not grant).
 *
 * Read-merge-write, NEVER a replacement: the registry DB is the volatile
 * store this whole feature exists to survive, so rebuilding the index from it
 * would erase, on the very launch after an eviction, the pointers to the
 * `.lore` files that survived. `mergeWorldIndex` (src/worldIndex.ts) is a
 * union of what's on disk and what the registry knows; an entry leaves only
 * through an explicit drop (see `dropFromRegistryMirror`, used by
 * `deleteLore` and the `importLoreFromBackup` rollback).
 *
 * Banners are deliberately omitted: the index is read on every launch, and a
 * data-URL banner per world would be megabytes of startup cost for nothing a
 * recovery decision needs. `mirroredAt`/`appVersion` are shown in the restore
 * panel so the user can see how fresh each recoverable world is — and are
 * never invented here; only a real mirror write may stamp them
 * (`worldMirrorSync.ts`, via `markWorldMirrored`).
 *
 * Best-effort: a failure here must never break world CRUD, which is the
 * user's actual action.
 *
 * Wrapped in `withRegistryMirrorLock` (#174 Defect 2): this is one of three
 * independent read-modify-write sequences against the same `registry.json`
 * (the other two are `dropFromRegistryMirror` below and
 * `stampRegistryMirrored` in worldMirrorSync.ts), and without serialization
 * two overlapping sequences can lose one's update or tear the shared tmp
 * file — see the lock's doc in platform.ts.
 *
 * Refuses to write when the disk read is unreadable rather than absent
 * (`!parsed.ok` — #174 Defect 1): a read failure must never be read as "the
 * disk has nothing", or the union this function computes becomes a
 * shrinking write that erases every disk-only entry the failed read merely
 * hid from us.
 */
export async function syncRegistryMirror(): Promise<void> {
  await withRegistryMirrorLock(async () => {
    try {
      const [lores, diskRead] = await Promise.all([listLores(), readRegistryMirror()])
      const parsed = parseDiskRegistry(diskRead)
      if (!parsed.ok) return
      const known = lores.map((l) => ({ id: l.id, name: l.name }))
      const index = mergeWorldIndex({ onDisk: parsed.entries, known, appVersion: pkg.version })
      await writeRegistryMirror(serializeDiskRegistry(index))
    } catch {
      // A world that cannot be indexed is still a world the user just made.
    }
  })
}

/**
 * Drop one world from the on-disk index. The only way an entry leaves
 * `registry.json` — `syncRegistryMirror`'s union never removes anything on
 * its own. Best-effort, like `syncRegistryMirror`: a deletion is the user's
 * real action and must succeed even if this doesn't. Same lock, same
 * refuse-to-write-on-unreadable guard — see `syncRegistryMirror` above.
 */
async function dropFromRegistryMirror(id: string): Promise<void> {
  await withRegistryMirrorLock(async () => {
    try {
      const parsed = parseDiskRegistry(await readRegistryMirror())
      if (!parsed.ok) return
      await writeRegistryMirror(serializeDiskRegistry(dropWorldFromIndex(parsed.entries, id)))
    } catch {
      // Best-effort — see syncRegistryMirror.
    }
  })
}

/** A filename-safe timestamp for trashed mirrors, e.g. 2026-07-21_14-32. */
function mirrorStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
}
