import { useState } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

export type NavDirection = 'forward' | 'back'

/**
 * Decide the page-transition direction. The primary signal is react-router's
 * monotonic history index: a strict *decrease* is `back`, an increase is
 * `forward`. `navType` ('POP' | 'PUSH' | 'REPLACE') is only a tiebreaker for
 * the case the index can't settle — returning to the session's first entry,
 * which predates the router and carries no idx: a POP with a known previous
 * entry is a back navigation. `useNavigationType` can't stand alone (browser
 * back and forward are both 'POP'), so the index leads.
 */
export function navDirection(
  prevIdx: number | undefined,
  nextIdx: number | undefined,
  navType: string,
): NavDirection {
  if (prevIdx !== undefined && nextIdx !== undefined) {
    return nextIdx < prevIdx ? 'back' : 'forward'
  }
  if (navType === 'POP' && prevIdx !== undefined) return 'back'
  return 'forward'
}

function historyIdx(): number | undefined {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx : undefined
}

/**
 * Returns the current navigation's direction. Derived during render via the
 * "store info from the previous render" pattern: state remembers the last
 * location key and its history index, so the direction is recomputed only when
 * the history entry actually changes. Unrelated App re-renders (scroll, search
 * toggle) return the cached direction — never flipping it mid-animation.
 */
export function useNavDirection(): NavDirection {
  const location = useLocation()
  const navType = useNavigationType()
  const [prev, setPrev] = useState<{ key: string; idx: number | undefined; dir: NavDirection }>(() => ({
    key: location.key,
    idx: historyIdx(),
    dir: 'forward',
  }))

  if (location.key !== prev.key) {
    const nextIdx = historyIdx()
    const dir = navDirection(prev.idx, nextIdx, navType)
    setPrev({ key: location.key, idx: nextIdx, dir })
    return dir
  }
  return prev.dir
}
