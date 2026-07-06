import { describe, it, expect } from 'vitest'
import { buildHtmlSite } from './htmlExport'
import type { Infobox, LorePage, PageImage } from './db'

// buildHtmlSite is the pure core of the HTML export (extracted from exportAsHtml
// so the download path stays thin). These tests pin the static-site layout, the
// wiki-link rewriting to file paths, and the infobox/gallery/backlink rendering.

function page(id: string, title: string, opts: Partial<LorePage> = {}): LorePage {
  return {
    id,
    title,
    category: 'Character',
    content: '',
    summary: '',
    tags: [],
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  }
}
function link(title: string): string {
  return `<a data-wikilink data-title="${title}">${title}</a>`
}
function image(id: string, pageId: string, order: number, caption = ''): PageImage {
  return { id, pageId, dataUrl: `data:image/png;base64,${id}`, caption, order, createdAt: 0 }
}

describe('buildHtmlSite', () => {
  it('emits style.css, index.html, and a page file per page', () => {
    const files = buildHtmlSite([page('a', 'A'), page('b', 'B')], [])
    expect(Object.keys(files).sort()).toEqual([
      'index.html',
      'pages/a.html',
      'pages/b.html',
      'style.css',
    ])
  })

  it('groups pages by category in index.html', () => {
    const files = buildHtmlSite(
      [page('a', 'Aragorn', { category: 'Character' }), page('g', 'Gondor', { category: 'Country' })],
      [],
    )
    const index = files['index.html']
    expect(index).toContain('<h2>Character</h2>')
    expect(index).toContain('<h2>Country</h2>')
    expect(index).toContain('href="pages/a.html"')
  })

  it('rewrites resolved wiki links to ./<id>.html and marks broken ones', () => {
    const files = buildHtmlSite(
      [page('a', 'A', { content: `<p>${link('B')} and ${link('Ghost')}</p>` }), page('b', 'B')],
      [],
    )
    const body = files['pages/a.html']
    expect(body).toContain('<a href="./b.html">B</a>')
    expect(body).toContain('<span class="broken-link">Ghost</span>')
  })

  it('renders infobox fields, dropping empties and dangling separators', () => {
    const infobox: Infobox = {
      template: 'Character',
      image: null,
      caption: '',
      fields: [
        { id: '1', label: 'Filled', value: 'Real' },
        { id: '2', label: 'Empty', value: '' },
        { id: '3', label: 'Lonely heading', value: '', kind: 'separator' },
      ],
    }
    const html = buildHtmlSite([page('a', 'A', { infobox })], [])['pages/a.html']
    expect(html).toContain('<th>Filled</th>')
    expect(html).toContain('<td>Real</td>')
    expect(html).not.toContain('Empty')
    // A separator with no field carrying a value after it is dropped.
    expect(html).not.toContain('Lonely heading')
  })

  it('renders a gallery sorted by image order, and omits it when empty', () => {
    const withImgs = buildHtmlSite(
      [page('a', 'A')],
      [image('z', 'a', 1, 'second'), image('y', 'a', 0, 'first')],
    )['pages/a.html']
    expect(withImgs).toContain('<section class="gallery">')
    // order 0 ("first") must appear before order 1 ("second")
    expect(withImgs.indexOf('first')).toBeLessThan(withImgs.indexOf('second'))

    const noImgs = buildHtmlSite([page('a', 'A')], [])['pages/a.html']
    expect(noImgs).not.toContain('class="gallery"')
  })

  it('computes "What links here" backlinks from body references', () => {
    const files = buildHtmlSite(
      [page('a', 'A', { content: `<p>${link('B')}</p>` }), page('b', 'B')],
      [],
    )
    const bPage = files['pages/b.html']
    expect(bPage).toContain('What links here')
    expect(bPage).toContain('<a href="./a.html">A</a>')
  })

  it('escapes plain-text fields interpolated into the exported HTML', () => {
    const infobox: Infobox = {
      template: 'Character',
      image: null,
      caption: '',
      fields: [{ id: '1', label: 'Weapon <b>', value: 'Sting & <i>glow</i>' }],
    }
    const cite = `<sup data-citation data-text="Book <x>" data-locator="p<1>" data-quote="he said &quot;hi&quot;"></sup>`
    const files = buildHtmlSite(
      [page('a', 'Sauron <script>alert(1)</script>', { category: 'Villain & Co', content: `<p>${cite}</p>`, infobox })],
      [image('img', 'a', 0, 'A <b>caption</b>')],
    )
    const html = files['pages/a.html']
    // No raw script/markup from a plain-text field survives into the output.
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('Sauron &lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('Villain &amp; Co')
    expect(html).toContain('Weapon &lt;b&gt;')
    expect(html).toContain('Sting &amp; &lt;i&gt;glow&lt;/i&gt;')
    expect(html).toContain('A &lt;b&gt;caption&lt;/b&gt;')
    expect(html).toContain('Book &lt;x&gt;')
    // index.html interpolates title + category too.
    expect(files['index.html']).not.toContain('<script>alert(1)</script>')
  })

  it('escapes image src attributes so a crafted data-URL cannot inject markup', () => {
    // A backup can carry an infobox.image / gallery dataUrl that closes the
    // src="…" attribute and adds an event handler. The export is the one sink
    // that interpolates these into raw markup, so it must attribute-escape them.
    const infobox: Infobox = {
      template: 'Character',
      image: 'data:image/png;base64,AAA" onerror="alert(1)',
      caption: '',
      fields: [{ id: '1', label: 'Name', value: 'Ok' }],
    }
    const gallery: PageImage = {
      id: 'g',
      pageId: 'a',
      dataUrl: 'data:image/png;base64,BBB" onerror="alert(2)',
      caption: '',
      order: 0,
      createdAt: 0,
    }
    const html = buildHtmlSite([page('a', 'A', { infobox })], [gallery])['pages/a.html']
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).not.toContain('onerror="alert(2)"')
    expect(html).toContain('data:image/png;base64,AAA&quot; onerror=&quot;alert(1)')
    expect(html).toContain('data:image/png;base64,BBB&quot; onerror=&quot;alert(2)')
  })

  it('resolves wiki links, backlinks, and citations case-insensitively', () => {
    const files = buildHtmlSite(
      [
        page('a', 'A', { content: `<p>${link('mordor')}</p>` }),
        page('m', 'Mordor'),
      ],
      [],
    )
    // Link written as [[mordor]] resolves to the "Mordor" page (not broken).
    expect(files['pages/a.html']).toContain('<a href="./m.html">mordor</a>')
    expect(files['pages/a.html']).not.toContain('broken-link')
    // Backlink index is likewise case-insensitive.
    expect(files['pages/m.html']).toContain('What links here')
    expect(files['pages/m.html']).toContain('<a href="./a.html">A</a>')
  })

  it('renders a References section with page links and free text', () => {
    const cite = (a: Record<string, string>) =>
      `<sup data-citation ${Object.entries(a).map(([k, v]) => `data-${k}="${v}"`).join(' ')}></sup>`
    const pages = [
      page('a', 'A', { content: `<p>x${cite({ target: 'B', locator: 'Ch.1' })} y${cite({ text: 'Ledger' })}</p>` }),
      page('b', 'B'),
    ]
    const files = buildHtmlSite(pages, [])
    const html = files['pages/a.html']
    expect(html).toContain('<section class="references">')
    expect(html).toContain('href="./b.html"') // page source linked
    expect(html).toContain('Ch.1')
    expect(html).toContain('Ledger')
    expect(files['style.css']).toContain('counter-increment: cite')
  })
})
