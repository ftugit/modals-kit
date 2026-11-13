import { describe, expect, test, vi } from 'vitest'
import type { RequestEvent } from '@sveltejs/kit'
import { runBulkExit, sessionFormError } from './sessions-exit.server.js'

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }))
const event = {} as RequestEvent
const target = { selfHref: '/user/sessions', doneHref: '/user/auth' }

vi.mock('./gateway.server.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./gateway.server.js')>()
  return {
    ...actual,
    auth: () => ({
      actor: async () => ({ ok: true, value: { id: 'me', sessionId: 'current' } }),
      revokeBulkSessions: mocks.revoke,
    }),
  }
})

describe('runBulkExit: бросок домена и факты', () => {
  test('бросок хранилища → auth.unavailable (retryable), а не глухой редирект', async () => {
    mocks.revoke.mockRejectedValueOnce(new Error('db down'))
    const r = await runBulkExit(event, { include_current: false }, target)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error?.code).toBe('auth.unavailable')
    expect(r.error?.retryable).toBe(true)
    expect(r.error?.message).toContain('Хранилище недоступно')
  })

  test('отказ домена проводит код из каталога, а не общий auth.revoke', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: false, fact: { code: 'session.nothing-to-close' } })
    const r = await runBulkExit(event, {}, target)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error?.code).toBe('session.nothing-to-close')
  })

  test('успех: текущая закрыта → doneHref, иначе selfHref', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: true, value: { revoked: 1, current: true, requested: 1 } })
    const r = await runBulkExit(event, {}, target)
    expect(r).toEqual({ ok: true, redirect: '/user/auth' })
  })
})

describe('runBulkExit: частичный набор виден в редиректе (P1-1)', () => {
  test('requested > revoked и текущая жива → selfHref с notice=bulk-exit-partial', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: true, value: { revoked: 3, current: false, requested: 5 } })
    const r = await runBulkExit(event, {}, target)
    expect(r).toEqual({ ok: true, redirect: '/user/sessions?notice=bulk-exit-partial&requested=5&revoked=3' })
  })

  test('набор закрыт целиком → selfHref без объявления', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: true, value: { revoked: 5, current: false, requested: 5 } })
    const r = await runBulkExit(event, {}, target)
    expect(r).toEqual({ ok: true, redirect: '/user/sessions' })
  })

  test('текущая закрыта → doneHref даже при расхождении (список уже не показать)', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: true, value: { revoked: 3, current: true, requested: 5 } })
    const r = await runBulkExit(event, {}, target)
    expect(r).toEqual({ ok: true, redirect: '/user/auth' })
  })

  test('selfHref уже с query — разделитель &', async () => {
    mocks.revoke.mockResolvedValueOnce({ ok: true, value: { revoked: 1, current: false, requested: 2 } })
    const r = await runBulkExit(event, {}, { selfHref: '/user/sessions?sessions.state=active', doneHref: '/user/auth' })
    expect(r).toEqual({ ok: true, redirect: '/user/sessions?sessions.state=active&notice=bulk-exit-partial&requested=2&revoked=1' })
  })
})

test('sessionFormError: код только из каталога, текст из словаря', () => {
  const e = sessionFormError('auth.limit')
  expect(e.code).toBe('auth.limit')
  expect(e.message).toContain('Слишком много исключений')
  expect(e.origin).toBe('server')
})
