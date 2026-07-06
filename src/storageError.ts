// src/storageError.ts
// Surfacing IndexedDB quota / eviction failures to the user.
//
// Local-first means a failed write is otherwise silent: the user keeps editing,
// nothing persists, and they only discover the loss later. A browser signals an
// out-of-space (or evicted) write by rejecting the IndexedDB request with a
// QuotaExceededError DOMException. Dexie surfaces that as a rejected promise, and
// since many CRUD call sites fire-and-forget, it usually lands as a window
// `unhandledrejection`. This module detects those and drives a one-time, app-wide
// notice with a "download a backup" escape hatch (see StorageErrorBanner).
//
// Kept free of React (except the small subscriber hook at the bottom, mirroring
// wikiLinkHover.ts) so it can be imported anywhere — including a global listener.

import { useEffect, useState } from 'react'

type Listener = (message: string | null) => void

const listeners = new Set<Listener>()
let active: string | null = null

const QUOTA_MESSAGE =
  'Your browser is out of storage space, so recent changes may not have been saved. ' +
  'Download a backup now, then free up space (or remove old data) to keep editing safely.'

const GENERIC_MESSAGE =
  'Some recent changes may not have been saved (another tab may have changed this world). ' +
  'Download a backup to be safe, then reload.'

// Dexie/IndexedDB error names that mean a write was dropped or the connection
// vanished — the realistic multi-tab case is DatabaseClosedError after Dexie
// auto-closes on another tab's delete. ConstraintError is deliberately absent:
// it signals a logic bug (e.g. the bootstrap duplicate-key path), not lost data.
const DROPPED_WRITE_NAMES = new Set([
  'DatabaseClosedError', 'AbortError', 'InvalidStateError',
  'TransactionInactiveError', 'UnknownError',
])

/**
 * Detect a storage-quota / eviction error across browsers. Chrome & Safari throw a
 * `QuotaExceededError` DOMException (legacy numeric code 22); Firefox uses
 * `NS_ERROR_DOM_QUOTA_REACHED`. Dexie re-exposes the DOMException's `name`, and on
 * some errors nests the original under `.inner`, so we recurse into that too.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; code?: number; message?: string; inner?: unknown }
  if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true
  if (e.code === 22) return true
  if (typeof e.message === 'string' && /quota|out of space/i.test(e.message)) return true
  if (e.inner && e.inner !== err) return isQuotaError(e.inner) // Dexie nests the cause
  return false
}

/** True when an error (recursing into Dexie's nested `.inner`) names a dropped
 *  write / closed-DB failure. Quota is handled separately by isQuotaError. */
export function isDroppedWriteError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as { name?: string; inner?: unknown }
  if (typeof e.name === 'string' && DROPPED_WRITE_NAMES.has(e.name)) return true
  if (e.inner && e.inner !== err) return isDroppedWriteError(e.inner)
  return false
}

/** Subscribe to the active storage-error notice. Replays the current state to late
 *  subscribers so a banner mounted after the error still shows it. Returns an
 *  unsubscribe function. */
export function subscribeStorageError(cb: Listener): () => void {
  listeners.add(cb)
  if (active) cb(active)
  return () => { listeners.delete(cb) }
}

/** Report an error. Quota/eviction errors raise the specialized notice; other
 *  dropped-write errors raise a generic one; anything else is ignored (other
 *  layers handle non-storage failures). */
export function reportStorageError(err: unknown): void {
  let message: string | null = null
  if (isQuotaError(err)) message = QUOTA_MESSAGE
  else if (isDroppedWriteError(err)) message = GENERIC_MESSAGE
  if (!message) return
  active = message
  listeners.forEach((cb) => cb(active))
}

/** Clear the active notice (when the user dismisses it). */
export function clearStorageError(): void {
  active = null
  listeners.forEach((cb) => cb(null))
}

let installed = false
/** Install a global `unhandledrejection` listener so uncaught Dexie/IndexedDB quota
 *  rejections surface to the user. Idempotent — safe to call once at app start. */
export function installStorageErrorListener(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('unhandledrejection', (ev) => reportStorageError(ev.reason))
}

/** React binding: the current storage-error message (or null) plus a dismisser. */
export function useStorageError(): { message: string | null; dismiss: () => void } {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => subscribeStorageError(setMessage), [])
  return { message, dismiss: clearStorageError }
}
