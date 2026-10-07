/**
 * Применение фильтров каталога: канонические значения → параметры API.
 *
 * Проверяется и мэппинг, и каждая deny-safe граница: чужое значение, мусор в
 * адресе и связки («поиск под `latest` не работает», «оценка с анонсами») —
 * всё это обязано быть видно в `dropped`, а не исчезать молча.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  animesFilterQuery,
  animesFilterParams,
  fetchAnimesPage,
  filtersOfExtra,
} from './shikimori-filters'
import { buildUpstreamUrl, resetShikimoriTransport } from './shikimori'
import { resetShikimoriFilterSchema } from './shikimori-schema'
import { validateCatalogFilterSchema, type CatalogFilterSchema } from '$lib/filters'

const schema: CatalogFilterSchema = validateCatalogFilterSchema({
  source: 'shikimori',
  version: 1,
  fields: [
    {
      key: 'genres',
      label: 'Жанры',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '27', label: 'Сёнен', count: 40 },
        { value: '133', label: 'Исэкай', count: 12 },
      ],
    },
    {
      key: 'studios',
      label: 'Студии',
      type: 'multiselect',
      modes: ['and', 'not'],
      options: [
        { value: '858', label: 'Wit Studio', count: 7 },
        { value: '1998', label: 'Studio Signpost', count: 3 },
      ],
    },
    {
      key: 'kind',
      label: 'Тип',
      type: 'select',
      options: [{ value: 'tv', label: 'TV' }, { value: 'movie', label: 'фильм' }],
    },
    {
      key: 'status',
      label: 'Статус',
      type: 'select',
      options: [{ value: 'released', label: 'вышел' }, { value: 'latest', label: 'последние добавленные' }, { value: 'anons', label: 'анонс' }],
    },
    { key: 'score', label: 'Оценка', type: 'number', bounds: ['min'], min: 1, max: 10 },
    { key: 'year', label: 'Год', type: 'number', min: 1900, max: 2028 },
  ],
  rules: [
    { id: 'search-with-latest', when: [{ field: 'status', value: 'latest' }], drop: 'q', reason: 'поиск не работает' },
    { id: 'score-with-anons', when: [{ field: 'status', value: 'anons' }], drop: { field: 'score' }, reason: 'у анонсов нет оценки' },
  ],
})

describe('мэппинг значений в параметры API', () => {
  it('жанры: «и» повторением, «кроме» — префиксом `!`', () => {
    const { params } = animesFilterQuery(schema, { 'filters.genres.and': '27,133', 'filters.genres.not': '133' })
    expect(params.genre_v2).toEqual(['27', '133', '!133'])
  })

  it('студии: «и» повторением, «кроме» — префиксом `!` (как у жанров)', () => {
    expect(animesFilterQuery(schema, { 'filters.studios.and': '858' }).params.studio).toEqual(['858'])
    const { params, dropped } = animesFilterQuery(schema, {
      'filters.studios.and': '858',
      'filters.studios.not': '1998',
    })
    expect(params.studio).toEqual(['858', '!1998'])
    expect(dropped).toEqual([])
  })

  it('select-поля едут по значению, оценка — нижней границей', () => {
    const { params } = animesFilterQuery(schema, {
      'filters.kind': 'tv',
      'filters.status': 'released',
      'filters.score.min': 8,
    })
    expect(params).toMatchObject({ kind: 'tv', status: 'released', score: 8 })
  })

  it('год: диапазон обеими границами, недостающая берётся у края базы', () => {
    expect(animesFilterQuery(schema, { 'filters.year.min': 1990, 'filters.year.max': 2010 }).params.season).toBe('1990_2010')
    expect(animesFilterQuery(schema, { 'filters.year.max': 2010 }).params.season).toBe('1900_2010')
    expect(animesFilterQuery(schema, { 'filters.year.min': 2020 }).params.season).toBe('2020_2028')
  })

  it('перевёрнутый диапазон лет не применяется и объясняет себя', () => {
    const { params, dropped } = animesFilterQuery(schema, { 'filters.year.min': 2020, 'filters.year.max': 2010 })
    expect(params.season).toBeUndefined()
    expect(dropped.map((item) => item.key)).toContain('filters.year')
  })

  it('параметры доезжают до адреса API одним списком через запятую', () => {
    const { params } = animesFilterQuery(schema, { 'filters.genres.and': '27', 'filters.studios.and': '858', 'filters.kind': 'movie' })
    const url = new URL(buildUpstreamUrl({ page: 2, limit: 20, ...params }))
    expect(url.searchParams.getAll('genre_v2')).toEqual(['27'])
    expect(url.searchParams.getAll('studio')).toEqual(['858'])
    expect(url.searchParams.get('kind')).toBe('movie')
    expect(url.searchParams.get('page')).toBe('2')
  })

  it('«и» + «кроме» едут ОДНИМ значением списка (повтор API читает как последнее)', () => {
    const { params } = animesFilterQuery(schema, {
      'filters.genres.and': '27',
      'filters.genres.not': '133',
      'filters.studios.and': '858',
      'filters.studios.not': '1998',
    })
    const url = new URL(buildUpstreamUrl({ page: 1, limit: 20, ...params }))
    expect(url.searchParams.getAll('genre_v2')).toEqual(['27,!133'])
    expect(url.searchParams.getAll('studio')).toEqual(['858,!1998'])
  })
})

describe('deny-safe', () => {
  it('чужое значение опции не применяется и попадает в `dropped`', () => {
    const { params, dropped } = animesFilterQuery(schema, { 'filters.kind': 'zzz' })
    expect(params.kind).toBeUndefined()
    expect(dropped).toEqual([{ key: 'filters.kind', reason: 'значение вне опций или границ схемы' }])
  })

  it('ключ, которого нет в схеме, отбрасывается с причиной', () => {
    const { params, dropped } = animesFilterQuery(schema, { 'filters.episodes.max': 12 })
    expect(params).toEqual({})
    expect(dropped[0]!.reason).toBe('поля нет в схеме источника')
  })

  it('число вне границ поля не применяется', () => {
    const { params, dropped } = animesFilterQuery(schema, { 'filters.score.min': 99 })
    expect(params.score).toBeUndefined()
    expect(dropped.map((item) => item.key)).toContain('filters.score.min')
  })
})

describe('связки', () => {
  it('поиск запрещён под «последними добавленными» — с причиной', () => {
    const res = animesFilterQuery(schema, { 'filters.status': 'latest' })
    expect(res.search).toBe(false)
    expect(res.searchReason).toBe('поиск не работает')
    expect(res.params.status).toBe('latest')
  })

  it('оценка с анонсами не применяется — с причиной из связки', () => {
    const res = animesFilterQuery(schema, { 'filters.status': 'anons', 'filters.score.min': 8 })
    expect(res.params.score).toBeUndefined()
    expect(res.params.status).toBe('anons')
    expect(res.dropped).toEqual([{ key: 'filters.score', reason: 'у анонсов нет оценки' }])
  })

  it('без связок поиск разрешён', () => {
    expect(animesFilterQuery(schema, { 'filters.kind': 'tv' }).search).toBe(true)
  })
})

describe('мелочи транспорта', () => {
  it('мэппинг читает типизированные значения, а не строки адреса', () => {
    const { params } = animesFilterParams(schema, { year: { min: 2000, max: 2005 }, genres: { and: ['27'] } })
    expect(params).toMatchObject({ season: '2000_2005', genre_v2: ['27'] })
  })

  it('из extra берутся только фильтры', () => {
    expect(filtersOfExtra({ q: 'наруто', 'filters.kind': 'tv', src: 'animes' })).toEqual({ 'filters.kind': 'tv' })
    expect(filtersOfExtra(undefined)).toEqual({})
  })
})

describe('страница каталога с фильтрами: один конвейер роута и SSR', () => {
  // Кэши (страниц и схемы) у транспорта общие на процесс: между тестами их
  // сбрасываем — иначе «страница не запрошена» означало бы попадание в кэш, а
  // не отсутствие обращения к API.
  beforeEach(() => {
    resetShikimoriTransport()
    resetShikimoriFilterSchema()
  })

  /** Адрес ЗАПРОСА СТРАНИЦЫ (в вызовах есть и служебные: справочники схемы). */
  const pageUrl = (calls: readonly string[]): URL =>
    new URL(
      calls.find(
        (call) => call.startsWith('GET ') && /[?&]page=\d/.test(call) && /[?&]limit=\d/.test(call),
      )!.slice('GET '.length),
    )

  /** Поддельный API: схема (GraphQL + REST) и страница каталога в одном fetch. */
  function stubUpstream() {
    const calls: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${url}`)
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { query: string }
        if (body.query.includes('genres(entryType')) {
          return json({ data: { genres: [{ id: '27', name: 'Shounen', russian: 'Сёнен' }] } })
        }
        return json({ data: { animes: [{ genres: [{ id: '27' }], studios: [{ id: '858' }] }] } })
      }
      if (url.includes('/studios')) return json([{ id: 858, name: 'Wit Studio' }])
      if (url.includes('order=aired_on')) return json([{ aired_on: '2028-01-01' }])
      if (/(kind|status|rating|duration)=zzz/.test(url)) return new Response(enumMessage(url), { status: 422 })
      return json([anime()])
    }) as unknown as typeof globalThis.fetch
    return { calls, fetchImpl }
  }

  const enumMessage = (url: string): string => {
    const name = /(kind|status|rating|duration)=zzz/.exec(url)![1]!
    const values = { kind: ':tv', status: ':anons, :latest', rating: ':none', duration: ':S' }[name]!
    return JSON.stringify([`Invalid ${name} value "zzz" (included_in?([${values}], :zzz) failed)`])
  }

  const anime = () => ({
    id: 1,
    name: 'Title',
    russian: null,
    image: null,
    url: '/animes/1',
    kind: 'tv',
    score: '7.5',
    status: 'released',
    episodes: 12,
    aired_on: '2002-10-03',
  })

  const json = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  it('фильтры доезжают до адреса API, поиск остаётся, выдача возвращается', async () => {
    const { calls, fetchImpl } = stubUpstream()
    const page = await fetchAnimesPage(
      { query: { page: 1, limit: 20, search: 'наруто' }, filters: { 'filters.genres.and': '27' } },
      { fetch: fetchImpl, now: () => 0, sleep: async () => {} },
    )
    expect(page.items).toHaveLength(1)
    expect(page.dropped).toBeUndefined()
    const parsed = pageUrl(calls)
    expect(parsed.searchParams.getAll('genre_v2')).toEqual(['27'])
    expect(parsed.searchParams.get('search')).toBe('наруто')
  })

  it('без фильтров схема НЕ читается: обычная страница её не ждёт', async () => {
    const { calls, fetchImpl } = stubUpstream()
    await fetchAnimesPage(
      { query: { page: 1, limit: 20 }, filters: {} },
      { fetch: fetchImpl, now: () => 0, sleep: async () => {} },
    )
    expect(calls.some((call) => call.startsWith('POST') || call.includes('/studios'))).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('связка запрещает поиск: `q` не уходит в API и честно значится в `dropped`', async () => {
    const { calls, fetchImpl } = stubUpstream()
    const page = await fetchAnimesPage(
      {
        query: { page: 1, limit: 20, search: 'наруто' },
        filters: { 'filters.status': 'latest' },
      },
      { fetch: fetchImpl, now: () => 0, sleep: async () => {} },
    )
    const parsed = pageUrl(calls)
    expect(parsed.searchParams.has('search')).toBe(false)
    expect(parsed.searchParams.get('status')).toBe('latest')
    expect(page.dropped?.map((item) => item.key)).toEqual(['q'])
    expect(page.dropped?.[0]!.reason).toContain('поиск не работает')
  })

  it('чужое значение фильтра не сужает выдачу и объясняется', async () => {
    const { calls, fetchImpl } = stubUpstream()
    const page = await fetchAnimesPage(
      { query: { page: 1, limit: 20 }, filters: { 'filters.kind': 'zzz' } },
      { fetch: fetchImpl, now: () => 0, sleep: async () => {} },
    )
    expect(pageUrl(calls).searchParams.has('kind')).toBe(false)
    expect(page.dropped).toEqual([{ key: 'filters.kind', reason: 'значение вне опций или границ схемы' }])
  })
})
