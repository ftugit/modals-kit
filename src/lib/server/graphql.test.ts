/**
 * Универсальный GraphQL-источник: POST, кэш с потолком, `errors` в теле и
 * проекция ответа. Сеть — `fetch` приложения на поддельном нижнем `fetch`:
 * повторы, склейка и User-Agent проверяются с теми же правилами, что в бою.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { memoryStore } from '#lib/cache/index.js'
import { FetchError } from '#lib/fetch/index.js'
import { makeUpstream, UPSTREAM_UA } from './fetch'
import { fetchGraphql, graphqlCacheKey, GRAPHQL_CACHE_MAX, resetGraphqlTransport } from './graphql'

type Call = { url: string; init: RequestInit }

/** Поддельная сеть: ответы по порядку, вызовы пишутся; поверх — `fetch` приложения. */
function stubFetch(answers: Array<() => Response | Promise<Response>>) {
  const calls: Call[] = []
  const lower = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = answers[Math.min(calls.length - 1, answers.length - 1)]!
    return await next()
  }
  return { calls, fetchImpl: makeUpstream(lower, { sleep: async () => {} }) }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const spec = {
  url: 'https://example.test/graphql',
  doc: 'query Q($limit: Int) { items(limit: $limit) { id } }',
  variables: { limit: 2 },
  map: (data: unknown) => (data as { items: { id: number }[] }).items,
}

let t = 0
let store: ReturnType<typeof memoryStore>
beforeEach(async () => {
  await resetGraphqlTransport()
  t = 0
  store = memoryStore({ now: () => t })
})

describe('запрос', () => {
  it('POST с переменными и проекцией ответа; User-Agent хоста ставит fetch приложения', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [{ id: 1 }, { id: 2 }] } })])
    const items = await fetchGraphql(spec, { fetch: fetchImpl, store })

    expect(items).toEqual([{ id: 1 }, { id: 2 }])
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(spec.url)
    expect(calls[0]!.init.method).toBe('POST')
    const headers = new Headers(calls[0]!.init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ query: spec.doc, variables: { limit: 2 } })

    const shiki = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql({ ...spec, url: 'https://shikimori.io/api/graphql' }, { fetch: shiki.fetchImpl, store })
    expect(new Headers(shiki.calls[0]!.init.headers).get('user-agent')).toBe(UPSTREAM_UA)
  })

  it('`errors` при HTTP 200 — ошибка, а не «частичные данные»', async () => {
    const { fetchImpl } = stubFetch([() => json({ errors: [{ message: 'Expected type' }] })])
    const error = await fetchGraphql(spec, { fetch: fetchImpl, store }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FetchError)
    expect(error).toMatchObject({ code: 'fetch.rejected', status: 502 })
    // Текст сервера (подробности запроса) — только в `cause`, не в сообщении для клиента.
    expect((error as Error).message).toBe('GraphQL вернул ошибку')
    expect((error as Error).cause).toBe('Expected type')
  })

  it('ответ без `data` — ошибка', async () => {
    const { fetchImpl } = stubFetch([() => json({})])
    await expect(fetchGraphql(spec, { fetch: fetchImpl, store })).rejects.toThrow(/без data/)
  })

  it('запрос GraphQL повторяется на 429 (он ничего не меняет), затем честная ошибка', async () => {
    const one = stubFetch([() => json({}, 429), () => json({ data: { items: [{ id: 7 }] } })])
    await expect(fetchGraphql(spec, { fetch: one.fetchImpl, store })).resolves.toEqual([{ id: 7 }])
    expect(one.calls).toHaveLength(2)

    await store.clear()
    const two = stubFetch([() => json({}, 429), () => json({}, 503)])
    await expect(fetchGraphql(spec, { fetch: two.fetchImpl, store })).rejects.toMatchObject({
      code: 'fetch.status',
      upstreamStatus: 503,
    })
    expect(two.calls).toHaveLength(2)
  })

  it('сетевой отказ — 504; исходный сбой только в cause', async () => {
    const failing = makeUpstream(
      async () => {
        throw new Error('socket hang up')
      },
      { sleep: async () => {} },
    )
    const error = await fetchGraphql(spec, { fetch: failing, store }).catch((e: unknown) => e)
    expect(error).toMatchObject({ name: 'FetchError', code: 'fetch.network', status: 504 })
    expect((error as Error).message).not.toContain('socket')
    expect(((error as FetchError).cause as { error: Error }).error.message).toBe('socket hang up')
  })
})

describe('кэш и склейка', () => {
  it('повторный запрос берётся из кэша', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl, store })
    await fetchGraphql(spec, { fetch: fetchImpl, store })
    expect(calls).toHaveLength(1)
  })

  it('разные переменные — разные записи кэша', () => {
    expect(graphqlCacheKey(spec)).not.toBe(graphqlCacheKey({ ...spec, variables: { limit: 3 } }))
  })

  it('после TTL (минута) запрос повторяется', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    await fetchGraphql(spec, { fetch: fetchImpl, store })
    t += 59_999
    await fetchGraphql(spec, { fetch: fetchImpl, store })
    t += 1
    await fetchGraphql(spec, { fetch: fetchImpl, store })
    expect(calls).toHaveLength(2)
  })

  it('F59: у кэша потолок — сверх GRAPHQL_CACHE_MAX вытесняется старая запись', async () => {
    const { calls, fetchImpl } = stubFetch([() => json({ data: { items: [] } })])
    const at = (limit: number) => fetchGraphql({ ...spec, variables: { limit } }, { fetch: fetchImpl, store })
    for (let i = 0; i <= GRAPHQL_CACHE_MAX; i += 1) await at(i)
    expect(calls).toHaveLength(GRAPHQL_CACHE_MAX + 1)
    await at(GRAPHQL_CACHE_MAX)
    expect(calls).toHaveLength(GRAPHQL_CACHE_MAX + 1)
    await at(0)
    expect(calls).toHaveLength(GRAPHQL_CACHE_MAX + 2)
  })

  it('одновременные вызовы делят ОДИН запрос', async () => {
    const { calls, fetchImpl } = stubFetch([
      async () => {
        await new Promise((r) => setTimeout(r, 5))
        return json({ data: { items: [{ id: 1 }] } })
      },
    ])
    const [a, b] = await Promise.all([
      fetchGraphql(spec, { fetch: fetchImpl, store }),
      fetchGraphql(spec, { fetch: fetchImpl, store }),
    ])
    expect(a).toEqual(b)
    expect(calls).toHaveLength(1)
  })

  it('прерывание ожидания не отменяет общий запрос', async () => {
    const { calls, fetchImpl } = stubFetch([
      async () => {
        await new Promise((r) => setTimeout(r, 5))
        return json({ data: { items: [{ id: 1 }] } })
      },
    ])
    const controller = new AbortController()
    const waited = fetchGraphql(spec, { fetch: fetchImpl, store, signal: controller.signal })
    const stayer = fetchGraphql(spec, { fetch: fetchImpl, store })
    controller.abort()
    await expect(waited).rejects.toMatchObject({ name: 'AbortError' })
    await expect(stayer).resolves.toEqual([{ id: 1 }])
    expect(calls).toHaveLength(1)
  })
})
