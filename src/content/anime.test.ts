/**
 * Проверки источника Shikimori: нормализация входа, разбор ответа, честный
 * `hasNext` (перезапрос на элемент больше), шлюз/повторы 429 и артефакт
 * словаря. Сеть не нужна — `fetch` подменяется заглушкой, как и в контуре
 * эндпоинта (туда приходит `event.fetch`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ANIME_MAX_LIMIT,
  ANIME_TERM_PAGES,
  ANIME_USER_AGENT,
  animePageFromNodes,
  animeTermArtifact,
  fetchAnimePage,
  getAnimeTermArtifact,
  mapAnimeNode,
  normalizeAnimeQuery,
  resetAnimeCaches,
  sanitizeAnimeQuery,
} from './anime'

// Кэши модуля (страницы/словарь) — сквозные для файла: чистим между проверками.
beforeEach(() => resetAnimeCaches())
import { foldKey, parseTermDictionary } from '$lib/search/fuzzy'

const node = (over: Record<string, unknown> = {}) => ({
  id: '20',
  name: 'Naruto',
  russian: 'Наруто',
  english: 'Naruto',
  japanese: 'ナルト',
  synonyms: ['NARUTO', 'Наруто'],
  kind: 'tv',
  episodes: 220,
  score: 8.02,
  releasedOn: { year: 2007 },
  poster: { mainUrl: 'https://shikimori.io/uploads/poster/animes/20/main.webp' },
  url: 'https://shikimori.io/animes/z20-naruto',
  ...over,
})

describe('anime: нормализация входа', () => {
  it('страница ≥ 1, limit клампится потолком API, мусор → дефолты', () => {
    expect(normalizeAnimeQuery({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10, q: undefined })
    expect(normalizeAnimeQuery({ page: 0, limit: 0 })).toEqual({ page: 1, limit: 1, q: undefined })
    expect(normalizeAnimeQuery({ page: -5, limit: -1 })).toEqual({ page: 1, limit: 1, q: undefined })
    expect(normalizeAnimeQuery({ page: '2.7', limit: '999' })).toEqual({ page: 2, limit: ANIME_MAX_LIMIT, q: undefined })
    expect(normalizeAnimeQuery({ page: 'abc', limit: null })).toEqual({ page: 1, limit: 20, q: undefined })
  })

  it('запрос санитаризуется: управляющие, обрезка, пустое → undefined', () => {
    expect(sanitizeAnimeQuery('  наруто  ')).toBe('наруто')
    expect(sanitizeAnimeQuery('на\u0000ру\u007fто')).toBe('на ру то')
    expect(sanitizeAnimeQuery('')).toBeUndefined()
    expect(sanitizeAnimeQuery('   ')).toBeUndefined()
    expect(sanitizeAnimeQuery(42)).toBeUndefined()
    expect(sanitizeAnimeQuery('я'.repeat(200))?.length).toBe(120)
  })
})

describe('anime: разбор ответа GraphQL', () => {
  it('название — русское, иначе оригинальное; aliases дедуплицированы', () => {
    const record = mapAnimeNode(node())!
    expect(record.title).toBe('Наруто')
    expect(record.aliases).toEqual(['Naruto', 'Наруто', 'ナルト', 'NARUTO'])
    expect(record.year).toBe(2007)
    expect(record.poster).toContain('/uploads/poster/')
    expect(record.episodes).toBe(220)

    const latin = mapAnimeNode(node({ russian: null, english: null, japanese: null, synonyms: [] }))!
    expect(latin.title).toBe('Naruto')
    expect(mapAnimeNode(node({ russian: null, name: null, english: 'X' }))!.title).toBe('X')
    expect(mapAnimeNode(node({ russian: null, name: null, english: null }))!.title).toBe('20')
  })

  it('битые узлы отбрасываются, отсутствующие поля не ломают запись', () => {
    expect(mapAnimeNode(null)).toBeNull()
    expect(mapAnimeNode({ name: 'без id' })).toBeNull()
    const sparse = mapAnimeNode({ id: 7 })!
    expect(sparse).toMatchObject({ id: '7', title: '7', aliases: [] })
    expect(sparse.poster).toBeUndefined()
    expect(sparse.year).toBeUndefined()
  })

  it('hasNext — перезапрос на элемент больше: лишний отбрасывается', () => {
    const page = animePageFromNodes([node({ id: 1 }), node({ id: 2 }), node({ id: 3 })], 2)
    expect(page.items.map((item) => item.id)).toEqual(['1', '2'])
    expect(page.hasNext).toBe(true)

    const last = animePageFromNodes([node({ id: 1 }), node({ id: 2 })], 2)
    expect(last.items.map((item) => item.id)).toEqual(['1', '2'])
    expect(last.hasNext).toBe(false)

    expect(animePageFromNodes([], 20)).toEqual({ items: [], hasNext: false })
  })
})

describe('anime: запрос к API', () => {
  const jsonResponse = (payload: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json', ...headers } })

  it('спрашивает limit + 1 (не выше потолка), search и order=popularity, шлёт User-Agent', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse({ data: { animes: [node({ id: '1' }), node({ id: '2' })] } })
    })
    const page = await fetchAnimePage({ page: 1, limit: 1, q: 'наруто' }, { fetchImpl })
    expect(page.items.map((item) => item.id)).toEqual(['1'])
    expect(page.hasNext).toBe(true)
    expect(calls.length).toBe(1)
    expect(calls[0].url).toContain('shikimori.io/api/graphql')
    const body = JSON.parse(String(calls[0].init.body))
    expect(body.variables).toMatchObject({ page: 1, limit: 2, search: 'наруто', order: 'popularity' })
    expect((calls[0].init.headers as Record<string, string>)['user-agent']).toBe(ANIME_USER_AGENT)

    // Потолок API: просили 50 → перезапрос на 51 невозможен, берём ровно 50.
    const dense = vi.fn(async () => jsonResponse({ data: { animes: [node({ id: '3' })] } }))
    await fetchAnimePage({ page: 2, limit: ANIME_MAX_LIMIT }, { fetchImpl: dense })
    expect(JSON.parse(String(dense.mock.calls[0][1]!.body)).variables.limit).toBe(ANIME_MAX_LIMIT)
  })

  it('429 — повтор с паузой из retry-after, затем успех', async () => {
    let attempt = 0
    const fetchImpl = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) return jsonResponse({}, 429, { 'retry-after': '0.01' })
      return jsonResponse({ data: { animes: [node({ id: '9' })] } })
    })
    const page = await fetchAnimePage({ page: 3, limit: 5, q: 'ретрай' }, { fetchImpl })
    expect(page.items.map((item) => item.id)).toEqual(['9'])
    expect(attempt).toBe(2)
  })

  it('ошибки GraphQL и HTTP не глотаются — они станут строкой ошибки пагинатора', async () => {
    const graphql = vi.fn(async () => jsonResponse({ errors: [{ message: 'слишком много запросов' }] }))
    await expect(fetchAnimePage({ page: 4, limit: 5, q: 'ошибка-граф' }, { fetchImpl: graphql })).rejects.toThrow(
      'слишком много запросов',
    )
    const broken = vi.fn(async () => new Response('нет', { status: 500 }))
    await expect(fetchAnimePage({ page: 4, limit: 5, q: 'ошибка-хттп' }, { fetchImpl: broken })).rejects.toThrow(
      'ответил 500',
    )
    const noData = vi.fn(async () => jsonResponse({ data: {} }))
    await expect(fetchAnimePage({ page: 4, limit: 5, q: 'ошибка-данных' }, { fetchImpl: noData })).rejects.toThrow(
      'нет data.animes',
    )
  })

  it('повторный запрос той же страницы берётся из кэша (SSR + гидратация не дублируют API)', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { animes: [node({ id: '11' })] } }))
    const first = await fetchAnimePage({ page: 7, limit: 4, q: 'кэш' }, { fetchImpl })
    const second = await fetchAnimePage({ page: 7, limit: 4, q: 'кэш' }, { fetchImpl })
    expect(second).toEqual(first)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('anime: словарь терминов', () => {
  it('артефакт собирается из title + aliases и читается обратно', () => {
    const text = animeTermArtifact([
      { id: '1', title: 'Наруто', aliases: ['Naruto'] },
      { id: '2', title: 'Атака титанов', aliases: ['Shingeki no Kyojin', 'Вторжение гигантов'] },
    ])
    const dict = parseTermDictionary(text)
    // Ключи словаря — через foldKey: латиница складывается с кириллицей-гомоглифами.
    expect(dict.get(foldKey('наруто'))?.df).toBe(1)
    expect(dict.get(foldKey('титанов'))?.df).toBe(1)
    expect(dict.get(foldKey('shingeki'))?.df).toBe(1)
    expect([...dict.keys()].every((key) => key.length >= 2)).toBe(true)
  })

  it('пустой каталог → пустой артефакт', () => {
    expect(animeTermArtifact([])).toBe('')
  })

  it('отдаёт образец популярных страниц и кэширует его', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls += 1
      const variables = JSON.parse(String(init.body)).variables as { page: number }
      return new Response(
        JSON.stringify({ data: { animes: [node({ id: String(100 + variables.page), russian: `Тайтл ${variables.page}` })] } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    })
    const text = await getAnimeTermArtifact({ fetchImpl })
    expect(calls).toBe(ANIME_TERM_PAGES)
    expect(parseTermDictionary(text).size).toBeGreaterThan(0)
    const again = await getAnimeTermArtifact({ fetchImpl })
    expect(again).toBe(text)
    expect(calls).toBe(ANIME_TERM_PAGES) // второй раз — из кэша
  })
})
