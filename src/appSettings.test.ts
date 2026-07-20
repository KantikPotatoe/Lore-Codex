import { describe, it, expect, beforeEach } from 'vitest'
import { registry } from './registryDb'
import {
  getAppSettings,
  updateAppSettings,
  DEFAULT_APP_SETTINGS,
  APP_SETTINGS_KEY,
  shouldOpenLastWorld,
} from './appSettings'

describe('appSettings', () => {
  beforeEach(async () => {
    await registry.appMeta.clear()
  })

  it('returns defaults when no row exists', async () => {
    expect(await getAppSettings()).toEqual(DEFAULT_APP_SETTINGS)
  })

  it('defaults reproduce today’s behaviour', () => {
    // An absent row must be a no-op: the picker still shows, the editor still
    // spellchecks (contenteditable does by default), nothing writes on exit.
    expect(DEFAULT_APP_SETTINGS).toEqual({
      openLastWorld: false,
      spellcheck: true,
      spellcheckLang: '',
      backupOnExit: false,
      defaultBackupDir: null,
      autoUpdateCheck: true,
      lastUpdateCheckAt: null,
      dismissedUpdateVersion: null,
    })
  })

  it('defaults the updater prefs to on, never-checked, nothing dismissed', () => {
    expect(DEFAULT_APP_SETTINGS.autoUpdateCheck).toBe(true)
    expect(DEFAULT_APP_SETTINGS.lastUpdateCheckAt).toBe(null)
    expect(DEFAULT_APP_SETTINGS.dismissedUpdateVersion).toBe(null)
  })

  it('round-trips the updater prefs', async () => {
    await updateAppSettings({
      autoUpdateCheck: false,
      lastUpdateCheckAt: 1_700_000_000_000,
      dismissedUpdateVersion: '0.39.0',
    })
    const a = await getAppSettings()
    expect(a.autoUpdateCheck).toBe(false)
    expect(a.lastUpdateCheckAt).toBe(1_700_000_000_000)
    expect(a.dismissedUpdateVersion).toBe('0.39.0')
  })

  it('rejects wrong-typed updater prefs on read', async () => {
    await registry.appMeta.put({
      key: APP_SETTINGS_KEY,
      value: {
        autoUpdateCheck: 'yes',
        lastUpdateCheckAt: 'never',
        dismissedUpdateVersion: 42,
      },
    })
    const a = await getAppSettings()
    expect(a.autoUpdateCheck).toBe(true)
    expect(a.lastUpdateCheckAt).toBe(null)
    expect(a.dismissedUpdateVersion).toBe(null)
  })

  it('merges a stored partial over defaults', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { openLastWorld: true } })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(true)
    expect(a.spellcheck).toBe(true) // untouched default
  })

  it('round-trips an update', async () => {
    await updateAppSettings({ backupOnExit: true })
    expect((await getAppSettings()).backupOnExit).toBe(true)
  })

  it('keeps unrelated fields when patching one', async () => {
    await updateAppSettings({ openLastWorld: true })
    await updateAppSettings({ spellcheckLang: 'fr' })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(true)
    expect(a.spellcheckLang).toBe('fr')
  })

  it('falls back to the default for a wrong-typed stored value', async () => {
    // A hand-edited DB (or a future bug) must not propagate junk into the app.
    await registry.appMeta.put({
      key: APP_SETTINGS_KEY,
      value: { openLastWorld: 'yes', spellcheck: 1, defaultBackupDir: 42 },
    })
    const a = await getAppSettings()
    expect(a.openLastWorld).toBe(false)
    expect(a.spellcheck).toBe(true)
    expect(a.defaultBackupDir).toBe(null)
  })

  it('rejects an unknown spellcheck language', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: 'klingon' } })
    expect((await getAppSettings()).spellcheckLang).toBe('')
  })

  it('does not lose a concurrent patch to a different field (race)', async () => {
    // Regression for a real data-loss bug: two overlapping read-modify-write
    // calls on DIFFERENT fields must both survive. Before the fix, the second
    // call's read raced ahead of the first call's write and clobbered it.
    await Promise.all([
      updateAppSettings({ spellcheck: false }),
      updateAppSettings({ spellcheckLang: 'fr' }),
    ])
    const a = await getAppSettings()
    expect(a.spellcheck).toBe(false)
    expect(a.spellcheckLang).toBe('fr')
  })
})

describe('shouldOpenLastWorld', () => {
  const base = { openLastWorld: true, storedLoreId: 'w1', knownIds: ['w1', 'w2'], startupHandled: false }

  it('opens the remembered world when the pref is on', () => {
    expect(shouldOpenLastWorld(base)).toBe(true)
  })

  it('does nothing when the pref is off', () => {
    expect(shouldOpenLastWorld({ ...base, openLastWorld: false })).toBe(false)
  })

  it('does not redirect twice in one page life', () => {
    // Otherwise "switch world" from the sidebar would bounce straight back to
    // the world the user just left, making the picker unreachable.
    expect(shouldOpenLastWorld({ ...base, startupHandled: true })).toBe(false)
  })

  it('shows the picker when no world is remembered', () => {
    // deleteLore() removes CURRENT_LORE_KEY, so this is the just-deleted case:
    // land on the picker rather than silently opening 'default'.
    expect(shouldOpenLastWorld({ ...base, storedLoreId: null })).toBe(false)
  })

  it('shows the picker when the remembered world is gone', () => {
    expect(shouldOpenLastWorld({ ...base, knownIds: ['w2'] })).toBe(false)
  })
})
