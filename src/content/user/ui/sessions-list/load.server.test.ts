import { describe, expect, test, vi } from 'vitest'
import { loadSessionsRouteData } from './load.server.js'
import type { SessionsPage } from '../../types.js'

// P1-1: объявление после действия разбирается из query редиректа. Числа
// частичного набора валидируются; расхождение показывается только при
// `requested > revoked` — подделанный адрес не рисует объявление.
const mock = vi.hoisted(() => ({ listSessionsPage: vi.fn(), enabled: true }))
vi.mock('../../gateway.server.js', () => ({
  auth: () => ({ enabled: mock.enabled, listSessionsPage: mock.listSessionsPage }),
}))

function event(url: string) {
  return { url: new URL(url), setHeaders: vi.fn() } as never
}

const page: SessionsPage = {
  items: [],
  total: 0,
  page: 1,
  pageSize: 30,
  authId: null,
  journal: false,
  canReadOthers: false,
  state: 'active',
  countries: ['RU'],
  canSeeDeleted: false,
  canRename: true,
  canRevoke: true,
  canHardDelete: false,
}

function ok() {
  mock.enabled = true
  mock.listSessionsPage.mockResolvedValue({ ok: true, value: page })
}

describe('load списка сессий: объявление из query редиректа', () => {
  test('bulk-exit-partial с requested > revoked — объявление с числами', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions?notice=bulk-exit-partial&requested=5&revoked=3'), null)
    expect(data.notice).toEqual({ kind: 'bulk-exit-partial', requested: 5, revoked: 3 })
  })

  test('подделанный адрес requested <= revoked — объявления нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions?notice=bulk-exit-partial&requested=3&revoked=5'), null)
    expect(data.notice).toBeNull()
  })

  test('равные числа — расхождения нет, объявления нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions?notice=bulk-exit-partial&requested=4&revoked=4'), null)
    expect(data.notice).toBeNull()
  })

  test('revoke-failed — объявление сбоя', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions?notice=revoke-failed'), null)
    expect(data.notice).toEqual({ kind: 'revoke-failed' })
  })

  test('без notice — объявления нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions'), null)
    expect(data.notice).toBeNull()
  })

  test('объявление разбирается и на отказе входа (disabled)', async () => {
    mock.enabled = false
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions?notice=bulk-exit-partial&requested=4&revoked=1'), null)
    expect(data.fact).toBe('auth.disabled')
    expect(data.notice).toEqual({ kind: 'bulk-exit-partial', requested: 4, revoked: 1 })
  })
})
