import { createContext, useContext, type ReactNode } from 'react'
import { useUpdateCheck } from './useUpdateCheck'

type UpdateCheckValue = ReturnType<typeof useUpdateCheck>

// `useUpdateCheck` holds a `pending` ref to a live plugin handle, so a second
// instance means a second handle that the first knows nothing about. That is
// not a performance concern — it silently reopens the stranding bug fixed in
// 0f5429c: the banner could dismiss (recording the version, hiding it from
// every future automatic check) while a *different* instance held a
// downloaded, now-unreachable installer. One provider, one state machine.
const Ctx = createContext<UpdateCheckValue | null>(null)

export function UpdateCheckProvider({ children }: { children: ReactNode }) {
  const value = useUpdateCheck()
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/** Throws outside the provider — a silent fallback would resurrect the very
 *  split-instance bug this context exists to prevent.
 *
 *  Kept beside the provider on purpose: the whole point of this module is that
 *  there is exactly ONE way to reach the update state machine, and splitting
 *  the accessor into a second file just to satisfy fast refresh would give the
 *  invariant two homes. Cost is a full reload when this file is edited. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSharedUpdateCheck(): UpdateCheckValue {
  const value = useContext(Ctx)
  if (!value) throw new Error('useSharedUpdateCheck must be used inside <UpdateCheckProvider>')
  return value
}
