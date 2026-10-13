import { beforeEach, describe, expect, it } from 'vitest'
import { resetGraphqlTransport } from './graphql'
import {
  RICKMORTY_GRAPHQL,
  apiWindow,
  fetchCharactersPage,
  parseCharactersQuery,
  resetRickMortyTransport,
  rickMortyFilterParams,
} from './rickmorty'
import { makeUpstream } from './fetch'

/** Персонажи 1..n — как отдаёт API (с лишним полем `url`, которое мы срезаем). */
const people = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({
    id: from + i,
    name: `Person ${from + i}`,
    status: 'Alive',
    species: 'Human',
    type: '',
    gender: 'Male',
    image: `https://rickandmortyapi.com/api/character/avatar/${from + i}.jpeg`,
    url: `https://rickandmortyapi.com/api/character/${from + i}`,
  }))

/** Поддельный сервис: 45 персонажей, страницы по 20; пишет каждый запрос. */
function fakeService(total = 45) {
  const calls: { url: string; body?: unknown }[] = []
  const pageOf = (page: number) => {
    const from = (page - 1) * 20 + 1
    return from > total ? [] : people(from, Math.min(total, page * 20))
  }
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url === RICKMORTY_GRAPHQL) {
      const body = JSON.parse(String(init?.body)) as { variables: { page: number; filter: Record<string, string> } }
      calls.push({ url, body })
      const results = body.variables.filter.name === 'nobody' ? [] : pageOf(body.variables.page)
      const count = results.length ? total : null
      return Response.json({ data: { characters: { info: { count }, results } } })
    }
    calls.push({ url })
    const params = new URL(url).searchParams
    const results = params.get('name') === 'nobody' ? [] : pageOf(Number(params.get('page')))
    if (!results.length) return Response.json({ error: 'There is nothing here' }, { status: 404 })
    return Response.json({ info: { count: total, pages: Math.ceil(total / 20) }, results })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

beforeEach(() => {
  resetRickMortyTransport()
  resetGraphqlTransport()
})

describe('apiWindow: страница демо → страницы API', () => {
  it('окно внутри одной страницы API', () => {
    expect(apiWindow(3, 5)).toEqual({ pages: [1], skip: 10 })
  })
  it('окно на стыке двух страниц', () => {
    expect(apiWindow(2, 15)).toEqual({ pages: [1, 2], skip: 15 })
  })
  it('размер больше страницы API', () => {
    expect(apiWindow(2, 40)).toEqual({ pages: [3, 4], skip: 0 })
    expect(apiWindow(1, 60)).toEqual({ pages: [1, 2, 3], skip: 0 })
  })
})

