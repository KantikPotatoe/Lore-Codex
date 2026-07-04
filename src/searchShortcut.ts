/** Decide whether a window-level keydown should open the search modal.
 *  Ctrl/Cmd+K always opens; a bare `/` opens only when focus isn't in an
 *  editable control (inputs, selects, contenteditable — incl. ProseMirror),
 *  so typing text is never hijacked. */
export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  // closest() (not isContentEditable) so descendants of a contenteditable host
  // match in every DOM implementation the tests run under.
  return target.closest('[contenteditable="true"]') !== null
}

export function shouldOpenSearch(e: KeyLike, target: EventTarget | null): boolean {
  if (e.altKey) return false
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') return true
  if (e.key === '/' && !e.ctrlKey && !e.metaKey) return !isEditableTarget(target)
  return false
}
