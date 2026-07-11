/** Deterministic cover colour for a book, derived from its title.
 *
 *  Books carry no colour of their own. Rather than add a field, the shelf hashes
 *  the title (djb2) into the caller's palette — so every book looks distinct and
 *  looks the same on every visit. The trade: renaming a book re-colours its cover.
 *
 *  The palette is a parameter, not an import: TYPE_COLORS lives in db/schema.ts,
 *  which builds the Dexie singleton at module load, and a colour lookup has no
 *  business dragging the database in behind it. */
export function coverHue(title: string, palette: readonly string[]): string {
  let hash = 5381
  for (let i = 0; i < title.length; i++) {
    // `| 0` keeps the running hash a 32-bit int rather than drifting into floats.
    hash = ((hash << 5) + hash + title.charCodeAt(i)) | 0
  }
  return palette[Math.abs(hash) % palette.length]
}
