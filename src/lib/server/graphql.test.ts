/**
 * Универсальный GraphQL-источник: POST и User-Agent, кэш, single-flight,
 * повторы, таймаут, `errors` в теле и проекция ответа.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  GRAPHQL_UA,
  GraphqlUpstreamError,
  fetchGraphql,
  graphqlCacheKey,
  resetGraphqlTransport,
} from './graphql'

type Call = { url: string; init: RequestInit }

/** Фейковый fetch: отдаёт заранее заданные ответы по порядку и пишет вызовы. */
function stubFetch(answers: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return await next()
  }) as unknown as typeof globalThis.fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Часы теста: `sleep` двигает время — зазоры и TTL проверяются без ожидания. */
function clock(start = 0) {
  let t = start
  const waits: number[] = []
  return {
    waits,
    now: () => t,
    sleep: async (ms: number) => {
      waits.push(ms)
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

const spec = {
  url: 'https://example.test/graphql',
  doc: 'query Q($limit: Int) { items(limit: $limit) { id } }',
  variables: { limit: 2 },
  map: (data: unknown) => (data as { items: { id: number }[] }).items,
}

beforeEach(() => resetGraphqlTransport())

describe('запрос', () => {
  it('POST с User-Agent, переменными и проекцией ответа', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [{ id: 1 }, { id: 2 }] } })])
    const items = await fetchGraphql(spec, { fetch: fetchImpl })

    expect(items).toEqual([{ id: 1 }, { id: 2 }])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(spec.url)
    expect(calls[0]!.init.method).toBe('POST')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers['User-Agent']).toBe(GRAPHQL_UA)
    expect(headers['content-type']).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: spec.doc, variables: { limit: 2 } })
  })

  it('`errors` при HTTP 200 — ошибка, а не «частичные данные»', async () => {
    const { fetchImpl } = stubFetch([() => json({ errors: [{ message: 'Expected type' }] })])
    await expect(fetchGraphql(spec, { fetch: fetchImpl })).rejects.toThrow(/Expected type/)
  })

  it('ответ без `data` — ошибка', async () => {
    const { fetchImpl } = stubFetch([() => json({})])
    await expect(fetchGraphql(spec, { fetch: fetchImpl })).rejects.toThrow(/без data/)
  })

  it('повтор на 429, затем честная ошибка', async () => {
    const one = stubFetch([() => json({}, 429), () => json({ data: { items: [{ id: 7 }] } })])
    const c = clock()
    await expect(fetchGraphql(spec, { fetch: one.fetchImpl, now: c.now, sleep: c.sleep })).resolves.toEqual([{ id: 7 }])
    expect(one.calls).toHaveLength(2)

    resetGraphqlTransport()
    const two = stubFetch([() => json({}, 429), () => json({}, 503)])
    await expect(
      fetchGraphql(spec, { fetch: two.fetchImpl, now: c.now, sleep: c.sleep }),
    ).rejects.toBeInstanceOf(GraphqlUpstreamError)
    expect(two.calls).toHaveLength(2)
  })

  it('сетевой отказ — 504 с причиной', async () => {
    const failing = (async () => {
      throw new Error('socket hang up')
    }) as unknown as typeof globalThis.fetch
    await expect(fetchGraphql(spec, { fetch: failing })).rejects.toThrow(/недоступен/)
  })
})

describe('кэш и single-flight', () => {
  it('повторный запрос берётся из кэша', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl })
    await fetchGraphql(spec, { fetch: fetchImpl })
    expect(calls).toHaveLength(1)
  })

  it('разные переменные — разные записи кэша', () => {
    expect(graphqlCacheKey(spec)).not.toBe(
      graphqlCacheKey({ ...spec, variables: { limit: 3 } }),
    )
  })

  it('после TTL запрос повторяется', async () => {
    const c = clock()
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl, now: c.now, sleep: c.sleep, cacheTtlMs: 100 })
    c.advance(101)
    await fetchGraphql(spec, { fetch: fetchImpl, now: c.now, sleep: c.sleep, cacheTtlMs: 100 })
    expect(calls).toHaveLength(2)
  })

  it('одновременные вызовы делят ОДИН запрос', async () => {
    const { calls, fetchImpl } = stubFetch([
      async () => {
        await new Promise((r) => setTimeout(r, 5))
        return json({ data: { items: [{ id: 1 }] } })
      },
    ])
    const [a, b] = await Promise.all([
      fetchGraphql(spec, { fetch: fetchImpl }),
      fetchGraphql(spec, { fetch: fetchImpl }),
    ])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
  })

  it('между запросами выдерживается зазор (вежливость к API)', async () => {
    const c = clock()
    const { fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl, now: c.now, sleep: c.sleep, minGapMs: 250 })
    await fetchGraphql({ ...spec, variables: { limit: 9 } }, { fetch: fetchImpl, now: c.now, sleep: c.sleep, minGapMs: 250 })
    expect(c.waits).toContain(250)
  })

  it('прерывание ожидания не отменяет общий запрос', async () => {
    const c = clock()
    const { fetchImpl } = stubFetch([
      async () => {
        await new Promise((r) => setTimeout(r, 5))
        return json({ data: { items: [{ id: 1 }] } })
      },
    ])
    const controller = new AbortController()
    const waited = fetchGraphql(spec, { fetch: fetchImpl, now: c.now, sleep: c.sleep, signal: controller.signal })
    controller.abort()
    await expect(waited).rejects.toThrow(/Aborted/)
    // Запрос всё равно дошёл и заполнил кэш — следующие вызовы берут его.
    await expect(fetchGraphql(spec, { fetch: fetchImpl, now: c.now, sleep: c.sleep })).resolves.toEqual([{ id: 1 }])
  })

  it('предупреждений о таймауте нет в теле запроса: signal ставит транспорт', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout')
    const { fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl, timeoutMs: 1234 })
    expect(spy).toHaveBeenCalledWith(1234)
    spy.mockRestore()
  })
})
