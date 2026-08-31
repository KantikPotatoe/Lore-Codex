import { db, now, CATEGORIES, DEFAULT_CATEGORY } from './schema'
import type {
  FieldType,
  Infobox,
  InfoboxField,
  InfoboxTemplate,
  LorePage,
  TemplateItem,
} from './types'

// ---------------------------------------------------------------------------
// Infobox templates
// ---------------------------------------------------------------------------
// A template is a named, ordered list of starter rows. Each row is either a
// field (a label you fill in) or a separator (a section heading). Pick a
// different template and the rows change. You can still rename, add, remove, or
// reorder rows on any page — templates are only a convenient starting point.
//
// Templates live in the database (the `templates` table) so they can be edited
// and new ones added from the Templates screen. The built-ins below are seeded
// on first run and re-seeded only if missing (your edits are never overwritten).

const sep = (label: string): TemplateItem => ({ label, separator: true })
const f = (label: string): TemplateItem => ({ label })
const ref = (label: string, refType: string): TemplateItem => ({ label, fieldType: 'ref', refType })
const num = (label: string): TemplateItem => ({ label, fieldType: 'number' })
const hue = (name: string): string => CATEGORIES.find((c) => c.name === name)?.color ?? '#a0a0a0'

// Default emojis for the shipped page types. Backfilled onto built-ins by
// seedTemplates() without overwriting a user's choice (mirrors the colour backfill).
export const BUILTIN_ICONS: Record<string, string> = {
  Character: '🧑', Country: '🏳️', Deity: '✨', Geography: '⛰️', Item: '🎒',
  Organization: '🏛️', Religion: '⛩️', Species: '🐾', Settlement: '🏰',
  Condition: '🤒', Conflict: '⚔️', Document: '📜', Culture: '🎭',
  Language: '🗣️', Material: '⛏️', Myth: '🐉', Technology: '⚙️',
  Tradition: '🎎', Spell: '🔮',
}

// Default starter body-sections for the shipped page types. Backfilled onto
// built-ins by seedTemplates() without overwriting a user's edits (mirrors the
// icon/colour backfill). A section becomes an <h2> heading in the page body when
// the author clicks "＋ Sections" in the editor.
export const BUILTIN_SECTIONS: Record<string, string[]> = {
  Character: ['Appearance', 'Personality', 'Background', 'History', 'Relationships'],
  Country: ['History', 'Geography', 'Government', 'Culture', 'Economy'],
  Deity: ['Description', 'Domains', 'Worship', 'Mythology'],
  Geography: ['Description', 'Climate', 'Flora & Fauna', 'History'],
  Item: ['Description', 'History', 'Powers'],
  Organization: ['History', 'Structure', 'Activities', 'Members'],
  Religion: ['Beliefs', 'Practices', 'History', 'Organization'],
  Species: ['Biology', 'Behaviour', 'Habitat', 'Culture'],
  Settlement: ['History', 'Geography', 'Government', 'Economy', 'Culture'],
  Condition: ['Symptoms', 'Causes', 'Treatment', 'History'],
  Conflict: ['Background', 'Course', 'Aftermath'],
  Document: ['Summary', 'Contents', 'History'],
  Culture: ['Overview', 'Customs', 'Beliefs', 'Arts', 'History'],
  Language: ['Overview', 'Phonology', 'Grammar', 'Writing system', 'History'],
  Material: ['Description', 'Properties', 'Sources', 'Uses'],
  Myth: ['Summary', 'Origins', 'Interpretations'],
  Technology: ['Description', 'History', 'Applications'],
  Tradition: ['Overview', 'Practice', 'Origins', 'Significance'],
  Spell: ['Description', 'Effects', 'Casting', 'History'],
}

// Default sidebar groups for the shipped page types (#115). Backfilled onto
// built-ins by seedTemplates() without overwriting a user's choice (mirrors the
// icon/colour/sections backfill). Two levels only: group → type → pages.
// No group name equals a type name, so the sidebar never shows a "Culture"
// group whose only distinct child is "Language".
export const BUILTIN_GROUPS: Record<string, string> = {
  Country: 'Places', Geography: 'Places', Settlement: 'Places',
  Character: 'People', Organization: 'People', Species: 'People',
  Deity: 'Belief', Religion: 'Belief', Myth: 'Belief',
  Culture: 'Society', Language: 'Society', Tradition: 'Society',
  Item: 'Things', Material: 'Things', Technology: 'Things', Spell: 'Things',
  Conflict: 'Events & Records', Document: 'Events & Records',
  Condition: 'Events & Records',
}

