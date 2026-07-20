/** How a multi-tag selection combines when filtering the graph. */
export type TagMode = 'any' | 'all'

/** A tag selection plus the rule for combining it. */
export interface TagFilter {
  tags: string[]
  mode: TagMode
}

/** Stable identity for "nothing selected", so consumers' useMemo deps don't
 *  churn while the filter is empty. */
export const NO_TAG_FILTER: TagFilter = { tags: [], mode: 'any' }

/** Does a node's tag list satisfy the filter? An empty selection is not a
 *  filter at all, so everything passes. Callers that need "nothing selected
 *  means nothing matches" — colour-by-tag highlighting — check `tags.length`
 *  themselves rather than overloading this. */
export function matchesTags(nodeTags: string[], f: TagFilter): boolean {
  if (f.tags.length === 0) return true
  const has = new Set(nodeTags)
  return f.mode === 'all' ? f.tags.every((t) => has.has(t)) : f.tags.some((t) => has.has(t))
}
