import { describe, it, expect } from 'vitest'
import { shouldCheck, isDismissed, CHECK_INTERVAL_MS } from './updater'

const NOW = 1_700_000_000_000

describe('shouldCheck', () => {
  it('never checks when the pref is off, however stale', () => {
    expect(shouldCheck({ enabled: false, lastCheckedAt: null, now: NOW })).toBe(false)
    expect(shouldCheck({ enabled: false, lastCheckedAt: 0, now: NOW })).toBe(false)
  })

  it('checks when it has never checked', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: null, now: NOW })).toBe(true)
  })

  it('does not check again inside the interval', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - 1000, now: NOW })).toBe(false)
  })

  it('checks once the interval has fully elapsed', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - CHECK_INTERVAL_MS, now: NOW })).toBe(true)
  })

  it('does not check one millisecond early', () => {
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW - CHECK_INTERVAL_MS + 1, now: NOW })).toBe(false)
  })

  it('checks when the stored timestamp is in the future', () => {
    // A clock change (or a hand-edited row) must not wedge checking off forever.
    expect(shouldCheck({ enabled: true, lastCheckedAt: NOW + 999_999, now: NOW })).toBe(true)
  })

  it('checks when the stored timestamp is not a finite number', () => {
    // coerceSettings accepts NaN (typeof NaN === 'number'), and NaN fails every
    // comparison — without an explicit guard it would wedge checking off forever.
    expect(shouldCheck({ enabled: true, lastCheckedAt: NaN, now: NOW })).toBe(true)
  })
})

describe('isDismissed', () => {
  it('is false when nothing was dismissed', () => {
    expect(isDismissed('0.39.0', null)).toBe(false)
  })

  it('is true for the exact version dismissed', () => {
    expect(isDismissed('0.39.0', '0.39.0')).toBe(true)
  })

  it('is false for any different version — a newer release re-surfaces', () => {
    expect(isDismissed('0.40.0', '0.39.0')).toBe(false)
  })
})
