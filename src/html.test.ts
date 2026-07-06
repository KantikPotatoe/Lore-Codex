import { describe, it, expect } from 'vitest'
import { escapeHtml, stripHtml, wikiLinkTitles } from './html'

// src/html.ts is the one place DOMParser usage lives, so several modules depend
// on these two helpers behaving identically everywhere. These tests pin the
// plain-text extraction and the wiki-link reading contract.

describe('stripHtml', () => {
  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('')
  })

  it('strips tags and keeps the text', () => {
    expect(stripHtml('<p>Hello <strong>world</strong></p>')).toBe('Hello world')
  })

  it('decodes HTML entities', () => {
    expect(stripHtml('<p>Tom &amp; Jerry &lt;3</p>')).toBe('Tom & Jerry <3')
  })

  it('flattens deeply nested tags into their text', () => {
    expect(stripHtml('<div><ul><li>a</li><li>b</li></ul></div>')).toBe('ab')
  })
})

describe('escapeHtml', () => {
  it('escapes the five markup-significant characters', () => {
    expect(escapeHtml(`a & b < c > d " e`)).toBe('a &amp; b &lt; c &gt; d &quot; e')
  })

  it('neutralises an attribute-injection payload', () => {
    // A crafted data-URL that would break out of a src="…" attribute.
    expect(escapeHtml('data:image/png" onerror="alert(1)')).toBe(
      'data:image/png&quot; onerror=&quot;alert(1)',
    )
  })

  it('leaves plain text untouched', () => {
    expect(escapeHtml('The Shire')).toBe('The Shire')
  })
})

describe('wikiLinkTitles', () => {
  it('returns [] for empty input', () => {
    expect(wikiLinkTitles('')).toEqual([])
  })

  it('takes the fast path (no parse) when no data-wikilink is present', () => {
    expect(wikiLinkTitles('<p>just <a href="#">a plain link</a></p>')).toEqual([])
  })

  it('reads data-title values from data-wikilink anchors', () => {
    const html =
      '<p>See <a data-wikilink data-title="Gondor">Gondor</a> and ' +
      '<a data-wikilink data-title="Rohan">Rohan</a>.</p>'
    expect(wikiLinkTitles(html)).toEqual(['Gondor', 'Rohan'])
  })

  it('trims titles but preserves their original casing', () => {
    const html = '<a data-wikilink data-title="  The Shire  ">x</a>'
    expect(wikiLinkTitles(html)).toEqual(['The Shire'])
  })

  it('skips wiki-link anchors that have no data-title', () => {
    const html =
      '<a data-wikilink data-title="Kept">a</a>' +
      '<a data-wikilink>dropped</a>' +
      '<a data-wikilink data-title="">empty</a>'
    expect(wikiLinkTitles(html)).toEqual(['Kept'])
  })
})
