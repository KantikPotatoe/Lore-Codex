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

  if (id !== seenId) {
    // A different page. Forget everything: its first `updatedAt` is an arrival,
    // not a save, and the outgoing page's whisper must not follow us here.
    setSeenId(id)
    setSeenAt(undefined)
    setSavedAt(null)
  } else if (updatedAt !== undefined && updatedAt !== seenAt) {
    // `seenAt === undefined` means this is the first `updatedAt` we have seen
    // for this page — it loaded, nobody saved.
    if (seenAt !== undefined) setSavedAt(updatedAt)
    setSeenAt(updatedAt)
  }

  // Tracked in both modes (so entering edit mode can't whisper about a write
  // that predates it), but only ever announced while editing.
  return editing ? savedAt : null
}
