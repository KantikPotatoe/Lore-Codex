import JSZip from 'jszip'
import { db } from './db'
import type { LorePage, PageImage } from './db'
import { parseCitations } from './citations'
import { escapeHtml } from './html'
import { saveFile } from './platform'

// Plain-text fields interpolated into the exported markup are escaped via the
// shared escapeHtml (src/html.ts). In-app they render as React text (escaped for
// free), but the static export is a second sink where an unescaped title/label/
// caption like `<script>` would ship live. Body HTML stays raw — Tiptap-emitted
// and sanitized on import.

/** Resolve a page title to its id the way every in-app resolver does:
 *  case-insensitively (findPageIdByTitle, linkedTitles, buildGraphData all
 *  lowercase both sides), so a link written `[[mordor]]` still finds "Mordor". */
function titleKey(title: string): string {
  return title.trim().toLowerCase()
}

function rewriteWikiLinks(html: string, titleToId: Map<string, string>): string {
  return html.replace(
    /<a\s+data-wikilink[^>]*data-title="([^"]*)"[^>]*>(.*?)<\/a>/gs,
    (_, title, inner) => {
      const id = titleToId.get(titleKey(title))
      return id
        ? `<a href="./${id}.html">${inner}</a>`
        : `<span class="broken-link">${inner}</span>`
    }
  )
}

function renderInfobox(page: LorePage): string {
  if (!page.infobox) return ''
  const rows = page.infobox.fields
    .filter(f => f.kind !== 'separator' || page.infobox!.fields.some((g, i) => i > page.infobox!.fields.indexOf(f) && g.value?.trim()))
    .map(f => {
      if (f.kind === 'separator') return `<tr><th colspan="2" class="infobox-sep">${escapeHtml(f.label)}</th></tr>`
      if (!f.value?.trim()) return ''
      return `<tr><th>${escapeHtml(f.label)}</th><td>${escapeHtml(f.value)}</td></tr>`
    })
    .filter(Boolean)
    .join('\n')
  if (!rows) return ''
  const img = page.infobox.image
    ? `<tr><td colspan="2" class="infobox-img"><img src="${escapeHtml(page.infobox.image)}" alt=""></td></tr>`
    : ''
  return `<table class="infobox">\n${img}${rows}\n</table>`
}

function renderGallery(images: PageImage[]): string {
  if (images.length === 0) return ''
  const items = images
    .map((img) => {
      const cap = img.caption ? `<figcaption>${escapeHtml(img.caption)}</figcaption>` : ''
      return `<figure class="gallery-item"><img src="${escapeHtml(img.dataUrl)}" alt="">${cap}</figure>`
    })
    .join('\n')
  return `<section class="gallery"><h2>Images</h2><div class="gallery-grid">${items}</div></section>`
}

function renderReferences(page: LorePage, titleToId: Map<string, string>): string {
  const citations = parseCitations(page.content)
  if (citations.length === 0) return ''
  const items = citations.map((c) => {
    const id = c.target ? titleToId.get(titleKey(c.target)) : undefined
    const source = c.target
      ? (id ? `<a href="./${id}.html">${escapeHtml(c.target)}</a>` : `<span class="broken-link">${escapeHtml(c.target)}</span>`)
      : escapeHtml(c.text)
    const loc = c.locator ? `, ${escapeHtml(c.locator)}` : ''
    const quote = c.quote ? ` — "${escapeHtml(c.quote)}"` : ''
    return `<li>${source}${loc}${quote}</li>`
  }).join('\n')
  return `<section class="references"><h2>References</h2><ol>${items}</ol></section>`
}

