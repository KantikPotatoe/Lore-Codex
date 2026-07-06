import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./tabSync', () => ({ broadcastWorldChange: vi.fn() }))

import { broadcastWorldChange } from './tabSync'
import { deleteLore, registerLore } from './lores'

beforeEach(() => vi.mocked(broadcastWorldChange).mockClear())

describe('deleteLore broadcasts a world change', () => {
  it('announces a delete for the removed lore id', async () => {
    const id = await registerLore('Doomed World')
    await deleteLore(id)
    expect(broadcastWorldChange).toHaveBeenCalledWith(id, 'delete')
  })
})
