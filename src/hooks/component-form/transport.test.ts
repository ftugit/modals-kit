// Транспорт нативных экшенов SvelteKit: редирект экшена — применённое
// действие, а не «неизвестный ответ». Без этого форма показывала
// «сервер ответил HTTP 200» там, где выход уже выполнен.
import { describe, expect, test, vi } from 'vitest'
import { kitActionTransport, kitRedirectLocation } from './transport.js'

const goto = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('$app/navigation', () => ({ goto }))

const envelope = {
  formId: 'user-session-revoke-others',
  instance: 'user-session-revoke-others:new',
  submissionId: '11111111-1111-4111-8111-111111111111',
  revision: 2,
  intent: 'bulk-exit',
} as const

function respond(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    ),
  )
}

async function submit() {
  return kitActionTransport('/user/logout?/exit')({
    envelope: { ...envelope },
    data: new FormData(),
    accept: ['application/json'],
    signal: new AbortController().signal,
  })
}

describe('kitActionTransport: редирект экшена', () => {
  test('редирект применяется переходом, а форма считает действие выполненным', async () => {
    goto.mockClear()
    respond({ type: 'redirect', status: 303, location: '/user/auth' })

    const out = await submit()

    expect(goto).toHaveBeenCalledWith('/user/auth', { invalidateAll: true })
    expect(out.kind).toBe('result')
    if (out.kind !== 'result') return
    expect(out.result.ok).toBe(true)
    expect(out.result.outcome).toBe('committed')
    expect(out.result.errors).toEqual([])
    expect(out.result.submissionId).toBe(envelope.submissionId)
  })

  test('внешний адрес и мусор переходом не становятся', async () => {
    // Негативный контроль на подмену: адрес из ответа — не маршрут.
    expect(kitRedirectLocation({ type: 'redirect', location: 'https://зло.example' })).toBeNull()
    expect(kitRedirectLocation({ type: 'redirect', location: '//зло.example' })).toBeNull()
    expect(kitRedirectLocation({ type: 'redirect' })).toBeNull()
    expect(kitRedirectLocation({ type: 'success', location: '/user/auth' })).toBeNull()
    expect(kitRedirectLocation(null)).toBeNull()
    expect(kitRedirectLocation({ type: 'redirect', location: '/user/auth' })).toBe('/user/auth')
  })

  test('без редиректа ответ разбирается как раньше', async () => {
    goto.mockClear()
    // `success` с пустыми данными: результат не распознаётся — остаётся
    // прежний путь «неизвестный ответ», а не молчаливый успех.
    respond({ type: 'success', status: 200, data: '' })
    const out = await submit()
    expect(goto).not.toHaveBeenCalled()
    expect(out.kind).toBe('result')
    if (out.kind !== 'result') return
    expect(out.result.ok).toBe(false)
    expect(out.result.outcome).toBe('unknown')
  })
})
