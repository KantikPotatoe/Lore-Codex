import { describe, it, expect, beforeEach } from 'vitest'
import {
  db,
  applyTemplate,
  parseRefTitles,
  serializeRefTitles,
  seedTemplates,
  resetTemplate,
  BUILTIN_TEMPLATES,
  BUILTIN_ICONS,
  BUILTIN_SECTIONS,
  BUILTIN_GROUPS,
  type Infobox,
  type InfoboxTemplate,
} from '../db'

// templates.ts holds the page-type logic: applyTemplate (a value-preserving row
// swap, pure) and seedTemplates (DB-backed reconciliation of the shipped
// built-ins on startup). The pure tests need no DB; the seed tests run against a
// cleared in-memory templates table.

describe('parseRefTitles / serializeRefTitles', () => {
  it('parses [[tokens]] into an ordered title list, trimming each', () => {
    expect(parseRefTitles('[[ A ]] text [[B]]')).toEqual(['A', 'B'])
  })

  it('round-trips a title list', () => {
    const titles = ['Frodo', 'Sam']
    expect(parseRefTitles(serializeRefTitles(titles))).toEqual(titles)
  })

  it('serialize drops blank entries', () => {
    expect(serializeRefTitles(['A', '  ', 'B'])).toBe('[[A]] [[B]]')
  })
})

describe('applyTemplate', () => {
  const tpl: InfoboxTemplate = {
    id: 't',
    name: 'Hero',
    color: '#fff',
    builtin: false,
    items: [
      { label: 'Section', separator: true },
      { label: 'Age', fieldType: 'number' },
      { label: 'Ally', fieldType: 'ref', refType: 'Character' },
      { label: 'Bio' }, // text
    ],
  }

  function box(fields: Infobox['fields']): Infobox {
    return { template: 'Old', image: 'data:image/png;base64,X', caption: 'cap', fields }
  }

  it('replaces rows with exactly the template rows and keeps image/caption', () => {
    const out = applyTemplate(box([]), tpl)
    expect(out.template).toBe('Hero')
    expect(out.image).toBe('data:image/png;base64,X')
    expect(out.caption).toBe('cap')
    expect(out.fields.map((f) => f.label)).toEqual(['Section', 'Age', 'Ally', 'Bio'])
    expect(out.fields[0].kind).toBe('separator')
  })

  it('carries a matching-label value over (text field), case-insensitive', () => {
    const out = applyTemplate(
      box([{ id: 'old', label: 'bio', value: 'A wandering ranger.' }]),
      tpl,
    )
    const bio = out.fields.find((f) => f.label === 'Bio')!
    expect(bio.value).toBe('A wandering ranger.')
    expect(bio.id).toBe('old') // existing field id reused
  })

  it('drops a number value that does not parse as a number', () => {
    const keep = applyTemplate(box([{ id: '1', label: 'Age', value: '42' }]), tpl)
    const drop = applyTemplate(box([{ id: '2', label: 'Age', value: 'old' }]), tpl)
    expect(keep.fields.find((f) => f.label === 'Age')!.value).toBe('42')
    expect(drop.fields.find((f) => f.label === 'Age')!.value).toBe('')
  })

  it('drops ref text that holds no [[links]]', () => {
    const keep = applyTemplate(box([{ id: '1', label: 'Ally', value: '[[Sam]]' }]), tpl)
    const drop = applyTemplate(box([{ id: '2', label: 'Ally', value: 'just Sam' }]), tpl)
    expect(keep.fields.find((f) => f.label === 'Ally')!.value).toBe('[[Sam]]')
    expect(drop.fields.find((f) => f.label === 'Ally')!.value).toBe('')
  })
})

