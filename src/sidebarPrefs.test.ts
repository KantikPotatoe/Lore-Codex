import { beforeEach, describe, expect, it } from 'vitest'
import { getCollapsedGroups, toggleCollapsedGroup, groupCollapseKey, RECENT_GROUP } from './sidebarPrefs'

const L = 'test-lore'

beforeEach(() => localStorage.clear())

describe('sidebarPrefs', () => {
  it('defaults to all-open (empty)', () => {
    expect(getCollapsedGroups(L)).toEqual([])
  })

  it('toggles a group collapsed then open', () => {
    expect(toggleCollapsedGroup('Characters', L)).toEqual(['Characters'])
    expect(getCollapsedGroups(L)).toEqual(['Characters'])
    expect(toggleCollapsedGroup('Characters', L)).toEqual([])
    expect(getCollapsedGroups(L)).toEqual([])
  })

  it('is scoped per world', () => {
    toggleCollapsedGroup('Places', 'world-1')
    expect(getCollapsedGroups('world-1')).toEqual(['Places'])
    expect(getCollapsedGroups('world-2')).toEqual([])
  })

  it('supports the reserved recent-section name', () => {
    toggleCollapsedGroup(RECENT_GROUP, L)
    expect(getCollapsedGroups(L)).toEqual(['__recent__'])
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('lore:test-lore:collapsedGroups', 'nope')
    expect(getCollapsedGroups(L)).toEqual([])
  })

  it('namespaces group collapse keys so a group and a type of the same name differ', () => {
    expect(groupCollapseKey('Places')).toBe('group:Places')
    expect(groupCollapseKey('Places')).not.toBe('Places')
  })
})
