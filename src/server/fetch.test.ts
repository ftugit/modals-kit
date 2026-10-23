/**
 * `fetch` приложения (`./fetch`) и ответ маршрута на ошибку (`./api-error`):
 *   • F8: нижний `fetch` запомнен в `init` сервера, а не текущий глобальный (в
 *     dev его на время SSR-рендера подменяет Kit);
 *   • правила хостов: User-Agent, общий лимит REST и GraphQL одного хоста;
 *   • B8: клиенту — наш текст и код, подробности — только в лог.
 */
import { error as kitError } from '@sveltejs/kit'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FetchError } from '#lib/fetch/index.js'
import { apiErrorInstruction, readApiError } from '#hooks/api-error.js'
import { normalizeService } from '#lib/form/index.js'
import { apiFailure, apiInvalid } from './api-error.server.js'
import { captureUpstreamFetch, makeUpstream, upstream, UPSTREAM_UA, waitTask } from './fetch.server.js'
import { readTaskStream, TASK_STREAM_ACCEPT } from '#lib/fetch/index.js'
import { taskResponse } from '#hooks/task-stream.server.js'
import { fetchGraphql, resetGraphqlTransport } from '#hooks/graphql.server.js'
import { fetchShikimoriJson, resetShikimoriTransport } from '#content/demo-catalog/shikimori/shikimori.server.js'

const original = globalThis.fetch
const ok = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

afterEach(async () => {
  globalThis.fetch = original
  captureUpstreamFetch(original)
  await resetGraphqlTransport()
  await resetShikimoriTransport()
})

describe('fetch для внешних API', () => {
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
    await fetchShikimoriJson('/studios')
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.startsWith('native '))).toBe(true)
  })

  it('Shikimori: User-Agent ставит fetch приложения; REST и GraphQL делят ОДИН лимит хоста', async () => {
    let t = 0
    const at: number[] = []
    const heads: Headers[] = []
    const lower = async (input: string | URL | Request, init: RequestInit = {}) => {
      at.push(t)
      heads.push(new Headers(init.headers))
      return String(input).includes('graphql') ? ok({ data: { x: 1 } }) : ok([])
    }
    const fetch = makeUpstream(lower, { now: () => t, sleep: async (ms) => void (t += ms) })
    const gql = (i: number) =>
      fetchGraphql({ url: 'https://shikimori.io/api/graphql', doc: `{ x${i} }`, map: (d) => d }, { fetch })
    await Promise.all([
      ...[1, 2, 3].map((i) => fetchShikimoriJson(`/studios?i=${i}`, { fetch })),
      ...[1, 2].map(gql),
    ])
    expect(heads.every((h) => h.get('user-agent') === UPSTREAM_UA)).toBe(true)
    // rps 4: пятый запуск — через секунду, кем бы он ни был.
    expect(at).toEqual([0, 0, 0, 0, 1_000])
  })
})

