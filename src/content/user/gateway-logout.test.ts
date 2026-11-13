/**
 * Выход на уровне гейтвея: куки снимает он, а не маршрут.
 *
 * Домен здесь подменён: проверяется не работа с базой, а то, **когда** именно
 * снимаются куки. Это и есть контракт: при недоступном хранилище домен бросает
 * (`sessions.server.ts`, `revokeSessionById` не возвращает факт), и куки
 * обязаны остаться — иначе пользователь «вышел» на клиенте, а сессия жива.
 */
import { describe, expect, test, vi } from 'vitest'
import type { Cookies } from '@sveltejs/kit'
import { ACCESS_COOKIE, RENEWAL_COOKIE, auth, type AuthEvent } from './gateway.server.js'

// `vi.mock` поднимается наверх файла, поэтому шпион и константа стража
// заводятся через `vi.hoisted` — иначе фабрика мока их не видит.
const { GUARD, revokeSessionById, revokeBulkSessions } = vi.hoisted(() => ({
  GUARD: {
    sub: '11111111-1111-4111-8111-111111111111',
    jti: 'gw-test-jti-021',
    sessionId: '22222222-2222-4222-8222-222222222222',
    prof: { nickname: null, avatarUrl: null },
    perms: [] as readonly string[],
  },
  revokeSessionById: vi.fn(async () => {
    throw new Error('хранилище недоступно')
  }),
  revokeBulkSessions: vi.fn(),
}))

// Подмена домена: `logout` должен дойти до отзыва и получить бросок, а не факт.
vi.mock('./sessions.server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sessions.server.js')>()
  return { ...actual, revokeSessionById, revokeBulkSessions }
})

// Живой `access` в куке подделать дорого (нужен секрет и строка в базе), поэтому
// страж подменён: здесь проверяется порядок снятия кук, а не разбор токена.
vi.mock('./auth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth.js')>()
  return { ...actual, guard: async () => GUARD }
})

function fakeEvent(opts: { renewal?: boolean } = {}): {
  event: AuthEvent
  jar: Map<string, string>
  deleted: string[]
} {
  const jar = new Map<string, string>([[ACCESS_COOKIE, 'access-token']])
  // Кука продления по умолчанию есть; для набора её убираем, чтобы
  // `freshAccessOrCurrent` не уходил в ротацию (домен всё равно подменён).
  if (opts.renewal !== false) jar.set(RENEWAL_COOKIE, 'renewal-token')
  const deleted: string[] = []
  const cookies = {
    get: (name: string) => jar.get(name),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => {
      deleted.push(name)
      jar.delete(name)
    },
    serialize: () => '',
  } as unknown as Cookies
  return { event: { request: new Request('http://local.test/'), cookies } as AuthEvent, jar, deleted }
}

test('logoutLocal снимает обе куки и не трогает хранилище', async () => {
  const { event, jar } = fakeEvent()
  revokeSessionById.mockClear()

  const r = await auth(event).logoutLocal()

  expect(r).toEqual({ ok: true, value: null })
  expect(jar.has(ACCESS_COOKIE)).toBe(false)
  expect(jar.has(RENEWAL_COOKIE)).toBe(false)
  expect(revokeSessionById).not.toHaveBeenCalled()
})

test('при броске домена выход отвергается, а куки остаются', async () => {
  const { event, jar } = fakeEvent()
  revokeSessionById.mockClear()

  await expect(auth(event).logout()).rejects.toThrow('хранилище недоступно')

  // Негативный контроль: сними гейтвей куки до отзыва — пользователь «вышел»,
  // а строка сессии жива. Именно это и лечит `logoutLocal`.
  expect(jar.get(ACCESS_COOKIE)).toBe('access-token')
  expect(jar.get(RENEWAL_COOKIE)).toBe('renewal-token')
  expect(revokeSessionById).toHaveBeenCalledTimes(1)
})

// R4 (P1-9): куки снимает гейтвей и только когда среди закрытых есть текущая
// сессия зрителя. Набор чужого аккаунта (`uid`/`authId`) текущую не задевает —
// `current:false`, куки обязаны остаться. Шпион — счётчик `cookies.delete`.
describe('revokeBulkSessions: куки снимает только текущая сессия (R4)', () => {
  test('чужой набор (uid, current:false) — куки не сняты, delete не вызван', async () => {
    const { event, jar, deleted } = fakeEvent({ renewal: false })
    revokeBulkSessions.mockResolvedValueOnce({ ok: true, value: { revoked: 2, current: false, requested: 2 } })

    const r = await auth(event).revokeBulkSessions({ authId: '33333333-3333-4333-8333-333333333333', where: { state: 'active' } })

    expect(r.ok).toBe(true)
    expect(jar.get(ACCESS_COOKIE)).toBe('access-token')
    expect(deleted).toEqual([])
  })

  test('своя текущая закрыта (current:true) — обе куки сняты', async () => {
    const { event, jar, deleted } = fakeEvent({ renewal: false })
    revokeBulkSessions.mockResolvedValueOnce({ ok: true, value: { revoked: 1, current: true, requested: 1 } })

    const r = await auth(event).revokeBulkSessions({ where: { state: 'all' }, includeCurrent: true })

    expect(r.ok).toBe(true)
    expect(jar.has(ACCESS_COOKIE)).toBe(false)
    expect(deleted).toContain(ACCESS_COOKIE)
    expect(deleted).toContain(RENEWAL_COOKIE)
  })

  test('отказ домена (пустой набор) — куки не сняты', async () => {
    const { event, jar, deleted } = fakeEvent({ renewal: false })
    revokeBulkSessions.mockResolvedValueOnce({ ok: false, fact: { code: 'session.nothing-to-close' } })

    const r = await auth(event).revokeBulkSessions({ where: { state: 'active' } })

    expect(r.ok).toBe(false)
    expect(jar.get(ACCESS_COOKIE)).toBe('access-token')
    expect(deleted).toEqual([])
  })
})
