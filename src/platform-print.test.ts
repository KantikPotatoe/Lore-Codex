// @vitest-environment jsdom
//
// jsdom (not the suite-default happy-dom) because printHtml renders into an
// iframe and happy-dom's iframes don't expose a usable contentDocument.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { printHtml } from './platform'

afterEach(() => {
  document.querySelectorAll('iframe').forEach((f) => f.remove())
})

describe('printHtml', () => {
  it('renders the document into a hidden frame and prints that frame', async () => {
    const promise = printHtml('<!DOCTYPE html><html><body><p class="probe">Book</p></body></html>')

    // The frame exists synchronously; the print call happens a microtask
    // later (after the readiness await), so the spy installs in time.
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-platform-print]')
    expect(frame).not.toBeNull()
    const win = frame!.contentWindow as (Window & { print?: () => void })
    const print = vi.fn()
    win.print = print

    await promise

    expect(print).toHaveBeenCalledOnce()
    expect(frame!.contentDocument?.querySelector('.probe')?.textContent).toBe('Book')
  })

  it('removes the frame once printing is done (afterprint)', async () => {
    const promise = printHtml('<!DOCTYPE html><html><body>x</body></html>')
    const frame = document.querySelector<HTMLIFrameElement>('iframe[data-platform-print]')!
    ;(frame.contentWindow as Window & { print?: () => void }).print = vi.fn()
    await promise

    frame.contentWindow!.dispatchEvent(new Event('afterprint'))
    expect(document.querySelector('iframe[data-platform-print]')).toBeNull()
  })
})
