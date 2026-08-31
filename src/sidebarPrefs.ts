import { currentLoreId } from './lores'

export const RECENT_GROUP = '__recent__'
export const TAGS_GROUP = '__tags__'

/** Collapse-state key for a type group (#115). Prefixed so a group named
 *  "Places" and a page type named "Places" never share a collapse state.
 *  Bare names stay reserved for types, so existing stored keys keep working. */
export const groupCollapseKey = (name: string): string => `group:${name}`

const keyFor = (loreId: string) => `lore:${loreId}:collapsedGroups`

function read(loreId: string): string[] {
  try {
    const raw = localStorage.getItem(keyFor(loreId))
    const arr: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function getCollapsedGroups(loreId: string = currentLoreId()): string[] {
  return read(loreId)
}

export function toggleCollapsedGroup(name: string, loreId: string = currentLoreId()): string[] {
  const cur = read(loreId)
  const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
  try {
    localStorage.setItem(keyFor(loreId), JSON.stringify(next))
  } catch {
    // non-critical — ignore
  }
  return next
}