describe('fetchCharactersPage', () => {
  for (const api of ['rest', 'graphql'] as const) {
    it(`${api}: размер 5, страница 3 = записи 11..15, totals из count`, async () => {
      const svc = fakeService()
      const page = await fetchCharactersPage({ api, page: 3, limit: 5 }, { fetch: svc.fetch })
      expect(page.items.map((item) => item.id)).toEqual([11, 12, 13, 14, 15])
      expect(page).toMatchObject({ totalItems: 45, totalPages: 9, hasNext: true })
      expect(page.items[0]).not.toHaveProperty('url')
    })

    it(`${api}: окно на стыке страниц API склеивается`, async () => {
      const svc = fakeService()
      const page = await fetchCharactersPage({ api, page: 2, limit: 15 }, { fetch: svc.fetch })
      expect(page.items.map((item) => item.id)).toEqual(Array.from({ length: 15 }, (_, i) => 16 + i))
      expect(svc.calls).toHaveLength(2)
    })

    it(`${api}: последняя страница — hasNext=false, лишняя страница API не запрашивается`, async () => {
      const svc = fakeService()
      const page = await fetchCharactersPage({ api, page: 2, limit: 40 }, { fetch: svc.fetch })
      expect(page.items.map((item) => item.id)).toEqual([41, 42, 43, 44, 45])
      expect(page.hasNext).toBe(false)
      expect(svc.calls).toHaveLength(1)
    })

    it(`${api}: пустая выдача — пустая страница, не ошибка`, async () => {
      const svc = fakeService()
      const page = await fetchCharactersPage({ api, page: 1, limit: 20, search: 'nobody' }, { fetch: svc.fetch })
      expect(page).toMatchObject({ items: [], totalItems: 0, totalPages: 0, hasNext: false })
    })
  }

  it('REST и GraphQL получают одни и те же параметры фильтра', async () => {
    const svc = fakeService()
    const query = { page: 1, limit: 20, search: 'rick', filters: { 'filters.status': 'alive', 'filters.species': 'Human' } }
    await fetchCharactersPage({ api: 'rest', ...query }, { fetch: svc.fetch })
    await fetchCharactersPage({ api: 'graphql', ...query }, { fetch: svc.fetch })
    const rest = new URL(svc.calls[0]!.url).searchParams
    expect(Object.fromEntries(rest)).toEqual({ page: '1', status: 'alive', species: 'Human', name: 'rick' })
    expect((svc.calls[1]!.body as { variables: unknown }).variables).toEqual({
      page: 1,
      filter: { status: 'alive', species: 'Human', name: 'rick' },
    })
  })

  it('сбой сервиса — FetchError 502 с текстом без адреса; 5xx повторён один раз', async () => {
    let calls = 0
    const fetch = makeUpstream(async () => ((calls += 1), new Response('oops', { status: 500 })), { sleep: async () => {} })
    await expect(fetchCharactersPage({ api: 'rest', page: 1, limit: 20 }, { fetch })).rejects.toMatchObject({
      name: 'FetchError',
      code: 'fetch.status',
      status: 502,
      message: 'внешний сервис ответил 500',
    })
    expect(calls).toBe(2)
  })

  it('сеть недоступна — 504', async () => {
    const fetch = makeUpstream(async () => {
      throw new TypeError('fetch failed')
    }, { sleep: async () => {} })
    await expect(fetchCharactersPage({ api: 'rest', page: 1, limit: 20 }, { fetch })).rejects.toMatchObject({ status: 504 })
  })

  it('REST: повтор того же запроса берёт кэш', async () => {
    const svc = fakeService()
    await fetchCharactersPage({ api: 'rest', page: 1, limit: 20 }, { fetch: svc.fetch })
    await fetchCharactersPage({ api: 'rest', page: 1, limit: 20 }, { fetch: svc.fetch })
    expect(svc.calls).toHaveLength(1)
  })
})

describe('rickMortyFilterParams', () => {
  it('объявленные значения → параметры API с теми же именами', () => {
    expect(
      rickMortyFilterParams({ 'filters.status': 'dead', 'filters.gender': 'female', 'filters.type': 'Parasite' }),
    ).toEqual({ params: { status: 'dead', gender: 'female', type: 'Parasite' }, dropped: [] })
  })

  it('чужой ключ и значение вне опций — в dropped с причиной, не молча', () => {
    const { params, dropped } = rickMortyFilterParams({ 'filters.kind': 'tv', 'filters.status': 'ongoing' })
    expect(params).toEqual({})
    expect(dropped.map((item) => item.key).sort()).toEqual(['filters.kind', 'filters.status'])
    expect(dropped.every((item) => item.reason.length > 0)).toBe(true)
  })
})

describe('parseCharactersQuery', () => {
  it('разбирает версию API, страницу, размер, поиск и фильтры', () => {
    const parsed = parseCharactersQuery(new URLSearchParams('api=graphql&page=2&limit=10&search=%20rick%20&filters.status=alive'))
    expect(parsed).toEqual({
      ok: true,
      query: { api: 'graphql', page: 2, limit: 10, search: 'rick', filters: { 'filters.status': 'alive' } },
    })
  })
  it('отклоняет неизвестную версию и размер больше 60', () => {
    expect(parseCharactersQuery(new URLSearchParams('api=soap')).ok).toBe(false)
    expect(parseCharactersQuery(new URLSearchParams('limit=61')).ok).toBe(false)
  })
})
