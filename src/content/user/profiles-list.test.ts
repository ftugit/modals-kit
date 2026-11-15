import { describe, expect, test, vi } from 'vitest'
import { listProfiles } from './profile.js'
import type { AuthPorts } from './ports.js'

function portsWithListPage() {
  const listPage = vi.fn(async (_ctx: unknown, _args: { pageSize: number }) => ({
    rows: [{ id: 'auth-1', nickname: 'Алиса', avatarUrl: null, createdAt: 1_000 }],
    total: 1,
  }))
  const ports = { profiles: { listPage } } as unknown as AuthPorts
  return { ports, listPage }
}

describe('listProfiles: публичная проекция', () => {
  test('гостю уходит только id/nickname/avatarUrl/createdAt', async () => {
    const { ports } = portsWithListPage()
    const r = await listProfiles(ports, undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.items).toEqual([
      { id: 'auth-1', nickname: 'Алиса', avatarUrl: null, createdAt: 1_000 },
    ])
    expect(JSON.stringify(r.value)).not.toContain('updatedAt')
    expect(JSON.stringify(r.value)).not.toContain('authId')
  })

  test('pageSize вне диапазона зажимается: 0 → default 30, 101 → 100', async () => {
    const { ports, listPage } = portsWithListPage()
    await listProfiles(ports, undefined, { pageSize: 0 })
    await listProfiles(ports, undefined, { pageSize: 101 })
    expect(listPage.mock.calls[0]?.[1]).toMatchObject({ pageSize: 30 })
    expect(listPage.mock.calls[1]?.[1]).toMatchObject({ pageSize: 100 })
  })
})