function pageHtml(page: LorePage, body: string, backlinks: LorePage[], images: PageImage[], titleToId: Map<string, string>): string {
  const bl = backlinks.length
    ? `<section class="backlinks"><h2>What links here</h2><ul>${backlinks.map(b => `<li><a href="./${b.id}.html">${escapeHtml(b.title)}</a></li>`).join('')}</ul></section>`
    : ''
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<link rel="stylesheet" href="../style.css">
</head>
<body>
<article class="page">
  <header class="page-header">
    <h1>${escapeHtml(page.title)}</h1>
    <span class="category-chip">${escapeHtml(page.category)}</span>
  </header>
  ${renderInfobox(page)}
  <div class="page-body">${body}</div>
  ${renderGallery(images)}
  ${renderReferences(page, titleToId)}
  ${bl}
</article>
</body>
</html>`
}

function indexHtml(pages: LorePage[]): string {
  const byCategory = new Map<string, LorePage[]>()
  for (const p of pages) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, [])
    byCategory.get(p.category)!.push(p)
  }
  const sections = [...byCategory.entries()]
    .map(([cat, ps]) => `<section><h2>${escapeHtml(cat)}</h2><ul>${ps.map(p => `<li><a href="pages/${p.id}.html">${escapeHtml(p.title)}</a></li>`).join('')}</ul></section>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lore Codex Export</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<main class="index">
  <h1>Lore Codex Export</h1>
  ${sections}
</main>
</body>
</html>`
}

const CSS = `
:root { --bg: #1a1a2e; --panel: #16213e; --border: #2a2a4a; --ink: #e0e0e0; --ink-dim: #a0a0c0; --accent: #7c6af4; }
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; padding: 24px; background: var(--bg); color: var(--ink); font-family: system-ui, sans-serif; line-height: 1.6; }
a { color: var(--accent); }
.broken-link { color: #888; text-decoration: line-through; }
.category-chip { font-size: 0.75rem; background: var(--accent); color: #fff; padding: 2px 8px; border-radius: 10px; }
.page { max-width: 800px; margin: 0 auto; }
.page-header { margin-bottom: 16px; }
h1 { margin: 0 0 8px; }
.infobox { float: right; margin: 0 0 16px 16px; border-collapse: collapse; background: var(--panel); border: 1px solid var(--border); font-size: 0.85rem; max-width: 280px; }
.infobox th, .infobox td { padding: 4px 8px; border-bottom: 1px solid var(--border); }
.infobox th { color: var(--ink-dim); font-weight: normal; white-space: nowrap; }
.infobox-sep { font-weight: 600; background: var(--border); }
.infobox-img img { max-width: 100%; display: block; }
.page-body img { max-width: 100%; }
.gallery { clear: both; margin-top: 32px; }
.gallery-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
.gallery-item { margin: 0; }
.gallery-item img { width: 100%; border-radius: 6px; display: block; }
.gallery-item figcaption { font-size: 0.8rem; color: var(--ink-dim); text-align: center; margin-top: 4px; }
.backlinks { margin-top: 32px; border-top: 1px solid var(--border); padding-top: 16px; }
.index { max-width: 900px; margin: 0 auto; }
.index section { margin-bottom: 24px; }
.index ul { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px 16px; }
sup[data-citation] { counter-increment: cite; font-size: 0.7em; }
sup[data-citation]::before { content: "[" counter(cite) "]"; }
.page-body { counter-reset: cite; }
.references { clear: both; margin-top: 32px; border-top: 1px solid var(--border); padding-top: 16px; }
`

/** Build the static export site as a path→content map (no DB, no download), so
 *  the link/infobox/gallery/backlink rendering can be unit-tested. Keys are
 *  `style.css`, `index.html`, and one `pages/<id>.html` per page. */
export function buildHtmlSite(pages: LorePage[], images: PageImage[]): Record<string, string> {
  const titleToId = new Map(pages.map(p => [titleKey(p.title), String(p.id)]))

  // Build reverse link index for backlinks, keyed case-insensitively to match
  // in-app resolution (a link written [[mordor]] backlinks page "Mordor").
  const backlinkMap = new Map<string, LorePage[]>()
  for (const page of pages) {
    const re = /data-title="([^"]*)"/g
    let m: RegExpExecArray | null
    while ((m = re.exec(page.content)) !== null) {
      const target = titleKey(m[1])
      if (!backlinkMap.has(target)) backlinkMap.set(target, [])
      backlinkMap.get(target)!.push(page)
    }
  }

  // Group gallery images by page, sorted by their grid order.
  const imagesByPage = new Map<string, PageImage[]>()
  for (const img of images) {
    const list = imagesByPage.get(img.pageId) ?? []
    list.push(img)
    imagesByPage.set(img.pageId, list)
  }
  for (const list of imagesByPage.values()) list.sort((a, b) => a.order - b.order)

  const files: Record<string, string> = {}
  files['style.css'] = CSS.trim()
  files['index.html'] = indexHtml(pages)
  for (const page of pages) {
    const body = rewriteWikiLinks(page.content, titleToId)
    const backlinks = backlinkMap.get(titleKey(page.title)) ?? []
    files[`pages/${page.id}.html`] = pageHtml(page, body, backlinks, imagesByPage.get(page.id) ?? [], titleToId)
  }
  return files
}

export async function exportAsHtml(): Promise<void> {
  const [pages, images] = await Promise.all([db.pages.toArray(), db.images.toArray()])
  const files = buildHtmlSite(pages, images)

  const zip = new JSZip()
  for (const [path, content] of Object.entries(files)) zip.file(path, content)

  const blob = await zip.generateAsync({ type: 'blob' })
  await saveFile(blob, `lore-export-${new Date().toISOString().slice(0, 10)}.zip`)
}
