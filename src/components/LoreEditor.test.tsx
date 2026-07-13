import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { registry } from '../registryDb'
import { APP_SETTINGS_KEY } from '../appSettings'
import LoreEditor from './LoreEditor'

afterEach(cleanup)
beforeEach(async () => { await registry.appMeta.clear() })

function renderEditor() {
  return render(
    <MemoryRouter>
      <LoreEditor content="<p>hello</p>" editable onChange={() => {}} onWikiClick={() => {}} />
    </MemoryRouter>,
  )
}

describe('LoreEditor spellcheck', () => {
  it('spellchecks by default', async () => {
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('spellcheck')).toBe('true')
    })
  })

  it('turns spellcheck off when the app setting is off', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheck: false } })
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('spellcheck')).toBe('false')
    })
  })

  it('sets the dictionary language when one is chosen', async () => {
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: 'fr' } })
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('lang')).toBe('fr')
    })
  })

  it('leaves the language to the OS when set to system default', async () => {
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')).toBeTruthy()
    })
    expect(container.querySelector('.ProseMirror')?.hasAttribute('lang')).toBe(false)
  })

  it('removes the language when a mounted editor is switched back to system default', async () => {
    // Settings are reactive (useLiveQuery), so a user switching a *mounted*
    // editor from a chosen dictionary back to "System default" must see the
    // `lang` attribute disappear live, not just on a fresh mount.
    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: 'fr' } })
    const { container } = renderEditor()
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.getAttribute('lang')).toBe('fr')
    })

    await registry.appMeta.put({ key: APP_SETTINGS_KEY, value: { spellcheckLang: '' } })
    await waitFor(() => {
      expect(container.querySelector('.ProseMirror')?.hasAttribute('lang')).toBe(false)
    })
  })
})
