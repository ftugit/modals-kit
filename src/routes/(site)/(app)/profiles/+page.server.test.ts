import { describe, expect, test, vi } from 'vitest'
import { load } from './+page.server.js'

const mock = vi.hoisted(() => ({ listProfiles: vi.fn(), enabled: true }))
vi.mock('#content/user/gateway.server.js', () => ({
  auth: () => ({ enabled: mock.enabled, listProfiles: mock.listProfiles }),
}))

function event(url: string) {
  return { url: new URL(url), setHeaders: vi.fn() } as never
}

function ok(total = 3) {
  mock.listProfiles.mockResolvedValue({
    ok: true,
    value: {
      items: [{ id: 'a1', nickname: 'nick', avatarUrl: null, createdAt: 1000 }],
      total,
      page: 1,
      pageSize: 30,
    },
  })
}

describe('load /profiles', () => {
  test('вызывает listProfiles с page/pageSize/search из адреса', async () => {
    ok()
    await load(event('http://localhost/profiles?profiles=2&profiles.size=50&profiles.q=foo'))
    expect(mock.listProfiles).toHaveBeenCalledWith({ page: 2, pageSize: 50, search: 'foo' })
  })

  test.each([
    ['31', 30],
    ['51', 50],
    ['101', 100],
    ['0', 30],
    ['мусор', 30],
  ])('profiles.size=%s нормализуется в %i', async (raw, expected) => {
    ok()
    await load(event(`http://localhost/profiles?profiles.size=${encodeURIComponent(raw)}`))
    expect(mock.listProfiles).toHaveBeenCalledWith({ page: 1, pageSize: expected, search: undefined })
  })

  test('без параметров — defaults', async () => {
    ok()
    await load(event('http://localhost/profiles'))
    expect(mock.listProfiles).toHaveBeenCalledWith({ page: 1, pageSize: 30, search: undefined })
  })

  test('отказ домена виден как fact', async () => {
    mock.listProfiles.mockResolvedValue({ ok: false, fact: { code: 'auth.forbidden' } })
    const data = (await load(event('http://localhost/profiles'))) as { fact: string | null; snapshot: unknown }
    expect(data.fact).toBe('auth.forbidden')
    expect(data.snapshot).toBeNull()
  })

  test('успех — snapshot не null', async () => {
    ok(5)
    const data = (await load(event('http://localhost/profiles'))) as { fact: string | null; snapshot: unknown }
    expect(data.fact).toBeNull()
    expect(data.snapshot).not.toBeNull()
  })
})