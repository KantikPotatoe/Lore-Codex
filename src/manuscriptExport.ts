import JSZip from 'jszip'
import { sanitizeHtml } from './sanitize'
import { db } from './db'
import { saveFile, printHtml } from './platform'
import type { Book, Chapter, Scene } from './db'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Sanitize body HTML and self-close the void elements Tiptap emits, so the
 *  result is XHTML-friendly for EPUB readers. Not a full XML validator — good
 *  enough for common readers; the print path is the fidelity fallback. */
export function toXhtml(html: string): string {
  return sanitizeHtml(html).replace(/<(br|hr|img)((?:[^>]*?))\s*\/?>/g, '<$1$2 />')
}

function scenesFor(chapterId: string, scenes: Scene[]): Scene[] {
  return scenes.filter((s) => s.chapterId === chapterId).sort((a, b) => a.order - b.order)
}

function orderedChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => a.order - b.order)
}

function chapterBody(chapter: Chapter, scenes: Scene[]): string {
  const body = scenesFor(chapter.id, scenes)
    .map((s) => toXhtml(s.content))
    .join('\n')
  return `<h1>${escapeHtml(chapter.title)}</h1>\n${body}`
}

function chapterXhtml(chapter: Chapter, scenes: Scene[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><meta charset="UTF-8" /><title>${escapeHtml(chapter.title)}</title></head>
<body>
${chapterBody(chapter, scenes)}
</body>
</html>`
}

/** A single self-contained HTML document for browser print / Save-as-PDF. */
export function compileBookHtml(book: Book, chapters: Chapter[], scenes: Scene[]): string {
  const chaptersHtml = orderedChapters(chapters)
    .map((c) => `<section class="chapter">${chapterBody(c, scenes)}</section>`)
    .join('\n')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(book.title)}</title>
<style>
  @media print { .chapter { page-break-before: always; } .chapter:first-child { page-break-before: avoid; } }
  body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.6; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { font-size: 1.6rem; margin-top: 2rem; }
</style>
</head>
<body>
<h1 class="book-title">${escapeHtml(book.title)}</h1>
${chaptersHtml}
</body>
</html>`
}

/** Build the EPUB as a path→content map (no DB, no download) so the structure is
 *  unit-testable. `mimetype` MUST be emitted (and later zipped) first & stored. */
export function buildEpub(book: Book, chapters: Chapter[], scenes: Scene[]): Record<string, string> {
  const ordered = orderedChapters(chapters)
  const files: Record<string, string> = {}
  files['mimetype'] = 'application/epub+zip'
  files['META-INF/container.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles>
</container>`

  ordered.forEach((c, i) => {
    files[`OEBPS/chapter-${i}.xhtml`] = chapterXhtml(c, scenes)
  })

  const manifestItems = ordered
    .map((_, i) => `<item id="chapter-${i}" href="chapter-${i}.xhtml" media-type="application/xhtml+xml" />`)
    .join('\n    ')
  const spineItems = ordered.map((_, i) => `<itemref idref="chapter-${i}" />`).join('\n    ')

  files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${book.id}</dc:identifier>
    <dc:title>${escapeHtml(book.title)}</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`

  const navItems = ordered
    .map((c, i) => `<li><a href="chapter-${i}.xhtml">${escapeHtml(c.title)}</a></li>`)
    .join('\n      ')
  files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">
<head><meta charset="UTF-8" /><title>${escapeHtml(book.title)}</title></head>
<body>
  <nav epub:type="toc"><ol>
      ${navItems}
  </ol></nav>
</body>
</html>`

  return files
}

// --- DB + download/print wrappers (side effects; not unit-tested) -------------

async function loadBook(bookId: string) {
  const [book, chapters, scenes] = await Promise.all([
    db.books.get(bookId),
    db.chapters.where('bookId').equals(bookId).toArray(),
    db.scenes.where('bookId').equals(bookId).toArray(),
  ])
  return { book, chapters, scenes }
}

export async function exportBookEpub(bookId: string): Promise<void> {
  const { book, chapters, scenes } = await loadBook(bookId)
  if (!book) return
  const files = buildEpub(book, chapters, scenes)

  const zip = new JSZip()
  // mimetype first and stored (uncompressed), per the EPUB OCF spec.
  zip.file('mimetype', files['mimetype'], { compression: 'STORE' })
  for (const [path, content] of Object.entries(files)) {
    if (path === 'mimetype') continue
    zip.file(path, content)
  }
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
  await saveFile(blob, `${book.title.replace(/[^\w.-]+/g, '_') || 'book'}.epub`)
}

export async function printBook(bookId: string): Promise<void> {
  const { book, chapters, scenes } = await loadBook(bookId)
  if (!book) return
  // Hidden-iframe print via the platform seam — window.open + print() is
  // popup-blocker-prone in browsers and unreliable in the shell's webview.
  await printHtml(compileBookHtml(book, chapters, scenes))
}
