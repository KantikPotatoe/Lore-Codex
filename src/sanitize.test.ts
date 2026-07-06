// @vitest-environment jsdom
//
// DOMPurify is run against jsdom here, not the suite-default happy-dom: happy-dom's
// HTML parser is not faithful enough for DOMPurify (it lets <script> survive), while
// jsdom is DOMPurify's reference DOM. Production runs in a real browser (Firefox),
// where DOMPurify behaves like jsdom — so jsdom is the correct fidelity to test at.
import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('strips <script> tags entirely', () => {
    const out = sanitizeHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).toContain('<p>hi</p>')
    expect(out.toLowerCase()).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('keeps a body-image ref (img with only data-image-id, no src) through import (#182)', () => {
    const out = sanitizeHtml('<p><img data-image-id="abc123"></p>')
    expect(out).toContain('data-image-id="abc123"')
    expect(out).toContain('<img')
  })

  it('strips event-handler attributes like onerror', () => {
    const out = sanitizeHtml('<img src="data:image/png;base64,AAAA" onerror="alert(1)">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).not.toContain('alert(1)')
  })

  it('neutralises a broken-image onerror XSS payload', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(document.cookie)">')
    expect(out.toLowerCase()).not.toContain('onerror')
    expect(out).not.toContain('alert')
  })

  it('removes javascript: hrefs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>')
    expect(out.toLowerCase()).not.toContain('javascript:')
  })

  it('drops <iframe>/<object>/<embed>', () => {
    const out = sanitizeHtml('<iframe src="evil"></iframe><object></object><embed>')
    expect(out.toLowerCase()).not.toContain('<iframe')
    expect(out.toLowerCase()).not.toContain('<object')
    expect(out.toLowerCase()).not.toContain('<embed')
  })

  // --- Everything Tiptap legitimately produces must survive unchanged ---

  it('keeps wiki-link anchors (data-wikilink / data-title / class)', () => {
    const html = '<a data-wikilink="" data-title="Gandalf" class="wiki-link">Gandalf</a>'
    const out = sanitizeHtml(html)
    expect(out).toContain('data-wikilink')
    expect(out).toContain('data-title="Gandalf"')
    expect(out).toContain('wiki-link')
  })

  it('keeps external ext-link anchors with target/rel', () => {
    const html =
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" class="ext-link">x</a>'
    const out = sanitizeHtml(html)
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('ext-link')
  })

  it('keeps inline images embedded as data URLs', () => {
    const html = '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt="pic">'
    const out = sanitizeHtml(html)
    expect(out).toContain('data:image/png;base64,')
  })

  it('keeps tables produced by TableKit', () => {
    const html =
      '<table><tbody><tr><th colspan="2">H</th></tr><tr><td>a</td><td>b</td></tr></tbody></table>'
    const out = sanitizeHtml(html)
    expect(out).toContain('<table')
    expect(out).toContain('<td')
    expect(out).toContain('colspan="2"')
  })

  it('keeps headings, lists, marks and blockquotes', () => {
    const html =
      '<h2>T</h2><ul><li><strong>a</strong></li></ul><blockquote><em>q</em></blockquote>'
    const out = sanitizeHtml(html)
    expect(out).toContain('<h2>')
    expect(out).toContain('<li>')
    expect(out).toContain('<strong>')
    expect(out).toContain('<blockquote>')
  })

  it('keeps citation markers (sup data-citation + data-* attrs)', () => {
    const html = '<sup data-citation data-target="Frodo" data-locator="p.2" data-quote="hi" class="citation"></sup>'
    const out = sanitizeHtml(html)
    expect(out).toContain('data-citation')
    expect(out).toContain('data-target="Frodo"')
    expect(out).toContain('data-locator="p.2"')
    expect(out).toContain('citation')
  })

  it('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('')
  })
})
