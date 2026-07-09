import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
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

  it('reloads to the selector (#/) when a delete freezes the tab', () => {
    const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => {})
    window.location.hash = '#/home'
    render(<TabSyncOverlay />)
    act(() => handleIncoming({ type: 'world-changed', loreId: 'w1', reason: 'delete' }, 'w1'))
    expect(screen.getByText(/deleted in another tab/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(window.location.hash).toBe('#/')
    expect(reload).toHaveBeenCalledOnce()
    reload.mockRestore()
  })
})
