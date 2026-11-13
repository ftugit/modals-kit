import { describe, expect, test, vi } from 'vitest'
import { load } from './+page.server.js'

const mock = vi.hoisted(() => ({ listSessionsPage: vi.fn(), enabled: true }))
vi.mock('#content/user/gateway.server.js', () => ({
  auth: () => ({ enabled: mock.enabled, listSessionsPage: mock.listSessionsPage }),
}))

const UID = '11111111-1111-4111-8111-111111111111'
function event(url: string) {
  return { url: new URL(url), setHeaders: vi.fn() } as never
}
function ok() {
  mock.listSessionsPage.mockResolvedValue({ ok: true, value: { canSeeDeleted: true, countries: ['RU'] } })
}

describe('load страницы фильтров сессий: цель — параметр пары, не from', () => {
  test('journal=1 фильтрует журнал поверх любого носителя', async () => {
    ok()
    await load(event(`http://localhost/user/sessions/filters?from=%2Fusers&journal=1`))
    expect(mock.listSessionsPage).toHaveBeenCalledWith(expect.objectContaining({ authId: null, journal: true }))
  })

  test('uid фильтрует аккаунт, даже если from указывает на журнал', async () => {
    ok()
    await load(event(`http://localhost/user/sessions/filters?from=%2Fsessions&uid=${UID}`))
    expect(mock.listSessionsPage).toHaveBeenCalledWith(expect.objectContaining({ authId: UID, journal: false }))
  })

  test('без параметров — свои устройства; from не разбирается как цель', async () => {
    ok()
    await load(event(`http://localhost/user/sessions/filters?from=%2Fuser%2F${UID}%2Fsessions`))
    expect(mock.listSessionsPage).toHaveBeenCalledWith(expect.objectContaining({ authId: null, journal: false }))
  })

  test('отказ домена виден как fact, а не молчаливый пустой срез', async () => {
    mock.listSessionsPage.mockResolvedValue({ ok: false, fact: { code: 'auth.forbidden' } })
    const data = (await load(event('http://localhost/user/sessions/filters?journal=1'))) as import('./+page.server.js').SessionsFiltersPageData
    expect(data.fact).toBe('auth.forbidden')
    expect(data.countries).toEqual([])
  })
})
