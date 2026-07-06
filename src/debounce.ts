// A trailing debounce you can force to completion. Editors write on every
// keystroke; wrapping the commit in one of these collapses a burst of
// keystrokes into a single write while still guaranteeing the last edit lands —
// call `flush()` on blur / route change / unmount so nothing is left pending.

export interface FlushableDebounce<A extends unknown[]> {
  /** Schedule `fn` to run after the idle delay, replacing any pending call. */
  call: (...args: A) => void
  /** Run the pending call now (with its latest args) and clear the timer. No-op if nothing is pending. */
  flush: () => void
  /** Drop the pending call without running it. */
  cancel: () => void
  /** Whether a call is currently scheduled. */
  pending: () => boolean
}

export function flushableDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): FlushableDebounce<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastArgs: A | null = null

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    lastArgs = null
  }

  return {
    call(...args: A) {
      lastArgs = args
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const args = lastArgs as A
        lastArgs = null
        fn(...args)
      }, delay)
    },
    flush() {
      if (timer === null) return
      const args = lastArgs as A
      clear()
      fn(...args)
    },
    cancel: clear,
    pending: () => timer !== null,
  }
}
