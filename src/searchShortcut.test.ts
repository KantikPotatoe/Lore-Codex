import { describe, it, expect } from 'vitest'
import { shouldOpenSearch } from './searchShortcut'

function key(over: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) {
  return { key: '/', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over }
}

describe('shouldOpenSearch', () => {
  it('Ctrl+K opens regardless of focus target', () => {
    const input = document.createElement('input')
    expect(shouldOpenSearch(key({ key: 'k', ctrlKey: true }), input)).toBe(true)
  })

  it('Cmd+K (uppercase K) opens too', () => {
    expect(shouldOpenSearch(key({ key: 'K', metaKey: true }), null)).toBe(true)
  })

  it('bare / opens when focus is on the body', () => {
    expect(shouldOpenSearch(key(), document.body)).toBe(true)
  })

  it('bare / is ignored inside inputs, textareas, selects', () => {
    for (const tag of ['input', 'textarea', 'select'] as const) {
      expect(shouldOpenSearch(key(), document.createElement(tag))).toBe(false)
    }
  })

  it('bare / is ignored inside contenteditable (ProseMirror) and its descendants', () => {
    const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true')
    const child = document.createElement('span')
    editor.appendChild(child)
    expect(shouldOpenSearch(key(), editor)).toBe(false)
    expect(shouldOpenSearch(key(), child)).toBe(false)
  })

  it('Alt combos and unrelated keys never open', () => {
    expect(shouldOpenSearch(key({ key: 'k', ctrlKey: true, altKey: true }), null)).toBe(false)
    expect(shouldOpenSearch(key({ key: 'a' }), document.body)).toBe(false)
    expect(shouldOpenSearch(key({ key: '/', ctrlKey: true }), document.body)).toBe(false)
  })

  it('Ctrl+Shift+K is left to the browser (devtools)', () => {
    expect(shouldOpenSearch(key({ key: 'K', ctrlKey: true, shiftKey: true }), null)).toBe(false)
  })
})
