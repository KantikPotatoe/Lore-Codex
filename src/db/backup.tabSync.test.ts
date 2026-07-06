import { describe, it, expect, vi, beforeEach } from 'vitest'

// Assert the destructive ops announce themselves to other tabs. We mock tabSync
// so the test observes the broadcast call without needing a real channel.
vi.mock('../tabSync', () => ({
  broadcastWorldChange: vi.fn(),
}))

import { broadcastWorldChange } from '../tabSync'
import { importAll } from '../db'
import { activeLoreId } from '../db'

beforeEach(() => {
  vi.mocked(broadcastWorldChange).mockClear()
})

describe('importAll broadcasts a world change', () => {
  it('announces an import for the active lore', async () => {
    await importAll(JSON.stringify({ pages: [] }))
    expect(broadcastWorldChange).toHaveBeenCalledWith(activeLoreId, 'import')
  })
})