// The starter types. Each has a colour and a set of infobox rows; several ship
// with separators already in place to show how they group related fields.
export const BUILTIN_TEMPLATES: InfoboxTemplate[] = [
  {
    id: 'builtin-character', name: 'Character', color: hue('Character'), builtin: true, items: [
      f('Epithet'), ref('Species', 'Species'), f('Gender'), num('Age'), ref('Homeland', 'Country'),
      sep('Allegiance'), f('Status'), ref('Affiliation', 'Organization'), f('Occupation'),
      sep('Life'), f('Born'), f('Died'),
    ],
  },
  {
    id: 'builtin-country', name: 'Country', color: hue('Country'), builtin: true, items: [
      ref('Capital', 'Settlement'), f('Government'), ref('Ruler', 'Character'),
      sep('People'), num('Population'), ref('Languages', 'Language'), ref('Religion', 'Religion'),
      sep('Economy'), f('Currency'), f('Formed'),
    ],
  },
  {
    id: 'builtin-deity', name: 'Deity', color: hue('Deity'), builtin: true, items: [
      f('Domain'), ref('Pantheon', 'Religion'), f('Symbol'), f('Gender'), f('Alignment'),
      sep('Worship'), ref('Worshippers', 'Culture'), f('Holy days'), f('Temples'),
    ],
  },
  {
    id: 'builtin-geography', name: 'Geography', color: hue('Geography'), builtin: true, items: [
      f('Type'), ref('Region', 'Geography'), f('Climate'), f('Area'),
      sep('Features'), f('Terrain'), f('Flora & fauna'), f('Notable for'),
    ],
  },
  {
    id: 'builtin-item', name: 'Item', color: hue('Item'), builtin: true, items: [
      f('Type'), ref('Material', 'Material'), f('Powers'),
      sep('Provenance'), f('Origin'), ref('Creator', 'Character'), ref('Owner', 'Character'),
    ],
  },
  {
    id: 'builtin-organization', name: 'Organization', color: hue('Organization'), builtin: true, items: [
      f('Type'), ref('Leader', 'Character'), ref('Headquarters', 'Settlement'), f('Founded'), num('Members'),
      sep('Relations'), ref('Allies', 'Organization'), ref('Rivals', 'Organization'),
    ],
  },
  {
    id: 'builtin-religion', name: 'Religion', color: hue('Religion'), builtin: true, items: [
      f('Type'), ref('Deities', 'Deity'), ref('Founder', 'Character'), f('Founded'),
      sep('Practice'), f('Followers'), f('Holy text'), f('Rituals'),
    ],
  },
  {
    id: 'builtin-species', name: 'Species', color: hue('Species'), builtin: true, items: [
      f('Classification'), ref('Native to', 'Geography'), f('Habitat'), f('Diet'), num('Lifespan'),
      sep('Traits'), f('Intelligence'), f('Size'), f('Distinctive features'),
    ],
  },
  {
    id: 'builtin-settlement', name: 'Settlement', color: hue('Settlement'), builtin: true, items: [
      f('Type'), ref('Country', 'Country'), ref('Region', 'Geography'), num('Population'),
      sep('Governance'), f('Government'), ref('Ruler', 'Character'),
      sep('History'), f('Founded'), f('Notable for'),
    ],
  },
  {
    id: 'builtin-condition', name: 'Condition', color: hue('Condition'), builtin: true, items: [
      f('Type'), f('Cause'), f('Transmission'),
      sep('Effects'), f('Symptoms'), f('Cure'), f('Notable cases'),
    ],
  },
  {
    id: 'builtin-conflict', name: 'Conflict', color: hue('Conflict'), builtin: true, items: [
      f('Type'), f('Date'), ref('Location', 'Geography'),
      sep('Sides'), ref('Belligerents', 'Organization'), ref('Commanders', 'Character'),
      sep('Result'), f('Outcome'), f('Casualties'),
    ],
  },
  {
    id: 'builtin-document', name: 'Document', color: hue('Document'), builtin: true, items: [
      f('Type'), ref('Author', 'Character'), ref('Language', 'Language'),
      sep('Details'), f('Date written'), f('Location'), f('Contents'),
    ],
  },
  {
    id: 'builtin-culture', name: 'Culture', color: hue('Culture'), builtin: true, items: [
      ref('Region', 'Geography'), f('People'), ref('Language', 'Language'), ref('Religion', 'Religion'),
      sep('Ways'), f('Values'), f('Customs'), f('Arts'),
    ],
  },
  {
    id: 'builtin-language', name: 'Language', color: hue('Language'), builtin: true, items: [
      f('Family'), ref('Spoken by', 'Culture'), ref('Region', 'Geography'), f('Writing system'), f('Status'),
    ],
  },
  {
    id: 'builtin-material', name: 'Material', color: hue('Material'), builtin: true, items: [
      f('Type'), ref('Source', 'Geography'), f('Properties'), f('Rarity'), f('Uses'),
    ],
  },
  {
    id: 'builtin-myth', name: 'Myth', color: hue('Myth'), builtin: true, items: [
      f('Type'), ref('Origin culture', 'Culture'), f('Figures'), f('Themes'), f('Related to'),
    ],
  },
  {
    id: 'builtin-technology', name: 'Technology', color: hue('Technology'), builtin: true, items: [
      f('Type'), ref('Inventor', 'Character'), f('Invented'),
      sep('Use'), f('Function'), f('Materials'), f('Users'),
    ],
  },
  {
    id: 'builtin-tradition', name: 'Tradition', color: hue('Tradition'), builtin: true, items: [
      f('Type'), ref('Culture', 'Culture'), f('Occasion'), f('Participants'), f('Origin'),
    ],
  },
  {
    id: 'builtin-spell', name: 'Spell', color: hue('Spell'), builtin: true, items: [
      f('School'), ref('Caster', 'Character'), f('Effect'),
      sep('Casting'), f('Components'), f('Range'), f('Duration'),
    ],
  },
]

