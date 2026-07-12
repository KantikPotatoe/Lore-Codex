import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * #216: index.css states its lengths in px. rem had drifted back in ~58 times
 * across the sidebar, graph panel, popover, world-health and page-history
 * blocks — and mixing the two makes spacing impossible to reason about, because
 * rem resolves against the 16px ROOT, not against `body { font-size: 15px }`.
 * A "0.85rem" sitting next to a "13px" is not the near-miss it looks like.
 *
 * If the project ever decides rem is the right call (it is the accessibility-
 * correct unit for type), that is a deliberate, file-wide change — delete this
 * guard as part of it. What it exists to stop is the silent one-off.
 */

// Read from disk, NOT `import css from './index.css?raw'` — Vitest stubs CSS
// imports (`css: false` by default) and `?raw` does not escape that: it yields ''.
const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')

// Guard the digits, not the letters: `counter-increment` and the word "remove"
// both contain "rem", and neither is a length.
const REM_LENGTH = /(?<![\w.-])\d*\.?\d+rem\b/g

describe('index.css units', () => {
  it('states every length in px, not rem', () => {
    const found = css.match(REM_LENGTH) ?? []

    expect(
      found,
      `index.css is px-only (#216), but found rem length(s): ${found.join(', ')}. ` +
        'Convert with px = round(rem × 16) — rem resolves against the 16px root, ' +
        'not against body { font-size: 15px }.',
    ).toEqual([])
  })
})
