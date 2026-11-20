import { describe, expect, test, vi } from 'vitest'
import { loadSessionsRouteData } from './load.server.js'
import type { SessionsPage } from '#modules/user/base/model/types.js'

// P1-1: объявление после действия разбирается из query редиректа. Числа
// частичного набора валидируются; расхождение показывается только при
// `requested > revoked` — подделанный адрес не рисует объявление.
const mock = vi.hoisted(() => ({ listSessionsPage: vi.fn(), enabled: true }))
vi.mock('#modules/user/base/service/gateway.server.js', () => ({
  auth: () => ({ enabled: mock.enabled, listSessionsPage: mock.listSessionsPage }),
}))

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

function event(url: string, formResult?: unknown) {
  return { url: new URL(url), locals: { formResult }, setHeaders: vi.fn() } as never
}

describe('load списка сессий: объявление из результата формы', () => {
  test('частичный набор из formResult — объявление с числами', async () => {
    ok()
    const data = await loadSessionsRouteData(
      event('http://localhost/user/sessions', { ok: true, data: { requested: 5, revoked: 3 } }),
      null,
    )
    expect(data.notice).toEqual({ kind: 'bulk-exit-partial', requested: 5, revoked: 3 })
  })

  test('requested <= revoked — объявления нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions', { ok: true, data: { requested: 3, revoked: 5 } }), null)
    expect(data.notice).toBeNull()
  })

  test('равные числа — расхождения нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions', { ok: true, data: { requested: 4, revoked: 4 } }), null)
    expect(data.notice).toBeNull()
  })

  test('без formResult — объявления нет', async () => {
    ok()
    const data = await loadSessionsRouteData(event('http://localhost/user/sessions'), null)
    expect(data.notice).toBeNull()
  })

  test('query ?notice= больше не читается', async () => {
    ok()
    const data = await loadSessionsRouteData(
      event('http://localhost/user/sessions?notice=bulk-exit-partial&requested=5&revoked=3'),
      null,
    )
    expect(data.notice).toBeNull()
  })

  test('объявление видно и при отказе входа (disabled)', async () => {
    mock.enabled = false
    const data = await loadSessionsRouteData(
      event('http://localhost/user/sessions', { ok: true, data: { requested: 4, revoked: 1 } }),
      null,
    )
    expect(data.fact).toBe('auth.disabled')
    expect(data.notice).toEqual({ kind: 'bulk-exit-partial', requested: 4, revoked: 1 })
  })
})
