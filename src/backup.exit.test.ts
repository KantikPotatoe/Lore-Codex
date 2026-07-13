import { describe, it, expect } from 'vitest'
import { shouldBackupOnExit } from './backup'

describe('shouldBackupOnExit', () => {
  it('does nothing when the setting is off', () => {
    expect(shouldBackupOnExit(false, null, 500)).toBe(false)
  })

  it('backs up when enabled and there are unbacked changes', () => {
    expect(shouldBackupOnExit(true, 100, 500)).toBe(true)
  })

  it('skips the write when everything is already backed up', () => {
    // Closing the app ten times in a row must not litter ten identical files.
    expect(shouldBackupOnExit(true, 500, 100)).toBe(false)
  })

  it('skips an empty world', () => {
    expect(shouldBackupOnExit(true, null, 0)).toBe(false)
  })
})
