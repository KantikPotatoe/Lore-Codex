import { useState } from 'react'

/** Signals that a write to the open page just landed, so the header can whisper
 *  "Saved".
 *
 *  The signal is `updatedAt` advancing. Every write path in PageRoute — body
 *  text, summary, status, category, tags, title, infobox — goes through
 *  `pageRepo.update`, which stamps `updatedAt: now()`. Watching that one field
 *  therefore covers all of them, and the whisper honestly means "the page on
 *  disk changed" rather than only "your typing landed".
 *
 *  State is derived during render rather than in an effect: `set-state-in-effect`
 *  is a lint error in this repo, and this is React's documented "adjust state
 *  while rendering" pattern — the same one PageRoute already uses to reset edit
 *  mode when the route's page id changes.
 *
 *  `updatedAt` is tracked in both modes, so a write that lands while the user
 *  is only reading is never mistaken for a save. But that write must not
 *  leak forward either: entering edit mode (an `editing` transition to `true`)
 *  establishes a FRESH BASELINE — it re-syncs to whatever `updatedAt` is
 *  already current and drops any `savedAt` accumulated while reading (or left
 *  over from a previous edit session). Only a write that lands *after* that
 *  baseline is ever announced, and the whisper is only ever returned while
 *  `editing` is true.
 *
 *  @param id        the open page's id — a change means we navigated
 *  @param updatedAt the live-queried page's `updatedAt`; `undefined` while loading
 *  @param editing   whether the editor is open
 *  @returns the `updatedAt` of the write that just landed, else `null`. Callers
 *           use it as a React `key` so the marker remounts (and its CSS decay
 *           animation restarts) on every save.
 */
export function useSaveWhisper(
  id: string,
  updatedAt: number | undefined,
  editing: boolean,
): number | null {
  const [seenId, setSeenId] = useState(id)
  const [seenAt, setSeenAt] = useState<number | undefined>(undefined)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [seenEditing, setSeenEditing] = useState(editing)

  if (id !== seenId) {
    // A different page. Forget everything: its first `updatedAt` is an arrival,
    // not a save, and the outgoing page's whisper must not follow us here.
    setSeenId(id)
    setSeenAt(undefined)
    setSavedAt(null)
    setSeenEditing(editing)
  } else if (editing && !seenEditing) {
    // Entering edit mode. Whatever `updatedAt` is already current — even if
    // it changed in this very render — predates (or is concurrent with) the
    // start of editing, not a save made while editing. Re-sync to it and
    // drop any `savedAt` carried over from the reading period (or a prior
    // edit session), so only writes that land from here on are announced.
    setSeenAt(updatedAt)
    setSavedAt(null)
    setSeenEditing(editing)
  } else {
    if (editing !== seenEditing) setSeenEditing(editing)
    if (updatedAt !== undefined && updatedAt !== seenAt) {
      // `seenAt === undefined` means this is the first `updatedAt` we have
      // seen for this page — it loaded, nobody saved.
      if (seenAt !== undefined) setSavedAt(updatedAt)
      setSeenAt(updatedAt)
    }
  }

  return editing ? savedAt : null
}
