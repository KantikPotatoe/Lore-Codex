import { registry } from './registryDb'

/** Device-level, app-wide preferences — distinct from the per-world
 *  `LoreSettings` in `settings.ts`, which lives in that world's `meta` row and
 *  travels inside its backups. Nothing here is a property of a world:
 *  "open the last world" is *about* worlds, and the rest describe this machine. */
export interface AppSettings {
  /** Skip the world picker on launch and reopen the last world. */
  openLastWorld: boolean
  /** Spellcheck the editor. Default true = the contenteditable default. */
  spellcheck: boolean
  /** BCP-47 tag for the spellcheck dictionary; '' = let the OS decide. */
  spellcheckLang: string
  /** Desktop only: write a backup to the app data folder when closing. */
  backupOnExit: boolean
  /** Desktop only: the folder the Save dialog opens in. null = none picked. */
  defaultBackupDir: string | null
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  openLastWorld: false,
  spellcheck: true,
  spellcheckLang: '',
  backupOnExit: false,
  defaultBackupDir: null,
}

export const APP_SETTINGS_KEY = 'app-settings'

/** The dictionary comes from the browser/OS — the installed set is not exposed
 *  to web content, so this list is curated, not enumerated. An uninstalled
 *  language simply falls back to the OS default. */
export const SPELLCHECK_LANGS: { id: string; label: string }[] = [
  { id: '', label: 'System default' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'en-GB', label: 'English (UK)' },
  { id: 'fr', label: 'Français' },
  { id: 'es', label: 'Español' },
  { id: 'de', label: 'Deutsch' },
  { id: 'it', label: 'Italiano' },
  { id: 'pt', label: 'Português' },
  { id: 'nl', label: 'Nederlands' },
  { id: 'pl', label: 'Polski' },
  { id: 'ru', label: 'Русский' },
]

/** Validate on read, not just on write: a hand-edited DB (or a future bug)
 *  must not propagate a wrong-typed value into the app. Anything unexpected
 *  falls back to its default — the same discipline as `settings.ts`. */
export async function getAppSettings(): Promise<AppSettings> {
  const row = await registry.appMeta.get(APP_SETTINGS_KEY)
  const stored = (row?.value ?? {}) as Partial<Record<keyof AppSettings, unknown>>
  const out: AppSettings = { ...DEFAULT_APP_SETTINGS }

  if (typeof stored.openLastWorld === 'boolean') out.openLastWorld = stored.openLastWorld
  if (typeof stored.spellcheck === 'boolean') out.spellcheck = stored.spellcheck
  if (typeof stored.backupOnExit === 'boolean') out.backupOnExit = stored.backupOnExit
  if (typeof stored.spellcheckLang === 'string' &&
      SPELLCHECK_LANGS.some((l) => l.id === stored.spellcheckLang)) {
    out.spellcheckLang = stored.spellcheckLang
  }
  if (typeof stored.defaultBackupDir === 'string' || stored.defaultBackupDir === null) {
    out.defaultBackupDir = stored.defaultBackupDir
  }
  return out
}

/** Read-modify-write the single settings row. One row, one write — no
 *  partial-field races between rapid toggles. */
export async function updateAppSettings(patch: Partial<AppSettings>): Promise<void> {
  const next = { ...(await getAppSettings()), ...patch }
  await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: next })
}

/** Decide whether launching should skip the picker and reopen the last world.
 *  Pure, so every guard is testable:
 *   - `startupHandled` — only ever redirect once per page life, or "switch
 *     world" would bounce straight back and the picker would be unreachable.
 *   - `storedLoreId === null` — `deleteLore()` clears CURRENT_LORE_KEY, so the
 *     just-deleted case must land on the picker, not silently open 'default'.
 *   - `knownIds` — never redirect into a world that no longer exists. */
export function shouldOpenLastWorld(args: {
  openLastWorld: boolean
  storedLoreId: string | null
  knownIds: string[]
  startupHandled: boolean
}): boolean {
  const { openLastWorld, storedLoreId, knownIds, startupHandled } = args
  if (!openLastWorld || startupHandled) return false
  if (storedLoreId === null) return false
  return knownIds.includes(storedLoreId)
}