describe('seedTemplates', () => {
  beforeEach(async () => {
    await db.templates.clear()
  })

  it('adds every missing built-in', async () => {
    await seedTemplates()
    const ids = new Set((await db.templates.toArray()).map((t) => t.id))
    expect(BUILTIN_TEMPLATES.every((t) => ids.has(t.id))).toBe(true)
  })

  it('removes obsolete built-ins (a builtin id we no longer ship)', async () => {
    await db.templates.add({ id: 'builtin-gone', name: 'Gone', color: '#000', items: [], builtin: true })
    await seedTemplates()
    expect(await db.templates.get('builtin-gone')).toBeUndefined()
  })

  it('leaves custom (builtin:false) templates alone', async () => {
    await db.templates.add({ id: 'custom-1', name: 'Mine', color: '#123', items: [], builtin: false })
    await seedTemplates()
    expect(await db.templates.get('custom-1')).toBeDefined()
  })

  it('backfills a missing colour on a shipped built-in without overwriting set ones', async () => {
    const shipped = BUILTIN_TEMPLATES[0]
    await db.templates.add({ ...shipped, color: '' })
    await seedTemplates()
    expect((await db.templates.get(shipped.id))!.color).toBe(shipped.color)
  })

  it('backfills a default icon but never overwrites a user icon', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => BUILTIN_ICONS[t.name])!
    await db.templates.add({ ...a, icon: undefined })
    const b = BUILTIN_TEMPLATES.find((t) => t.id !== a.id && BUILTIN_ICONS[t.name])!
    await db.templates.add({ ...b, icon: '🎯' })

    await seedTemplates()

    expect((await db.templates.get(a.id))!.icon).toBe(BUILTIN_ICONS[a.name])
    expect((await db.templates.get(b.id))!.icon).toBe('🎯')
  })

  // React StrictMode invokes the startup effect twice in dev, so seedTemplates()
  // can run concurrently against a fresh DB. The read-then-bulkAdd must not race
  // into a duplicate-key BulkError, and must not create duplicate rows.
  it('is safe under concurrent invocation (no BulkError, no duplicates)', async () => {
    await Promise.all([seedTemplates(), seedTemplates()])
    const all = await db.templates.toArray()
    const ids = all.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length) // no duplicate rows
    expect(all.length).toBe(BUILTIN_TEMPLATES.length) // exactly the built-ins, once
  })

  it('backfills default sections on a built-in that has none, leaving a cleared [] alone', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => BUILTIN_SECTIONS[t.name])!
    await db.templates.add({ ...a, sections: undefined })
    const b = BUILTIN_TEMPLATES.find((t) => t.id !== a.id && BUILTIN_SECTIONS[t.name])!
    await db.templates.add({ ...b, sections: [] }) // user deliberately cleared

    await seedTemplates()

    expect((await db.templates.get(a.id))!.sections).toEqual(BUILTIN_SECTIONS[a.name])
    expect((await db.templates.get(b.id))!.sections).toEqual([]) // untouched
  })

  it('backfills a default group on a built-in that has none, leaving a cleared one alone', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => t.name === 'Settlement')!
    await db.templates.add({ ...a, group: undefined })
    const b = BUILTIN_TEMPLATES.find((t) => t.name === 'Spell')!
    await db.templates.add({ ...b, group: '' }) // user deliberately ungrouped

    await seedTemplates()

    expect((await db.templates.get(a.id))!.group).toBe(BUILTIN_GROUPS[a.name])
    expect((await db.templates.get(b.id))!.group).toBe('')
  })

  it('never assigns a group to a custom type', async () => {
    await db.templates.add({
      id: 'custom-1', name: 'Heraldry', color: '#abc', builtin: false, items: [],
    })

    await seedTemplates()

    expect((await db.templates.get('custom-1'))!.group).toBeUndefined()
  })

  it('assigns a group to every shipped built-in', async () => {
    await seedTemplates()

    const all = await db.templates.toArray()
    const builtins = all.filter((t) => t.builtin)
    expect(builtins.length).toBe(BUILTIN_TEMPLATES.length)
    for (const t of builtins) {
      expect(t.group, `${t.name} has no group`).toBeTruthy()
    }
  })

  it('does not use a group name that collides with a type name', () => {
    const typeNames = new Set(BUILTIN_TEMPLATES.map((t) => t.name))
    for (const group of new Set(Object.values(BUILTIN_GROUPS))) {
      expect(typeNames.has(group), `group "${group}" collides with a type name`).toBe(false)
    }
  })

  it('resetTemplate restores the shipped sections', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => BUILTIN_SECTIONS[t.name])!
    await db.templates.add({ ...a, sections: ['Junk'] })
    await resetTemplate(a.id)
    expect((await db.templates.get(a.id))!.sections).toEqual(BUILTIN_SECTIONS[a.name])
  })

  it('resetTemplate restores the shipped group', async () => {
    const a = BUILTIN_TEMPLATES.find((t) => t.name === 'Settlement')!
    await db.templates.add({ ...a, group: '' }) // user deliberately ungrouped
    await resetTemplate(a.id)
    expect((await db.templates.get(a.id))!.group).toBe(BUILTIN_GROUPS[a.name])
  })
})

