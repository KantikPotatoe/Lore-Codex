import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  matchesBoundLore,
  handleIncoming,
  subscribeTabSync,
  broadcastWorldChange,
  clearTabSync,
} from './tabSync'

afterEach(() => clearTabSync())

describe('matchesBoundLore', () => {
  it('matches a world-changed message for the bound lore', () => {
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')).toBe(true)
  })
  it('rejects a message for a different lore', () => {
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w2', reason: 'delete' }, 'w1')).toBe(false)
  })
  it('rejects a wrong type, a bad reason, and non-objects', () => {
    expect(matchesBoundLore({ type: 'other', loreId: 'w1', reason: 'import' }, 'w1')).toBe(false)
    expect(matchesBoundLore({ type: 'world-changed', loreId: 'w1', reason: 'nope' }, 'w1')).toBe(false)
    expect(matchesBoundLore(null, 'w1')).toBe(false)
    expect(matchesBoundLore('world-changed', 'w1')).toBe(false)
  })
})

describe('handleIncoming → bus', () => {
  it('freezes and notifies subscribers on a matching message', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')
    expect(cb).toHaveBeenCalledWith('import')
    off()
  })

  it('replays the active reason to a late subscriber', () => {
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'delete' }, 'w1')
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    expect(cb).toHaveBeenCalledWith('delete')
    off()
  })

  it('ignores a message targeting a different lore', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'other', reason: 'import' }, 'w1')
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('clearTabSync notifies subscribers with null', () => {
    const cb = vi.fn()
    const off = subscribeTabSync(cb)
    handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1')
    cb.mockClear()
    clearTabSync()
    expect(cb).toHaveBeenCalledWith(null)
    off()
  })
})

describe('broadcastWorldChange', () => {
  // This test runs before any channel is created (no prior test calls broadcast
  // or install), so the deleted-global path is genuinely exercised.
  it('is a safe no-op when BroadcastChannel is unavailable', () => {
    const saved = globalThis.BroadcastChannel
    // @ts-expect-error — deliberately remove for the no-support path
    delete globalThis.BroadcastChannel
    try {
      expect(() => broadcastWorldChange('w1', 'import')).not.toThrow()
    } finally {
      globalThis.BroadcastChannel = saved
    }
  })

  it('does not throw when BroadcastChannel exists', () => {
    expect(() => broadcastWorldChange('w1', 'delete')).not.toThrow()
  })
})