/** Turn template rows into fresh infobox fields (new ids each time). */
function itemsToFields(items: TemplateItem[]): InfoboxField[] {
  return items.map((it) =>
    it.separator
      ? { id: crypto.randomUUID(), label: it.label, value: '', kind: 'separator' as const }
      : { id: crypto.randomUUID(), label: it.label, value: '', fieldType: it.fieldType ?? 'text', refType: it.refType },
  )
}

/** Reconcile the templates table with the shipped built-ins: add any that are
 *  missing, drop built-ins we no longer ship, and backfill a colour on older
 *  rows. Never touches a template you created or a colour/rows you edited on a
 *  still-shipped built-in. Call once on app start. */
export async function seedTemplates(): Promise<void> {
  // Run the whole read-modify-write inside one rw transaction so concurrent
  // invocations serialize. React StrictMode double-invokes the startup effect in
  // dev, calling this twice at once; without the transaction both reads see an
  // empty table and both bulkAdd the same built-ins, and the loser rejects with
  // a duplicate-key BulkError. Inside a transaction the second call runs only
  // after the first commits, finds the built-ins present, and becomes a no-op.
  await db.transaction('rw', db.templates, async () => {
    const current = await db.templates.toArray()
    const existing = new Set(current.map((t) => t.id))
    const shippedIds = new Set(BUILTIN_TEMPLATES.map((t) => t.id))

    const missing = BUILTIN_TEMPLATES.filter((t) => !existing.has(t.id))
    if (missing.length) await db.templates.bulkAdd(missing)

    // Remove built-ins that are no longer part of the shipped set (your own
    // custom types, builtin === false, are always left alone).
    const obsolete = current.filter((t) => t.builtin && !shippedIds.has(t.id))
    await Promise.all(obsolete.map((t) => db.templates.delete(t.id)))

    const builtinById = new Map(BUILTIN_TEMPLATES.map((t) => [t.id, t.color]))
    const needColor = current.filter((t) => !t.color && !obsolete.includes(t))
    await Promise.all(
      needColor.map((t) => db.templates.update(t.id, { color: builtinById.get(t.id) ?? '#a0a0a0' })),
    )

    // Backfill default icons onto built-ins that don't have one yet (never
    // overwrites a user's icon). Re-read so freshly-added built-ins are included.
    const afterSeed = await db.templates.toArray()
    const needIcon = afterSeed.filter((t) => t.builtin && !t.icon && BUILTIN_ICONS[t.name])
    await Promise.all(needIcon.map((t) => db.templates.update(t.id, { icon: BUILTIN_ICONS[t.name] })))

    const needSections = afterSeed.filter(
      (t) => t.builtin && t.sections === undefined && BUILTIN_SECTIONS[t.name],
    )
    await Promise.all(
      needSections.map((t) => db.templates.update(t.id, { sections: BUILTIN_SECTIONS[t.name] })),
    )

    // Backfill default sidebar groups the same way. `group: ''` means the user
    // deliberately ungrouped the type, so `=== undefined` (never set) is the
    // only state eligible for backfill.
    const needGroup = afterSeed.filter(
      (t) => t.builtin && t.group === undefined && BUILTIN_GROUPS[t.name],
    )
    await Promise.all(
      needGroup.map((t) => db.templates.update(t.id, { group: BUILTIN_GROUPS[t.name] })),
    )
  })
}