describe('BUILTIN_TEMPLATES structure', () => {
  const typeNames = new Set(BUILTIN_TEMPLATES.map((t) => t.name))

  it('ships exactly the 19 expected built-in types, in order, with stable ids', () => {
    const expected = [
      ['builtin-character', 'Character'], ['builtin-country', 'Country'],
      ['builtin-deity', 'Deity'], ['builtin-geography', 'Geography'],
      ['builtin-item', 'Item'], ['builtin-organization', 'Organization'],
      ['builtin-religion', 'Religion'], ['builtin-species', 'Species'],
      ['builtin-settlement', 'Settlement'], ['builtin-condition', 'Condition'],
      ['builtin-conflict', 'Conflict'], ['builtin-document', 'Document'],
      ['builtin-culture', 'Culture'], ['builtin-language', 'Language'],
      ['builtin-material', 'Material'], ['builtin-myth', 'Myth'],
      ['builtin-technology', 'Technology'], ['builtin-tradition', 'Tradition'],
      ['builtin-spell', 'Spell'],
    ]
    expect(BUILTIN_TEMPLATES.map((t) => [t.id, t.name])).toEqual(expected)
    expect(BUILTIN_TEMPLATES.every((t) => t.builtin === true)).toBe(true)
  })

  it('every ref row targets an existing built-in type name', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const item of t.items) {
        if (!item.separator && item.fieldType === 'ref') {
          expect(item.refType, `${t.name} → ${item.label}`).toBeTruthy()
          expect(
            typeNames.has(item.refType as string),
            `${t.name} → ${item.label} (refType "${item.refType}")`,
          ).toBe(true)
        }
      }
    }
  })

  it('groups by length: ≥6 field rows ⇒ has a separator; ≤5 ⇒ none', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const fieldCount = t.items.filter((it) => !it.separator).length
      const hasSep = t.items.some((it) => it.separator)
      if (fieldCount >= 6) {
        expect(hasSep, `${t.name} has ${fieldCount} fields but no separator`).toBe(true)
      } else {
        expect(hasSep, `${t.name} has ${fieldCount} fields but a separator`).toBe(false)
      }
    }
  })

  it('every non-separator row has a non-empty label', () => {
    for (const t of BUILTIN_TEMPLATES) {
      for (const item of t.items) {
        if (!item.separator) {
          expect(item.label.trim().length, `${t.name}`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('BUILTIN_SECTIONS structure', () => {
  const typeNames = new Set(BUILTIN_TEMPLATES.map((t) => t.name))

  it('keys are all shipped built-in type names', () => {
    for (const name of Object.keys(BUILTIN_SECTIONS)) {
      expect(typeNames.has(name), `unknown type "${name}"`).toBe(true)
    }
  })

  it('every section name is non-empty and unique within its type', () => {
    for (const [name, secs] of Object.entries(BUILTIN_SECTIONS)) {
      expect(secs.length, `${name} has no sections`).toBeGreaterThan(0)
      for (const s of secs) expect(s.trim().length, `${name}`).toBeGreaterThan(0)
      expect(new Set(secs).size, `${name} has duplicate sections`).toBe(secs.length)
    }
  })
})
