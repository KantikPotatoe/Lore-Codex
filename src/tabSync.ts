// src/tabSync.ts
// Cross-tab world-change guard. IndexedDB is origin-shared, so a second tab
// can import (clear + bulkAdd) or delete the world this tab is editing. Import
// is completely silent to other tabs (no versionchange fires — same DB version),
// so the storageError listener can't catch it; a BroadcastChannel is the only
// signal. On a matching message this tab freezes into a reload overlay.
//
// React-free (except the hook at the bottom, mirroring storageError.ts) so it
// can be imported from the data layer without pulling React into it.

import { useEffect, useState } from 'react'

export type WorldChangeReason = 'import' | 'delete'

export interface WorldChangeMessage {
  type: 'world-changed'
  loreId: string
  reason: WorldChangeReason
}

const CHANNEL_NAME = 'lore-tab-sync'

type Listener = (reason: WorldChangeReason | null) => void
const listeners = new Set<Listener>()
let active: WorldChangeReason | null = null

/** Pure predicate: is `msg` a world-change for the lore this tab bound to? */
export function matchesBoundLore(msg: unknown, boundLoreId: string): msg is WorldChangeMessage {
  if (!msg || typeof msg !== 'object') return false
  const m = msg as Partial<WorldChangeMessage>
  return (
    m.type === 'world-changed' &&
    m.loreId === boundLoreId &&
    (m.reason === 'import' || m.reason === 'delete')
  )
}

/** Subscribe to the freeze state. Replays the current reason to late subscribers
 *  so an overlay mounted after the message still shows. Returns an unsubscribe. */
export function subscribeTabSync(cb: Listener): () => void {
  listeners.add(cb)
  if (active) cb(active)
  return () => { listeners.delete(cb) }
}

function raise(reason: WorldChangeReason): void {
  active = reason
  listeners.forEach((cb) => cb(active))
}

/** Apply a received channel message to the bus: freeze this tab when the message
 *  targets the lore it bound to. Exposed (rather than inlined in the listener) so
 *  the message-handling path is deterministically testable without a live channel. */
export function handleIncoming(data: unknown, boundLoreId: string): void {
  if (matchesBoundLore(data, boundLoreId)) raise(data.reason)
}

/** Reset the active freeze state (used by tests). */
export function clearTabSync(): void {
  active = null
  listeners.forEach((cb) => cb(null))
}

let channel: BroadcastChannel | null = null
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME)
  return channel
}

/** Tell other tabs that `loreId` was imported/deleted. No-op without support.
 *  BroadcastChannel does NOT deliver to the sending tab, so the acting tab is
 *  never frozen by its own message. */
export function broadcastWorldChange(loreId: string, reason: WorldChangeReason): void {
  const ch = getChannel()
  if (!ch) return
  const msg: WorldChangeMessage = { type: 'world-changed', loreId, reason }
  ch.postMessage(msg)
}

let installed = false
/** Listen for other tabs' world changes and freeze this tab when one targets the
 *  lore it bound to at load. Idempotent; no-op without BroadcastChannel support. */
export function installTabSyncListener(boundLoreId: string): void {
  if (installed) return
  const ch = getChannel()
  if (!ch) return
  installed = true
  ch.addEventListener('message', (ev: MessageEvent) => handleIncoming(ev.data, boundLoreId))
}

/** React binding: the current freeze reason (or null). */
export function useTabSync(): { reason: WorldChangeReason | null } {
  const [reason, setReason] = useState<WorldChangeReason | null>(null)
  useEffect(() => subscribeTabSync(setReason), [])
  return { reason }
}
