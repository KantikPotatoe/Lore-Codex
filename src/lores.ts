import Dexie, { type Table } from 'dexie'
import { CURRENT_LORE_KEY, currentLoreId, dbNameFor } from './loreId'
import { broadcastWorldChange } from './tabSync'

export interface Lore {
  id: string
  name: string
  banner: string | null // data URL, or null
  createdAt: number
  updatedAt: number
}

class LoreRegistryDB extends Dexie {
  lores!: Table<Lore, string>
  constructor() {
    super('lore-registry')
    this.version(1).stores({ lores: 'id, createdAt' })
  }
}

export const registry = new LoreRegistryDB()

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
    throw err
  } finally {
    target.close()
  }
  return id
}

export async function renameLore(id: string, name: string): Promise<void> {
  await registry.lores.update(id, { name: name.trim() || 'Untitled World', updatedAt: Date.now() })
}

export async function setLoreBanner(id: string, banner: string | null): Promise<void> {
  await registry.lores.update(id, { banner, updatedAt: Date.now() })
}

export async function deleteLore(id: string): Promise<void> {
  broadcastWorldChange(id, 'delete') // freeze other tabs viewing this world
  const isActive = id === currentLoreId()
  await Dexie.delete(dbNameFor(id))
  await registry.lores.delete(id)
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
