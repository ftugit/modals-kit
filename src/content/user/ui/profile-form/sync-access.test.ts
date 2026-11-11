import { beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyEnvelope } from '#lib/form/index.js'
import { profileForm } from './form.js'
import { syncProfileAccess } from './sync-access.js'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('#hooks/component-form/transport.js', () => ({ kitActionTransport: () => send }))

beforeEach(() => send.mockReset())

describe('syncProfileAccess', () => {
  it('отправляет корректный конверт и возвращает метаданные того же субъекта', async () => {
    const user = { sub: 'same', iat: 1, expiresAt: 2, ttlMs: 1, prof: { nickname: null, avatarUrl: null }, permissions: [] }
    send.mockResolvedValue({ kind: 'result', result: { ok: true, data: { user } } })
    expect(await syncProfileAccess('/user/auth', 'same', new AbortController().signal)).toEqual(user)
    const request = send.mock.calls[0]![0]
    expect(verifyEnvelope(request.data, profileForm)).toMatchObject({ ok: true, envelope: { intent: 'sync-access' } })
    expect(request.data.has('photo')).toBe(false)
  })

  it('не возвращает чужую сессию или отказ', async () => {
    send.mockResolvedValueOnce({ kind: 'result', result: { ok: true, data: { user: { sub: 'other' } } } })
    send.mockResolvedValueOnce({ kind: 'network' })
    const signal = new AbortController().signal
    expect(await syncProfileAccess('/', 'same', signal)).toBeNull()
    expect(await syncProfileAccess('/', 'same', signal)).toBeNull()
  })
})
