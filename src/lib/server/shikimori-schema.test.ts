/**
 * Зона схемы: сборка из живых справочников, деградация oversized-полей,
 * связки, метка `builtAt`, TTL и «ровно один обновляющий запрос».
 *
 * Внешний API подменяется фейковым fetch'ем: проверяется ПОВЕДЕНИЕ зоны
 * (что читается, что отдаётся клиенту, сколько запросов уходит), а не чужой
 * сервис.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SHIKIMORI_SCHEMA_TTL_MS,
  buildShikimoriFilterSchema,
  getShikimoriFilterSchema,
  parseEnumMessage,
  readShikimoriRefs,
  resetShikimoriFilterSchema,
} from './shikimori-schema'
import { resetShikimoriTransport } from './shikimori'
import { makeUpstream } from './fetch'
import { memoryStore } from '#lib/cache/index.js'
import { resetGraphqlTransport } from './graphql'
import {
  CATALOG_FILTER_OPTIONS_LIMIT,
  catalogFilterFieldNames,
  catalogFilterOptionsAreComplete,
} from '#lib/paginate/filters/index.js'

/**
 * Тексты 422 ровно в том виде, в каком их отдаёт API (записаны живьём,
 * `probes-shiki/raw-enum-probe.mjs`): JSON-массив строк, внутри — `included_in?`.
 */
const ENUM_MESSAGES: Record<string, string> = {
  kind: JSON.stringify([
    'Invalid kind value "zzz". "zzz" violates constraints (included_in?([:tv, :movie, :ova], :zzz) failed)',
  ]),
  status: JSON.stringify([
    'Invalid status value "zzz". "zzz" violates constraints (included_in?([:anons, :ongoing, :released, :latest], :zzz) failed)',
  ]),
  rating: JSON.stringify([
    'Invalid rating value "zzz". "zzz" violates constraints (included_in?([:none, :rx], :zzz) failed)',
  ]),
  duration: JSON.stringify([
    'Invalid duration value "zzz". "zzz" violates constraints (included_in?([:S, :F], :zzz) failed)',
  ]),
}

type Stub = { graphql: number; rest: number; urls: string[]; queries: string[] }

function stubUpstream(studios: { id: number; name: string }[]) {
  const calls: Stub = { graphql: 0, rest: 0, urls: [], queries: [] }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      calls.graphql += 1
      const body = JSON.parse(String(init.body)) as { query: string; variables?: { page?: number } }
      calls.queries.push(body.query)
      // Проба enum'а через GraphQL: API отвечает 500 с перечнем в errors (записано живьём 2026-10-13).
      const probe = /animes\((kind|status|rating|duration): "zzz"/.exec(body.query)?.[1]
      if (probe) {
        const message = JSON.parse(ENUM_MESSAGES[probe]!)[0] as string
        return json({ errors: [{ exception: 'InvalidParameterError', message }] }, 500)
      }
      if (body.query.includes('order: aired_on')) return json({ data: { animes: [{ airedOn: { year: 2027 } }] } })
      if (body.query.includes('genres(entryType: Anime)')) {
        return json({ data: { genres: [{ id: '27', name: 'Shounen', russian: 'Сёнен' }, { id: '133', name: 'Isekai', russian: null }] } })
      }
      const page = body.variables?.page ?? 1
      return json({
        data: {
          animes:
            page === 1
              ? [{ genres: [{ id: '27' }, { id: '27' }], studios: [{ id: '858' }] }]
              : page === 2
                ? [{ genres: [{ id: '133' }], studios: [{ id: '858' }] }]
                : [],
        },
      })
    }
    calls.rest += 1
    calls.urls.push(url)
    if (url.includes('/studios')) return json(studios)
    if (url.endsWith('/genres')) {
      return json([
        { id: 8, name: 'Drama', russian: 'Драма', kind: 'genre', entry_type: 'Anime' },
        { id: 89, name: 'Police', russian: 'Полиция', kind: 'genre', entry_type: 'Manga' },
        { id: 27, name: 'Shounen', russian: '', kind: 'genre', entry_type: 'Anime' },
      ])
    }
    if (url.includes('order=aired_on')) return json([{ aired_on: '2028-01-01' }])
    const name = /[?&](kind|status|rating|duration)=/.exec(url)?.[1]
    if (name) return new Response(ENUM_MESSAGES[name]!, { status: 422 })
    throw new Error(`неожиданный запрос: ${url}`)
  }) as unknown as typeof globalThis.fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** Часы схемы и кэшей транспорта — одни: после TTL схемы устаревают и справочники. */
