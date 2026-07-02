import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { pageRepo } from './db'

export interface WikiLinkNavigation {
  /** Title staged for create-confirmation, or null when no prompt is open. */
  pendingTitle: string | null
  /** Follow a wiki link: open the page if it exists, else stage it for creation. */
  follow: (title: string) => Promise<void>
  /** Stage a known-missing title straight to the create prompt (e.g. a ghost node,
   *  which is missing by definition, so no existence check is needed first). */
  stageCreate: (title: string) => void
  /** Create the staged page as a stub — reusing an existing one if the title now
   *  resolves — and open it. */
  confirmCreate: () => Promise<void>
  /** Dismiss the create prompt without creating anything. */
  cancelCreate: () => void
}

/** Controller for the "click a wiki link / ghost node → open it, or confirm
 *  creating the missing page" flow shared by PageRoute and GraphRoute. Owns only
 *  the pending-title state plus the navigate/create side effects; each route
 *  keeps its own confirm-dialog markup wired to this state. */
export function useWikiLinkNavigation(): WikiLinkNavigation {
  const navigate = useNavigate()
  const [pendingTitle, setPendingTitle] = useState<string | null>(null)

  const follow = useCallback(
    async (title: string) => {
      const existing = await pageRepo.findIdByTitle(title)
      if (existing) {
        navigate(`/page/${existing}`)
        return
      }
      setPendingTitle(title.trim())
    },
    [navigate],
  )

  const stageCreate = useCallback((title: string) => setPendingTitle(title), [])

  const confirmCreate = useCallback(async () => {
    const title = pendingTitle
    setPendingTitle(null)
    if (!title) return
    // Reuse a page that now holds this title rather than creating a duplicate
    // (pageRepo.create rejects a title clash) — covers the race where it was
    // created between staging and confirming.
    const id = (await pageRepo.findIdByTitle(title)) ?? (await pageRepo.create({ title, status: 'Stub' }))
    navigate(`/page/${id}`)
  }, [pendingTitle, navigate])

  const cancelCreate = useCallback(() => setPendingTitle(null), [])

  return { pendingTitle, follow, stageCreate, confirmCreate, cancelCreate }
}
