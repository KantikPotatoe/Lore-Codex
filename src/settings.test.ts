import { describe, it, expect, beforeEach } from 'vitest'
import { db } from './db'
import { getSettings, updateSettings, DEFAULT_SETTINGS, SETTINGS_KEY } from './settings'

describe('settings', () => {
  beforeEach(async () => {
    await db.meta.clear()
  })

  it('returns defaults when no row exists', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('merges a stored partial over defaults', async () => {
    await db.meta.put({ key: SETTINGS_KEY, value: { snapshotRetention: 25 } })
    const s = await getSettings()
    expect(s.snapshotRetention).toBe(25)
    expect(s.snapshotChangeThreshold).toBe(50) // untouched default
  })

  it('round-trips an update', async () => {
    await updateSettings({ snapshotChangeThreshold: 10 })
    expect((await getSettings()).snapshotChangeThreshold).toBe(10)
  })

  it('clamps invalid values', async () => {
    await updateSettings({ snapshotRetention: 0, snapshotChangeThreshold: -5, backupOverdueDays: 999 })
    const s = await getSettings()
    expect(s.snapshotRetention).toBe(1)         // floored to 1
    expect(s.snapshotChangeThreshold).toBe(1)   // floored to 1
    expect(s.backupOverdueDays).toBe(100)       // capped at 100
  })

  it('ignores non-finite values, keeping the prior value', async () => {
    await updateSettings({ snapshotTimeHours: 12 })
    await updateSettings({ snapshotTimeHours: Number.NaN })
    expect((await getSettings()).snapshotTimeHours).toBe(12)
  })

  it('clamps stored values on read, since import writes meta directly (bypasses updateSettings)', async () => {
    // A backup could carry a hand-edited or corrupt settings row; getSettings must
    // not trust it, or e.g. a non-numeric retention makes snapshot pruning a no-op.
    await db.meta.put({
      key: SETTINGS_KEY,
      value: { snapshotRetention: 'x', snapshotChangeThreshold: 0, backupOverdueDays: 999 },
    })
    const s = await getSettings()
    expect(s.snapshotRetention).toBe(DEFAULT_SETTINGS.snapshotRetention) // non-numeric → default
    expect(s.snapshotChangeThreshold).toBe(1) // floored into range
    expect(s.backupOverdueDays).toBe(100) // capped into range
  })

  it('defaults autolinkEnabled to true', async () => {
    expect((await getSettings()).autolinkEnabled).toBe(true)
  })

  it('round-trips a boolean without clamping it to a number', async () => {
    await updateSettings({ autolinkEnabled: false })
    expect((await getSettings()).autolinkEnabled).toBe(false)
  })
})
