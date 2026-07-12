// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #218: `.parchment` sets background-image on a LIST of selectors, but a member
 * that later writes the `background:` SHORTHAND in its own rule resets
 * background-image to `none` — silently killing the grain. Nothing errors; the
 * texture just never renders. That bug shipped four times (#168, #169, #170,
 * #218) before it was understood.
 *
 * This guard evaluates the REAL cascade: it loads the real stylesheet, mounts a
 * bare element per member, and asks the engine what it actually computed. A
 * regex over the source could not see specificity or source order. This can.
 *
 * NOT COVERED: each member is mounted as a bare `<div class="X">` with no
 * ancestors and no second class. A rule that only kills the grain when the
 * member appears in CONTEXT — a compound class, an ancestor selector, or a
 * media query — will not be caught, because that context never exists here.
 */

// Read from disk, NOT `import css from './index.css?raw'` — Vitest stubs CSS
// imports (`css: false` by default) and `?raw` does not escape that: it yields ''.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

/** Derive the member list from the stylesheet, so new members are guarded automatically. */
function parchmentMembers(sheet: string): string[] {
  const stripped = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
  const rule = /([^}{]+)\{\s*background-image:\s*var\(--parchment-noise\)\s*;?\s*\}/.exec(stripped)
  if (!rule) throw new Error('Could not find the .parchment rule in index.css')
  const selectors = rule[1]
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const simple = selectors.filter((s) => /^\.[\w-]+$/.test(s))
  if (simple.length !== selectors.length) {
    const discarded = selectors.filter((s) => !/^\.[\w-]+$/.test(s))
    throw new Error(
      `.parchment list contains selector(s) this guard cannot mount: ${discarded
        .map((s) => `"${s}"`)
        .join(', ')}. Extend parchmentMembers() to handle them — a silently-dropped ` +
        'member is an unguarded member.',
    )
  }
  return simple.map((s) => s.slice(1))
}

describe('parchment grain', () => {
  const members = parchmentMembers(css)

  it('derives the .parchment member list from the stylesheet', () => {
    expect(members).toContain('infobox')
    expect(members).toContain('sidebar')
    expect(members.length).toBeGreaterThan(4)
  })

  it.each(members)('survives the cascade on .%s', (cls) => {
    document.head.innerHTML = `<style>${css}</style>`
    document.body.innerHTML = `<div class="${cls}"></div>`
    const el = document.body.firstElementChild as HTMLElement

    // jsdom does not substitute var(), so this is the literal `var(--parchment-noise)`.
    // The discriminator is `none` (a shorthand wiped it) vs anything else.
    const bg = getComputedStyle(el).backgroundImage

    expect(
      bg,
      `.${cls} lost its parchment grain. Its own rule almost certainly sets the ` +
        '`background:` shorthand — which resets background-image to none. Use the ' +
        '`background-color:` longhand instead. See #218.',
    ).not.toBe('none')
    expect(bg).toBeTruthy()
  })
})
