import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isQuotaError,
  isDroppedWriteError,
  reportStorageError,
  subscribeStorageError,
  clearStorageError,
} from './storageError'

afterEach(() => clearStorageError())

describe('isQuotaError', () => {
  it('detects Chrome/Safari QuotaExceededError by name', () => {
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true)
  })

  it('detects Firefox NS_ERROR_DOM_QUOTA_REACHED by name', () => {
    expect(isQuotaError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true)
  })

  it('detects the legacy DOMException code 22', () => {
    expect(isQuotaError({ code: 22 })).toBe(true)
  })

  it('detects a quota mention in the message', () => {
    expect(isQuotaError({ message: 'The quota has been exceeded.' })).toBe(true)
    expect(isQuotaError({ message: 'device is out of space' })).toBe(true)
  })

  it('recurses into a Dexie-nested inner cause', () => {
    expect(isQuotaError({ name: 'AbortError', inner: { name: 'QuotaExceededError' } })).toBe(true)
  })

  it('returns false for unrelated errors and non-objects', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false)
    expect(isQuotaError({ name: 'TypeError' })).toBe(false)
    expect(isQuotaError(null)).toBe(false)
    expect(isQuotaError('QuotaExceededError')).toBe(false)
  })

  it('does not infinitely recurse on a self-referential inner', () => {
    const self: Record<string, unknown> = { name: 'X' }
    self.inner = self
    expect(isQuotaError(self)).toBe(false)
  })
})

describe('storage-error event bus', () => {
  it('notifies subscribers with the user message on a quota error', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'QuotaExceededError' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatch(/out of storage space/i)
    off()
  })

  it('ignores non-quota errors', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError(new Error('unrelated'))
    expect(cb).not.toHaveBeenCalled()
    off()
  })

  it('replays the active notice to a late subscriber', () => {
    reportStorageError({ name: 'QuotaExceededError' })
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatch(/out of storage space/i)
    off()
  })

  it('clearStorageError notifies subscribers with null', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'QuotaExceededError' })
    cb.mockClear()
    clearStorageError()
    expect(cb).toHaveBeenCalledWith(null)
    off()
  })
})

describe('isDroppedWriteError', () => {
  it('detects the allowlisted Dexie/IDB error names', () => {
    for (const name of [
      'DatabaseClosedError', 'AbortError', 'InvalidStateError',
      'TransactionInactiveError', 'UnknownError',
    ]) {
      expect(isDroppedWriteError({ name })).toBe(true)
    }
  })

  it('recurses into a Dexie-nested inner cause', () => {
    expect(isDroppedWriteError({ name: 'AbortError', inner: { name: 'DatabaseClosedError' } })).toBe(true)
  })

  it('excludes ConstraintError and unrelated errors', () => {
    expect(isDroppedWriteError({ name: 'ConstraintError' })).toBe(false)
    expect(isDroppedWriteError(new Error('boom'))).toBe(false)
    expect(isDroppedWriteError({ name: 'QuotaExceededError' })).toBe(false)
    expect(isDroppedWriteError(null)).toBe(false)
  })
})

describe('reportStorageError — dropped writes', () => {
  it('raises the generic notice for an allowlisted dropped-write error', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'DatabaseClosedError' })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0]).toMatch(/may not have been saved/i)
    off()
  })

  it('prefers the quota message when the error is a quota error', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'QuotaExceededError' })
    expect(cb.mock.calls[0][0]).toMatch(/out of storage space/i)
    off()
  })

  it('still ignores a ConstraintError (logic bug, not lost data)', () => {
    const cb = vi.fn()
    const off = subscribeStorageError(cb)
    reportStorageError({ name: 'ConstraintError' })
    expect(cb).not.toHaveBeenCalled()
    off()
  })
})
