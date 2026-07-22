import Dexie from 'dexie'
import { CURRENT_LORE_KEY, currentLoreId, dbNameFor } from './loreId'
import { broadcastWorldChange } from './tabSync'
import { registry, type Lore } from './registryDb'
import { writeRegistryMirror, readRegistryMirror, trashWorldMirror } from './platform'
import { parseDiskRegistry } from './worldRecovery'
import { mergeWorldIndex, dropWorldFromIndex, type WorldIndexEntry } from './worldIndex'
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
 *  before switchLore() reloads the page. */
export async function registerLore(name: string): Promise<string> {
  const id = crypto.randomUUID()
  const now = Date.now()
  await registry.lores.add({
    id,
    name: name.trim() || 'Untitled World',
    banner: null,
    createdAt: now,
    updatedAt: now,
  })
  await syncRegistryMirror()
  return id
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
 */
export async function importLoreFromBackup(name: string, json: string): Promise<string> {
  const { importBackupInto, parseBackup, LoreDB } = await import('./db')
  parseBackup(json) // throws on an invalid file before anything is created
  const id = await registerLore(name)
  const target = new LoreDB(dbNameFor(id))
  try {
    await importBackupInto(target, json)
  } catch (err) {
    // Roll the registry entry back so a failed import leaves no ghost world.
    await registry.lores.delete(id)
    await Dexie.delete(dbNameFor(id))
    // registerLore()'s syncRegistryMirror() above already wrote this id into
    // the on-disk index (mirroredAt: null, since nothing was ever mirrored for
    // it). The index is now a union that never rebuilds from the registry, so
    // merely re-syncing would NOT remove it — a plain syncRegistryMirror()
    // call would resurrect this ghost forever as "known only to disk". It
    // must be dropped explicitly, the same way deleteLore does.
    // Best-effort (dropFromRegistryMirror swallows its own failures), so this
    // cannot mask or replace the original error being rethrown below.
    await dropFromRegistryMirror(id)
    throw err
  } finally {
    target.close()
  }
  return id
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
 */
export async function syncRegistryMirror(): Promise<void> {
  try {
    const [lores, diskText] = await Promise.all([listLores(), readRegistryMirror()])
    const onDisk = parseDiskRegistry(diskText)
    const known = lores.map((l) => ({ id: l.id, name: l.name }))
    const index = mergeWorldIndex({ onDisk, known, appVersion: pkg.version })
    await writeRegistryMirror(JSON.stringify(index))
  } catch {
    // A world that cannot be indexed is still a world the user just made.
  }
}

/**
 * Drop one world from the on-disk index. The only way an entry leaves
 * `registry.json` — `syncRegistryMirror`'s union never removes anything on
 * its own. Best-effort, like `syncRegistryMirror`: a deletion is the user's
 * real action and must succeed even if this doesn't.
 */
async function dropFromRegistryMirror(id: string): Promise<void> {
  try {
    const onDisk: WorldIndexEntry[] = parseDiskRegistry(await readRegistryMirror())
    await writeRegistryMirror(JSON.stringify(dropWorldFromIndex(onDisk, id)))
  } catch {
    // Best-effort — see syncRegistryMirror.
  }
}

/** A filename-safe timestamp for trashed mirrors, e.g. 2026-07-21_14-32. */
function mirrorStamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`
}