function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    store: memoryStore({ now: () => t }),
    advance: (ms: number) => {
      t += ms
    },
  }
}

beforeEach(() => {
  resetShikimoriTransport()
  resetGraphqlTransport()
  resetShikimoriFilterSchema()
})

describe('разбор текста 422', () => {
  it('понимает `included_in?([:a, :b])`', () => {
    expect(parseEnumMessage(JSON.stringify(['x - included_in?([:anons, :latest])']))).toEqual(['anons', 'latest'])
  })

  it('понимает список `<code>…</code>`', () => {
    expect(parseEnumMessage('Must be one of: <code>S</code> <code>D</code>')).toEqual(['S', 'D'])
  })
})

describe('живые справочники', () => {
  it('жанры, студии, enum' + 'ы и частоты читаются из API', async () => {
    const c = clock()
    const { fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const refs = await readShikimoriRefs({ fetch: fetchImpl })
    expect(refs.genres).toEqual([
      { id: '27', label: 'Сёнен' },
      { id: '133', label: 'Isekai' },
    ])
    expect(refs.studios).toEqual([{ id: '858', label: 'Wit Studio' }])
    expect(refs.enums.status).toEqual(['anons', 'ongoing', 'released', 'latest'])
    expect(refs.enums.rating).toEqual(['none', 'rx'])
    // Частоты: жанр 27 встретился дважды на первой странице выборки, 133 — раз.
    expect(refs.counts.get('genres:27')).toBe(2)
    expect(refs.counts.get('genres:133')).toBe(1)
    expect(refs.counts.get('studios:858')).toBe(2)
    expect(refs.newestYear).toBe(2028)
  })
})

describe('параллельная сборка (P2)', () => {
  it.each(['mix', 'rest', 'graphql'] as const)('%s: все запросы сборки стартуют сразу, справочники не ждут остальное', async (api) => {
    // Сколько запросов делает полная сборка — замер обычным прогоном.
    const plain = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const expected = await readShikimoriRefs({ fetch: plain.fetchImpl }, api)
    const total = plain.calls.rest + plain.calls.graphql
    // Замер наполнил кэши транспорта — без сброса второй прогон взял бы
    // справочники из них и не дошёл бы до сети.
    await resetShikimoriTransport()
    await resetGraphqlTransport()

    // Теперь ни один ответ не приходит, пока не открыт шлюз: если какой-то
    // запрос ждёт другого, к открытию шлюза он ещё не стартовал.
    const gated = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    let started = 0
    const held = (async (input: RequestInfo | URL, init?: RequestInit) => {
      started += 1
      await gate
      return gated.fetchImpl(input, init)
    }) as typeof fetch
    const running = readShikimoriRefs({ fetch: held }, api)
    // Ключ кэша считается асинхронным хэшем — до `fetch` запросы доходят не за
    // один тик. Ждём, пока число стартовавших перестанет расти (до 1 с).
    for (let i = 0; i < 100 && started < total; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(started).toBe(total)
    open()
    expect(await running).toEqual(expected)
  })
})

describe('сборка схемы', () => {
  it('поля схемы = объявленный состав, значения — из справочников', async () => {
    const c = clock()
    const { fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const refs = await readShikimoriRefs({ fetch: fetchImpl })
    const schema = buildShikimoriFilterSchema(refs, '2026-10-07T09:00:00.000Z')

    expect(schema.source).toBe('shikimori')
    expect(schema.builtAt).toBe('2026-10-07T09:00:00.000Z')
    expect(schema.fields.map((field) => field.key)).toEqual([
      'genres',
      'studios',
      'kind',
      'status',
      'rating',
      'duration',
      'score',
      'year',
    ])
    const genres = schema.fields[0]!
    expect(genres.type).toBe('multiselect')
    expect(genres.modes).toEqual(['and', 'not'])
    expect(genres.options?.[0]).toEqual({ value: '27', label: 'Сёнен', count: 2 })
    expect(catalogFilterFieldNames(genres)).toEqual(['filters.genres.and', 'filters.genres.not'])
    expect(schema.fields[7]).toMatchObject({ min: 1900, max: 2028 })
    expect(schema.fields[6]).toMatchObject({ min: 1, max: 10, bounds: ['min'] })
    expect(schema.rules?.map((rule) => rule.id)).toEqual(['search-with-latest', 'score-with-anons'])
  })

  it('все студии едут в схеме целиком: частые первыми, дальше по подписи (первые 200 — список без JS)', async () => {
    // как у живого источника: ~2000 студий, частота есть только у попавших в выборку
    const studios = Array.from({ length: 1934 }, (_, i) => ({ id: i + 1, name: `Студия ${String(1934 - i).padStart(4, '0')}` }))
    const { fetchImpl } = stubUpstream(studios)
    const c = clock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refs = await readShikimoriRefs({ fetch: fetchImpl })
    const schema = buildShikimoriFilterSchema(refs, '2026-10-07T09:00:00.000Z')
    const field = schema.fields.find((item) => item.key === 'studios')!
    expect(field.options).toHaveLength(1934)
    expect(field.optionsTruncated).toBeUndefined()
    expect(catalogFilterOptionsAreComplete(field)).toBe(true)
    expect(field.options![0]).toMatchObject({ value: '858', count: 2 }) // из выборки популярности
    expect(field.options!.slice(1, 3).map((o) => o.label)).toEqual(['Студия 0001', 'Студия 0002'])
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('справочник сверх предела схемы (5000) деградирует, а не роняет транспорт', async () => {
    const studios = Array.from({ length: CATALOG_FILTER_OPTIONS_LIMIT + 3 }, (_, i) => ({ id: i + 1, name: `Студия ${i + 1}` }))
    const { fetchImpl } = stubUpstream(studios)
    const c = clock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refs = await readShikimoriRefs({ fetch: fetchImpl })
    const schema = buildShikimoriFilterSchema(refs, '2026-10-07T09:00:00.000Z')
    const field = schema.fields.find((item) => item.key === 'studios')!
    expect(field.options).toHaveLength(CATALOG_FILTER_OPTIONS_LIMIT)
    expect(field.optionsTruncated).toBe(3)
    expect(field.options![0]!.value).toBe('858')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('кэш схемы', () => {
  it('свежая схема не читает справочники повторно, после TTL — читает', async () => {
    const c = clock()
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const first = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, store: c.store })
    const reads = calls.graphql + calls.rest
    expect(reads).toBeGreaterThan(0)

    const second = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, store: c.store })
    expect(second).toBe(first)
    expect(calls.graphql + calls.rest).toBe(reads)

    c.advance(SHIKIMORI_SCHEMA_TTL_MS + 1)
    const third = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, store: c.store })
    expect(third.builtAt).not.toBe(first.builtAt)
    expect(calls.graphql + calls.rest).toBeGreaterThan(reads)
  })

  it('одновременные обращения делят ОДНУ сборку', async () => {
    const clk = clock()
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const deps = { fetch: fetchImpl, now: clk.now, store: clk.store }
    const [a, b, c] = await Promise.all([
      getShikimoriFilterSchema(deps),
      getShikimoriFilterSchema(deps),
      getShikimoriFilterSchema(deps),
    ])
    expect(a).toBe(b)
    expect(b).toBe(c)
    // Жанры + три страницы выборки: по одному запросу на страницу, не на вызов.
    expect(calls.graphql).toBe(4)
  })

  it('упавшее обновление отдаёт предыдущую схему с её меткой', async () => {
    const c = clock()
    const ok = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const first = await getShikimoriFilterSchema({ fetch: ok.fetchImpl, now: c.now, store: c.store })
    c.advance(SHIKIMORI_SCHEMA_TTL_MS + 1)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = makeUpstream(async () => {
      throw new Error('сеть упала')
    }, { sleep: async () => {} })
    const second = await getShikimoriFilterSchema({ fetch: failing, now: c.now, store: c.store })
    expect(second).toBe(first)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('первая сборка без кэша падает честной ошибкой', async () => {
    const failing = makeUpstream(async () => {
      throw new Error('сеть упала')
    }, { sleep: async () => {} })
    await expect(getShikimoriFilterSchema({ fetch: failing })).rejects.toThrow(/недоступен/)
  })
})

describe('три версии API (ход 85, вариант «c» хода 96)', () => {
  it('rest: только REST — жанры v1 аниме из /genres, студии, enum по 422; частот нет', async () => {
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const refs = await readShikimoriRefs({ fetch: fetchImpl }, 'rest')
    expect(calls.graphql).toBe(0)
    // Манга из общего справочника отсеяна; пустой russian → name.
    expect(refs.genres).toEqual([
      { id: '8', label: 'Драма' },
      { id: '27', label: 'Shounen' },
    ])
    expect(refs.studios).toEqual([{ id: '858', label: 'Wit Studio' }])
    expect(refs.enums.status).toEqual(['anons', 'ongoing', 'released', 'latest'])
    expect(refs.counts.size).toBe(0)
    expect(refs.newestYear).toBe(2028)
    const schema = buildShikimoriFilterSchema(refs, '2026-10-13T09:00:00.000Z', 'rest')
    expect(schema.source).toBe('shikimori-rest')
    expect(schema.fields.map((field) => field.key)).toContain('studios')
  })

  it('graphql: только GraphQL — студий нет ни в справочниках, ни в схеме', async () => {
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const refs = await readShikimoriRefs({ fetch: fetchImpl }, 'graphql')
    expect(calls.rest).toBe(0)
    expect(refs.studios).toEqual([])
    expect(refs.genres.map((genre) => genre.id)).toEqual(['27', '133'])
    expect(refs.enums.kind).toEqual(['tv', 'movie', 'ova'])
    expect(refs.enums.duration).toEqual(['S', 'F'])
    expect(refs.counts.get('genres:27')).toBe(2)
    expect(refs.newestYear).toBe(2027)
    // Выборка этой версии студий не спрашивает.
    expect(calls.queries.filter((q) => q.includes('studios'))).toEqual([])

    const schema = buildShikimoriFilterSchema(refs, '2026-10-13T09:00:00.000Z', 'graphql')
    expect(schema.source).toBe('shikimori-graphql')
    expect(schema.fields.map((field) => field.key)).toEqual([
      'genres', 'kind', 'status', 'rating', 'duration', 'score', 'year',
    ])
    expect(schema.fields.flatMap(catalogFilterFieldNames).some((name) => name.includes('studios'))).toBe(false)
  })

  it('graphql: 500 пробы — это ответ, а не сбой: без повторов (один запрос на справочник)', async () => {
    const { calls, fetchImpl } = stubUpstream([])
    const fetch = makeUpstream(fetchImpl, { sleep: async () => {} })
    await readShikimoriRefs({ fetch }, 'graphql')
    for (const name of ['kind', 'status', 'rating', 'duration']) {
      expect(calls.queries.filter((q) => q.includes(`${name}: "zzz"`))).toHaveLength(1)
    }
  })

  it('graphql: проба без перечня в ответе — честная ошибка', async () => {
    const fetch = makeUpstream(async () => json({ errors: [{ message: 'что-то иное' }] }, 500), { sleep: async () => {} })
    await expect(readShikimoriRefs({ fetch }, 'graphql')).rejects.toThrow()
  })

  it('кэш схем — у каждой версии свой: схема одной не отдаётся за другую', async () => {
    const c = clock()
    const { fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const deps = { fetch: fetchImpl, now: c.now, store: c.store }
    const mix = await getShikimoriFilterSchema(deps)
    const graphql = await getShikimoriFilterSchema({ ...deps, api: 'graphql' })
    const rest = await getShikimoriFilterSchema({ ...deps, api: 'rest' })
    expect([mix.source, graphql.source, rest.source]).toEqual(['shikimori', 'shikimori-graphql', 'shikimori-rest'])
    expect(await getShikimoriFilterSchema({ ...deps, api: 'graphql' })).toBe(graphql)
    expect(await getShikimoriFilterSchema(deps)).toBe(mix)
  })
})
