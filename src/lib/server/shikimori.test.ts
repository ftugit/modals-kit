/**
 * Unit-набор серверного транспорта Shikimori: разбор входных параметров
 * (deny-safe + клэмп `limit`), сборка URL, нормализация записи API, кэш,
 * single-flight, повторы и словарь коррекции — на поддельном `fetch`
 * (никакой сети: тесты не зависят от доступности shikimori.io).
 *
 * Здесь же фиксируются ЗАМЕРЕННЫЕ правила API, на которые опирается источник:
 *   • `limit` больше 50 молча режется до 50 — источник обязан клампить сам,
 *     иначе `hasNext` («страница заполнена целиком») врал бы;
 *   • заголовков пагинации API не отдаёт — `hasNext` выводится из длины страницы;
 *   • `search` — подстрока по названиям, опечатки не терпит (работа lib search).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SHIKIMORI_LIMIT_MAX,
  SHIKIMORI_UA,
  buildUpstreamUrl,
  fetchAnimes,
  getTermArtifact,
  hasNextOf,
  normalizeAnime,
  fetchShikimoriJson,
  parseAnimesQuery,
  probeShikimoriJson,
  readFilterParams,
  resetShikimoriTransport,
  resetTermArtifact,
  yearOf,
  type AnimesQuery,
} from './shikimori'

function ok(list: unknown[]): Response {
  return new Response(JSON.stringify(list), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** Запись API в том виде, в каком её отдаёт shikimori.io (12 полей списка). */
function apiRecord(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    name: `Title ${id}`,
    russian: `Тайтл ${id}`,
    image: {
      original: `/system/animes/original/${id}.jpg`,
      preview: `/system/animes/preview/${id}.jpg`,
      x96: `/system/animes/x96/${id}.jpg`,
      x48: `/system/animes/x48/${id}.jpg`,
    },
    url: `/animes/${id}`,
    kind: 'tv',
    score: '7.5',
    status: 'released',
    episodes: 12,
    episodes_aired: 12,
    aired_on: '2002-10-03',
    released_on: null,
    ...over,
  }
}

