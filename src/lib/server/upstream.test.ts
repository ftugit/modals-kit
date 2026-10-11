/**
 * Общее для транспортов к внешним API:
 *   • F8: `fetch`, запомненный в `init` сервера, а не текущий глобальный (в dev
 *     его на время SSR-рендера подменяет Kit);
 *   • §13.1: общий слой сетевых ошибок — `UpstreamError` и `upstreamFailure` (B8).
 */
import { error as kitError } from '@sveltejs/kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchGraphql, GraphqlUpstreamError, resetGraphqlTransport } from './graphql'
import { fetchShikimoriJson, resetShikimoriTransport, ShikimoriUpstreamError } from './shikimori'
import { captureUpstreamFetch, UpstreamError, upstreamFailure, upstreamFetch } from './upstream'

const original = globalThis.fetch
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  globalThis.fetch = original
  captureUpstreamFetch(original)
  resetGraphqlTransport()
  resetShikimoriTransport()
})

describe('fetch для внешних API', () => {
  it('без init — глобальный fetch в момент вызова', () => {
    captureUpstreamFetch(original)
    expect(upstreamFetch()).toBe(original)
  })

  it('после init подмена глобального fetch (обёртка рендера) транспорты не задевает', async () => {
    const calls: string[] = []
    captureUpstreamFetch((async (url: string | URL) => {
      calls.push(`native ${String(url)}`)
      return String(url).includes('graphql') ? ok({ data: { x: 1 } }) : ok([])
    }) as typeof globalThis.fetch)
    // Kit в dev на время SSR-рендера ставит свою обёртку — её звать нельзя.
    globalThis.fetch = (async () => {
      throw new Error('вызвана обёртка рендера')
    }) as typeof globalThis.fetch

    await fetchGraphql({ url: 'https://example.test/graphql', doc: '{ x }', map: (d) => d })
    await fetchShikimoriJson('/studios', { minGapMs: 0 })
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.startsWith('native '))).toBe(true)
  })
})

describe('общий слой сетевых ошибок (§13.1, B8)', () => {
  const quiet = () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    return { log, warn, restore: () => { log.mockRestore(); warn.mockRestore() } }
  }

  it('источник сбоя виден по классу; оба транспорта — наследники UpstreamError', () => {
    const gql = new GraphqlUpstreamError('GraphQL ответил 503', 502)
    const rest = new ShikimoriUpstreamError('Shikimori API ответил 503', 502)
    expect(gql).toBeInstanceOf(UpstreamError)
    expect(rest).toBeInstanceOf(UpstreamError)
    expect(gql).not.toBeInstanceOf(ShikimoriUpstreamError)
    expect([gql.name, rest.name]).toEqual(['GraphqlUpstreamError', 'ShikimoriUpstreamError'])
  })

  it('сбой GraphQL доходит до клиента своим текстом и кодом (а не «внутренняя ошибка»)', async () => {
    const q = quiet()
    try {
      const down = (async () => new Response('', { status: 503 })) as typeof globalThis.fetch
      const err = await fetchGraphql({
        url: 'https://example.test/graphql', doc: '{ x }', map: (d) => d,
      }, { fetch: down, minGapMs: 0, retryDelayMs: 0, sleep: async () => {} }).catch((e) => e)
      expect(upstreamFailure(err, 't')).toEqual({ message: 'GraphQL ответил 503', status: 502 })
      expect(q.log).not.toHaveBeenCalled()
    } finally {
      q.restore()
    }
  })

  it('сбой REST: свой текст; исходная ошибка — только в лог', () => {
    const q = quiet()
    try {
      const boom = new Error('connect ECONNREFUSED 10.0.0.7:443')
      const r = upstreamFailure(new ShikimoriUpstreamError('Shikimori API недоступен', 504, { cause: boom }), 't')
      expect(r).toEqual({ message: 'Shikimori API недоступен', status: 504 })
      expect(q.warn).toHaveBeenCalledTimes(1)
    } finally {
      q.restore()
    }
  })

  it('непредвиденная ошибка и HttpError Kit — общий текст, подробности в лог; обрыв клиентом — без лога', () => {
    const q = quiet()
    try {
      expect(upstreamFailure(new Error('DATABASE_URL=postgres://u:secret@db'), 't'))
        .toEqual({ message: 'внутренняя ошибка сервера', status: 502 })
      // HttpError несёт числовой status, но это НЕ сбой внешнего API: угадывание
      // по полю (вариант (c)) приняло бы его за таковой и отдало бы текст клиенту.
      let http: unknown
      try { kitError(503, 'секрет из нашего кода') } catch (e) { http = e }
      expect(upstreamFailure(http, 't')).toEqual({ message: 'внутренняя ошибка сервера', status: 502 })
      expect(q.log).toHaveBeenCalledTimes(2)

      upstreamFailure(new DOMException('aborted', 'AbortError'), 't')
      expect(q.log).toHaveBeenCalledTimes(2)
    } finally {
      q.restore()
    }
  })
})
