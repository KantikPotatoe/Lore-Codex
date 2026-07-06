import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import TabSyncOverlay from './TabSyncOverlay'
import { handleIncoming, clearTabSync } from '../tabSync'

afterEach(() => { cleanup(); clearTabSync() })

describe('TabSyncOverlay', () => {
  it('renders nothing when no world change has occurred', () => {
    render(<TabSyncOverlay />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('freezes with a reload prompt when another tab imports the bound world', () => {
    render(<TabSyncOverlay />)
    act(() => handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'import' }, 'w1'))
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(screen.getByText(/replaced by an import/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
  })
})