/** All templates, alphabetical by name. Falls back to the built-ins if the
 *  database hasn't been seeded yet. */
export async function getTemplates(): Promise<InfoboxTemplate[]> {
  const all = await db.templates.toArray()
  const list = all.length ? all : BUILTIN_TEMPLATES
  return [...list].sort((a, b) => a.name.localeCompare(b.name))
}

/** A fresh infobox seeded from the template whose name matches the category
 *  (falling back to the default type, then the first available). */
export async function defaultInfobox(category: string): Promise<Infobox> {
  const all = await getTemplates()
  const tpl = all.find((t) => t.name === category) ?? all.find((t) => t.name === DEFAULT_CATEGORY) ?? all[0]
  return {
    template: tpl?.name ?? category,
    image: null,
    caption: '',
    fields: tpl ? itemsToFields(tpl.items) : [],
  }
}

/** Keep a previously-entered value only if it still fits the field's new type.
 *  When a row switches to a 'ref' field, free text that holds no `[[links]]` is
 *  dropped (it would never render as a link); a 'number' field keeps the value
 *  only if it parses as a number. Text fields keep whatever was there. This
 *  stops a type change from stranding junk in a typed field. */
function carryValue(value: string | undefined, fieldType: FieldType): string {
  const v = value ?? ''
  if (!v.trim()) return ''
  if (fieldType === 'ref') return parseRefTitles(v).length ? v : ''
  if (fieldType === 'number') return /^-?\d+(\.\d+)?$/.test(v.trim()) ? v.trim() : ''
  return v
}

/** Switch an infobox to a template: its rows become exactly the template's
 *  rows (replacing whatever was there before), but any value the user already
 *  filled in for a field with a matching label is carried over (when it still
 *  fits the field's type — see carryValue). The image and caption are kept. */
export function applyTemplate(box: Infobox, tpl: InfoboxTemplate): Infobox {
  const byLabel = new Map(
    box.fields.filter((fld) => fld.kind !== 'separator').map((fld) => [fld.label.toLowerCase(), fld]),
  )
  const fields: InfoboxField[] = tpl.items.map((it) => {
    if (it.separator) return { id: crypto.randomUUID(), label: it.label, value: '', kind: 'separator' as const }
    const existing = byLabel.get(it.label.toLowerCase())
    const fieldType = it.fieldType ?? 'text'
    return {
      id: existing?.id ?? crypto.randomUUID(),
      label: it.label,
      value: carryValue(existing?.value, fieldType),
      fieldType,
      refType: it.refType,
    }
  })
  return { ...box, template: tpl.name, fields }
}

/** Parse a ref field's value ("[[A]] [[B]]") into an ordered list of titles. */
export function parseRefTitles(value: string): string[] {
  const out: string[] = []
  for (const m of value.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const t = m[1].trim()
    if (t) out.push(t)
  }
  return out
}

/** Serialise a list of titles back into a ref field value ("[[A]] [[B]]"). */
export function serializeRefTitles(titles: string[]): string {
  return titles.map((t) => t.trim()).filter(Boolean).map((t) => `[[${t}]]`).join(' ')
}

// -- template CRUD (used by the Templates screen) ---------------------------

export async function createTemplate(name: string, color: string = '#a0a0a0'): Promise<string> {
  const id = crypto.randomUUID()
  await db.templates.add({ id, name: name.trim() || 'New template', color, items: [], builtin: false })
  return id
}

export async function updateTemplate(id: string, changes: Partial<InfoboxTemplate>): Promise<void> {
  await db.templates.update(id, changes)
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id)
}

/** Restore a built-in template's rows to their shipped defaults. */
export async function resetTemplate(id: string): Promise<void> {
  const original = BUILTIN_TEMPLATES.find((t) => t.id === id)
  if (original) {
    await db.templates.put({
      ...original,
      icon: BUILTIN_ICONS[original.name],
      sections: BUILTIN_SECTIONS[original.name] ?? [],
      group: BUILTIN_GROUPS[original.name],
    })
  }
}

/** Pages whose infobox was built from the template of this name. */
export async function pagesUsingTemplate(name: string): Promise<LorePage[]> {
  const pages = await db.pages.toArray()
  return pages.filter((p) => p.infobox?.template === name)
}

/** Re-apply a template's current rows to every page using it, preserving any
 *  values already entered. Returns how many pages were updated. */
export async function applyTemplateToPages(tpl: InfoboxTemplate): Promise<number> {
  const targets = await pagesUsingTemplate(tpl.name)
  await Promise.all(
    targets.map((p) => db.pages.update(p.id, { infobox: applyTemplate(p.infobox!, tpl), updatedAt: now() })),
  )
  return targets.length
}
