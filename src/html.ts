// src/html.ts
// Shared helpers for reading rich-text HTML. The editor stores page bodies (and
// event descriptions) as HTML strings, so several modules need to pull plain
// text or wiki-link targets back out. Keeping the DOMParser usage here means the
// parsing behaves identically everywhere instead of being reinvented per call site.

/** Parse an HTML fragment into a detached Document (never touches the live page). */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

/** Escape the five markup-significant characters so a plain-text string is safe
 *  to interpolate into HTML — as element text OR inside a double-quoted attribute
 *  (`"` is escaped, so it can't break out of `src="…"`). These are XSS-load-bearing
 *  in every static/print sink (HTML export, EPUB/print, search snippets), so they
 *  share this one definition instead of hand-rolling a copy each (which is exactly
 *  how a copy missing `"` — an attribute-injection hole — gets born). */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Plain-text content of an HTML fragment — tags stripped, entities decoded. */
export function stripHtml(html: string): string {
  if (!html) return ''
  return parseHtml(html).body.textContent ?? ''
}

/** The wiki-link target titles in an HTML body, read from
 *  `<a data-wikilink data-title="…">` anchors. Titles are trimmed but returned
 *  with their original casing (callers lowercase when they need to compare). */
export function wikiLinkTitles(html: string): string[] {
  if (!html || !html.includes('data-wikilink')) return []
  const out: string[] = []
  parseHtml(html)
    .querySelectorAll('a[data-wikilink]')
    .forEach((a) => {
      const t = a.getAttribute('data-title')?.trim()
      if (t) out.push(t)
    })
  return out
}