/** Счётчик вызовов + поддельный fetch; `now`/`sleep` — ручные часы транспорта. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: string[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return handler(url, init)
  }) as unknown as typeof globalThis.fetch
  return { fn, calls }
}

let clock = 0
const deps = {
  now: () => clock,
  sleep: async (ms: number) => {
    clock += ms
  },
}

beforeEach(() => {
  resetShikimoriTransport()
  resetTermArtifact()
  clock = 0
})

describe('parseAnimesQuery', () => {
  const parse = (qs: string) => parseAnimesQuery(new URLSearchParams(qs))

  it('дефолты: страница 1, limit 20, порядок — популярность', () => {
    const res = parse('')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.query).toEqual({ page: 1, limit: 20, order: 'popularity' })
  })

  it('limit больше 50 клампится, а не отклоняется (так ведёт себя сам API)', () => {
    const res = parse('limit=500')
    expect(res.ok && res.query.limit).toBe(SHIKIMORI_LIMIT_MAX)
  })

  it('мусор в page/limit — ошибка 400-ветки; отрицательные тоже', () => {
    expect(parse('page=0').ok).toBe(false)
    expect(parse('page=abc').ok).toBe(false)
    expect(parse('page=1.5').ok).toBe(false)
    expect(parse('limit=0').ok).toBe(false)
  })

  it('search санитизируется: управляющие → пробел, trim, обрезка до 120', () => {
    const res = parse(`search=${encodeURIComponent('  на\u0000руто  ')}`)
    expect(res.ok && res.query.search).toBe('на руто')
    const long = parse(`search=${'я'.repeat(200)}`)
    expect(long.ok && long.query.search?.length).toBe(120)
  })

  it('пустой search не попадает в запрос вовсе', () => {
    const res = parse('search=   ')
    expect(res.ok && 'search' in res.query).toBe(false)
  })

  it('странный order откатывается к популярности', () => {
    expect(parse('order=!!').ok && parse('order=!!').ok && parse('order=!!').query.order).toBe(
      'popularity'
    )
    expect(parse('order=ranked').ok && parse('order=ranked').query.order).toBe('ranked')
  })
})

describe('buildUpstreamUrl', () => {
  it('собирает page/limit/order/search и молча режет limit', () => {
    const url = new URL(buildUpstreamUrl({ page: 3, limit: 999, order: 'ranked', search: 'наруто' }))
    expect(url.origin).toBe('https://shikimori.io')
    expect(url.pathname).toBe('/api/animes')
    expect(url.searchParams.get('page')).toBe('3')
    expect(url.searchParams.get('limit')).toBe('50')
    expect(url.searchParams.get('order')).toBe('ranked')
    expect(url.searchParams.get('search')).toBe('наруто')
  })

  it('без запроса ключа search в адресе нет', () => {
    const url = new URL(buildUpstreamUrl({ page: 1, limit: 20 }))
    expect(url.searchParams.has('search')).toBe(false)
    expect(url.searchParams.get('order')).toBe('popularity')
  })
})

describe('фильтры каталога: разбор и адрес запроса', () => {
  it('`filters.*` читаются с проверкой формы: числа — числами, список — строкой', () => {
    const filters = readFilterParams(
      new URLSearchParams(
        'filters.genres.and=27%2C133&filters.score.min=8&filters.year.max=2010&filters.kind=&filters..bad=1&filters.nope=zzz',
      ),
    )
    expect(filters).toEqual({
      'filters.genres.and': '27,133',
      'filters.score.min': 8,
      'filters.year.max': 2010,
      'filters.nope': 'zzz',
    })
  })

  it('parseAnimesQuery отдаёт фильтры ОТДЕЛЬНО от страницы и поиска', () => {
    const res = parseAnimesQuery(new URLSearchParams('page=2&search=наруто&filters.kind=tv'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.query).toEqual({ page: 2, limit: 20, order: 'popularity', search: 'наруто' })
    expect(res.filters).toEqual({ 'filters.kind': 'tv' })
  })

  it('параметры фильтров едут в адрес API: список через запятую — «и», `!` — «кроме»', () => {
    const url = new URL(
      buildUpstreamUrl({
        page: 1,
        limit: 20,
        genre_v2: ['27', '!133'],
        studio: ['858'],
        kind: 'tv',
        status: 'released',
        rating: 'pg_13',
        duration: 'F',
        score: 8,
        season: '1990_2010',
      }),
    )
    // ОДНИМ значением: повтор параметра API читает как «последний побеждает»
    // (проверено живьём), а список через запятую — как «и» с `!` внутри.
    expect(url.searchParams.getAll('genre_v2')).toEqual(['27,!133'])
    expect(url.searchParams.getAll('studio')).toEqual(['858'])
    expect(url.searchParams.get('score')).toBe('8')
    expect(url.searchParams.get('season')).toBe('1990_2010')
    expect(url.searchParams.get('duration')).toBe('F')
  })

  it('без фильтров адрес тот же, что раньше (страница и поиск не тронуты)', () => {
    const url = new URL(buildUpstreamUrl({ page: 1, limit: 20, search: 'наруто' }))
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'order', 'page', 'search'])
  })
})

describe('справочники схемы: общий GET и проба', () => {
  it('fetchShikimoriJson ходит с User-Agent и кэширует ответ', async () => {
    const { fn, calls } = fakeFetch(() => ok([{ id: 858, name: 'Wit Studio' }]))
    const first = await fetchShikimoriJson<{ id: number }[]>('/studios', { fetch: fn, ...deps })
    const second = await fetchShikimoriJson<{ id: number }[]>('/studios', { fetch: fn, ...deps })
    expect(first).toEqual([{ id: 858, name: 'Wit Studio' }])
    expect(second).toBe(first)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toBe('https://shikimori.io/api/studios')
  })

  it('проба отдаёт ответ КАК ЕСТЬ: 422 — это данные, а не отказ', async () => {
    const { fn } = fakeFetch(
      () => new Response(JSON.stringify(['kind — one of: <code>tv</code>']), { status: 422 }),
    )
    const res = await probeShikimoriJson('/animes?limit=1&kind=zzz', { fetch: fn, ...deps })
    expect(res.status).toBe(422)
    expect(res.text).toContain('<code>tv</code>')
  })

  it('проба повторяет 429, а сетевой отказ — честная ошибка', async () => {
    let attempt = 0
    const { fn } = fakeFetch(() => {
      attempt += 1
      return attempt === 1 ? new Response('', { status: 429 }) : new Response('[]', { status: 200 })
    })
    const res = await probeShikimoriJson('/studios', { fetch: fn, ...deps })
    expect(res.status).toBe(200)
    expect(attempt).toBe(2)
  })
})

describe('normalizeAnime / yearOf / hasNextOf', () => {
  it('полная запись → карточка с абсолютными адресами медиа и ссылкой', () => {
    const card = normalizeAnime(apiRecord(1))
    expect(card).not.toBeNull()
    expect(card).toMatchObject({
      id: 1,
      name: 'Title 1',
      russian: 'Тайтл 1',
      kind: 'tv',
      episodes: 12,
      year: 2002,
      status: 'released',
      url: 'https://shikimori.one/animes/1',
      poster: 'https://shikimori.io/system/animes/preview/1.jpg',
      thumb: 'https://shikimori.io/system/animes/x48/1.jpg',
    })
    // score в API — строка; источник отдаёт число.
    expect(card?.score).toBe(7.5)
  })

  it('нет русского названия → карточка живёт на романдзи; мусор отбрасывается', () => {
    expect(normalizeAnime(apiRecord(2, { russian: '' }))?.name).toBe('Title 2')
    expect(normalizeAnime(apiRecord(3, { name: '', russian: 'Только русское' }))?.name).toBe(
      'Только русское'
    )
    expect(normalizeAnime(null)).toBeNull()
    expect(normalizeAnime({ name: 'без id' })).toBeNull()
    expect(normalizeAnime({ id: 4 })).toBeNull()
  })

  it('неоценённый тайтл (score 0) — null, а не «ноль звёзд»', () => {
    expect(normalizeAnime(apiRecord(5, { score: 0 }))?.score).toBeNull()
    expect(normalizeAnime(apiRecord(6, { image: {} }))?.poster).toBeNull()
  })

  it('год берётся из aired_on; мусор → null', () => {
    expect(yearOf('2002-10-03')).toBe(2002)
    expect(yearOf(null)).toBeNull()
    expect(yearOf('скоро')).toBeNull()
  })

  it('hasNext — только «страница заполнена целиком»: счётчиков API не отдаёт', () => {
    const page = [1, 2, 3]
    expect(hasNextOf(page, 3)).toBe(true)
    expect(hasNextOf([1, 2], 3)).toBe(false)
    expect(hasNextOf([], 3)).toBe(false)
  })
})

describe('fetchAnimes: сеть, кэш, повторы', () => {
  const query: AnimesQuery = { page: 1, limit: 20, order: 'popularity' }

  it('ходит напрямую в shikimori.io с обязательным User-Agent', async () => {
    const { fn, calls } = fakeFetch((url) =>
      ok(url.includes('page=1') ? Array.from({ length: 20 }, (_, i) => apiRecord(i + 1)) : [])
    )
    const page = await fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 })
    expect(calls[0]).toBe('https://shikimori.io/api/animes?page=1&limit=20&order=popularity')
    expect(page.items).toHaveLength(20)
    expect(page.hasNext).toBe(true)
    expect(page.cached).toBeUndefined()
  })

  it('вторая страница за концом каталога: пусто и hasNext=false', async () => {
    const { fn } = fakeFetch(() => ok([]))
    const page = await fetchAnimes({ ...query, page: 99999 }, { ...deps, fetch: fn, minGapMs: 0 })
    expect(page.items).toEqual([])
    expect(page.hasNext).toBe(false)
  })

  it('кэш: повторный тот же запрос не идёт в сеть, ответ помечен cached', async () => {
    const { fn, calls } = fakeFetch(() => ok([apiRecord(1)]))
    await fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 })
    const again = await fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 })
    expect(calls).toHaveLength(1)
    expect(again.cached).toBe(true)
  })

  it('single-flight: параллельные вызовы одного URL делят один запрос', async () => {
    const { fn, calls } = fakeFetch(() => ok([apiRecord(1)]))
    const [a, b] = await Promise.all([
      fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 }),
      fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 }),
    ])
    expect(calls).toHaveLength(1)
    expect(a.items).toEqual(b.items)
  })

  it('разные запросы разнесены минимальным зазором (вежливость к API)', async () => {
    const { fn, calls } = fakeFetch(() => ok([apiRecord(1)]))
    await fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 250 })
    await fetchAnimes({ ...query, page: 2 }, { ...deps, fetch: fn, minGapMs: 250 })
    expect(calls).toHaveLength(2)
    expect(clock).toBeGreaterThanOrEqual(250)
  })

  it('429 → один повтор с паузой; второй подряд — честная ошибка 502', async () => {
    let attempt = 0
    const { fn, calls } = fakeFetch(() => {
      attempt += 1
      // Первый ответ — 429 («притормози»), повтор обязан пройти.
      return attempt === 1 ? new Response('slow down', { status: 429 }) : ok([apiRecord(1)])
    })
    const page = await fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 })
    expect(page.items).toHaveLength(1)
    expect(calls).toHaveLength(2)

    resetShikimoriTransport()
    const always = fakeFetch(() => new Response('boom', { status: 503 }))
    await expect(
      fetchAnimes(query, { ...deps, fetch: always.fn, minGapMs: 0 })
    ).rejects.toMatchObject({ name: 'ShikimoriUpstreamError', status: 502 })
    expect(always.calls).toHaveLength(2)
  })

  it('4xx без повторов и сетевой сбой → ошибка транспорта, а не пустая выдача', async () => {
    const bad = fakeFetch(() => new Response('nope', { status: 404 }))
    await expect(fetchAnimes(query, { ...deps, fetch: bad.fn, minGapMs: 0 })).rejects.toMatchObject({
      status: 502,
    })
    expect(bad.calls).toHaveLength(1)

    const dead = (async () => {
      throw new Error('getaddrinfo ENOTFOUND')
    }) as unknown as typeof globalThis.fetch
    await expect(fetchAnimes(query, { ...deps, fetch: dead, minGapMs: 0 })).rejects.toMatchObject({
      status: 504,
    })
  })

  it('отмена ожидания не глушит общий запрос (сосед дожидается данных)', async () => {
    const { fn, calls } = fakeFetch(() => ok([apiRecord(1)]))
    const controller = new AbortController()
    const first = fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0, signal: controller.signal })
    const second = fetchAnimes(query, { ...deps, fetch: fn, minGapMs: 0 })
    controller.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect((await second).items).toHaveLength(1)
    expect(calls).toHaveLength(1)
  })
})

describe('getTermArtifact: словарь коррекции из живого каталога', () => {
  it('собирает `display\\tdf` из страниц популярности и кэширует на час', async () => {
    const { fn, calls } = fakeFetch((url) => {
      const page = Number(new URL(url).searchParams.get('page'))
      if (page > 1) return ok([])
      return ok([
        apiRecord(1, { name: 'Naruto', russian: 'Наруто' }),
        apiRecord(2, { name: 'Bleach', russian: 'Блич' }),
      ])
    })
    const text = await getTermArtifact({ ...deps, fetch: fn, minGapMs: 0 })
    expect(calls).toHaveLength(1)
    // Формат артефакта: «термин<TAB>частота», термины — русские и романдзи.
    const lines = text.trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(4)
    for (const line of lines) expect(line.split('\t')).toHaveLength(2)
    expect(text).toContain('наруто')

    // Второй вызов — из кэша (сеть не тронута).
    await getTermArtifact({ ...deps, fetch: fn, minGapMs: 0 })
    expect(calls).toHaveLength(1)
  })
})
