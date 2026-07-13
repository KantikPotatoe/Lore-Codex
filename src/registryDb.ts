import Dexie, { type Table } from 'dexie'

/** A world in the registry. */
export interface Lore {
  id: string
  name: string
  banner: string | null // data URL, or null
  createdAt: number
  updatedAt: number
}

/** Device-level key/value rows (app settings). Mirrors the per-world `meta`
 *  store's shape, but lives in the registry DB — so these rows are structurally
 *  incapable of travelling inside a world's backup, and they survive deleting
 *  the world you were in. */
export interface AppMeta {
  key: string
  value: unknown
}

class LoreRegistryDB extends Dexie {
  lores!: Table<Lore, string>
  appMeta!: Table<AppMeta, string>
  constructor() {
    super('lore-registry')
    this.version(1).stores({ lores: 'id, createdAt' })
    this.version(2).stores({ appMeta: 'key' })
  }
}

export const registry = new LoreRegistryDB()