describe('ответ маршрута на ошибку (B8)', () => {
  const quiet = () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    return { log, warn, restore: () => { log.mockRestore(); warn.mockRestore() } }
  }

  it('сбой внешнего сервиса: свой текст, код и статус; исходная ошибка — только в лог', async () => {
    const q = quiet()
    try {
      const boom = new Error('connect ECONNREFUSED 10.0.0.7:443')
      const res = apiFailure(new FetchError('fetch.network', 'внешний сервис недоступен', { cause: boom }), 't', 'Каталог недоступен')
      expect(res.status).toBe(504)
      const body = await res.json()
      expect(body).toEqual({ error: 'Каталог недоступен: внешний сервис недоступен', code: 'fetch.network' })
      expect(JSON.stringify(body)).not.toContain('10.0.0.7')
      expect(q.warn).toHaveBeenCalledTimes(1)
      expect(q.log).not.toHaveBeenCalled()
    } finally {
      q.restore()
    }
  })

  it('сбой GraphQL доходит до клиента своим текстом и кодом (а не «внутренняя ошибка»)', async () => {
    const q = quiet()
    try {
      const down = async () => new Response('', { status: 503 })
      const err = await fetchGraphql(
        { url: 'https://example.test/graphql', doc: '{ x }', map: (d) => d },
        { fetch: makeUpstream(down, { sleep: async () => {} }) },
      ).catch((e: unknown) => e)
      const res = apiFailure(err, 't', 'Схема недоступна')
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'Схема недоступна: внешний сервис ответил 503', code: 'fetch.status' })
      expect(q.log).not.toHaveBeenCalled()
    } finally {
      q.restore()
    }
  })

  it('непредвиденная ошибка и HttpError Kit — общий текст, код internal, 500; обрыв клиентом — без лога', async () => {
    const q = quiet()
    try {
      const secret = apiFailure(new Error('DATABASE_URL=postgres://u:secret@db'), 't', 'X')
      expect(secret.status).toBe(500)
      expect(await secret.json()).toEqual({ error: 'X: внутренняя ошибка сервера', code: 'internal' })
      // HttpError несёт числовой status, но это НЕ сбой внешнего API: угадывание
      // по полю приняло бы его за таковой и отдало бы текст клиенту.
      let http: unknown
      try { kitError(503, 'секрет из нашего кода') } catch (e) { http = e }
      expect(await apiFailure(http, 't', 'X').json()).toEqual({ error: 'X: внутренняя ошибка сервера', code: 'internal' })
      expect(q.log).toHaveBeenCalledTimes(2)

      apiFailure(new DOMException('aborted', 'AbortError'), 't', 'X')
      expect(q.log).toHaveBeenCalledTimes(2)
    } finally {
      q.restore()
    }
  })

  it('кривой запрос: 400, код query.invalid, поле — если названо', async () => {
    const res = apiInvalid('page: целое от 1', 'page')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'page: целое от 1', code: 'query.invalid', field: 'page' })
  })
})

describe('тело отказа на клиенте и в lib/form', () => {
  it('readApiError понимает новое тело и старое `{ error }`; не отказ — null', () => {
    expect(readApiError({ error: 'нет', code: 'fetch.timeout' })).toEqual({ error: 'нет', code: 'fetch.timeout' })
    expect(readApiError({ error: 'нет' })).toEqual({ error: 'нет', code: 'unknown' })
    expect(readApiError({ items: [] })).toBeNull()
    expect(readApiError('нет')).toBeNull()
  })

  it('инструкция api: отказ у поля, если поле объявлено; иначе общий; текст маршрута сохраняется', () => {
    const instruction = apiErrorInstruction({ fields: ['email'] })
    const [atField] = normalizeService({
      status: 400,
      body: { error: 'Этот адрес уже занят', code: 'unique', field: 'email' },
      instruction,
    })
    expect(atField).toMatchObject({ path: 'email', code: 'external.unique', message: 'Этот адрес уже занят' })
    const [general] = normalizeService({
      status: 504,
      body: { error: 'Каталог недоступен: внешний сервис не ответил вовремя', code: 'fetch.timeout' },
      instruction,
    })
    expect(general).toMatchObject({ path: undefined, code: 'external.fetch.timeout' })
    expect(general!.message).toContain('не ответил вовремя')
  })
})

describe('ожидания upstream → строки хода', () => {
  it('подписи ожиданий', () => {
    expect(waitTask({ reason: 'queue', host: 'h', ahead: 2 }).label).toBe('Очередь API: впереди 2')
    expect(waitTask({ reason: 'queue', host: 'h', ahead: 0, waitMs: 1200 }).label).toBe('Очередь API: ~2 с')
    expect(waitTask({ reason: 'retry', attempt: 2, attempts: 2, waitMs: 500 }).label).toBe('Повтор 2 из 2')
  })

  it('внутри taskResponse очередь хоста уходит клиенту строкой; вне — ничего', async () => {
    captureUpstreamFetch((async () => ok({ ok: 1 })) as typeof globalThis.fetch)
    const request = new Request('http://x/api', { headers: { accept: TASK_STREAM_ACCEPT } })
    const res = await taskResponse(request, async () => {
      const [a] = await Promise.all([upstream('https://shikimori.io/a'), upstream('https://shikimori.io/b')])
      return Response.json(await a.json())
    })
    const seen: unknown[] = []
    const back = await readTaskStream(res, (task) => seen.push(task))
    expect(seen).toEqual([{ status: 'pending', scope: 'local', label: 'Очередь API: впереди 1' }])
    expect(await back.json()).toEqual({ ok: 1 })
    // Без строк ответа — обычный вызов.
    expect((await upstream('https://shikimori.io/c')).status).toBe(200)
  })
})
