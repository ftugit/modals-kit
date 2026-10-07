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
import { resetGraphqlTransport } from './graphql'
import { catalogFilterFieldNames } from '$lib/filters'

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

type Stub = { graphql: number; rest: number }

function stubUpstream(studios: { id: number; name: string }[]) {
  const calls: Stub = { graphql: 0, rest: 0 }
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (init?.method === 'POST') {
      calls.graphql += 1
      const body = JSON.parse(String(init.body)) as { query: string; variables?: { page?: number } }
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
    if (url.includes('/studios')) return json(studios)
    if (url.includes('order=aired_on')) return json([{ aired_on: '2028-01-01' }])
    const name = /[?&](kind|status|rating|duration)=/.exec(url)?.[1]
    if (name) return new Response(ENUM_MESSAGES[name]!, { status: 422 })
    throw new Error(`неожиданный запрос: ${url}`)
  }) as unknown as typeof globalThis.fetch
  return { calls, fetchImpl }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function clock(start = 1_000_000) {
  let t = start
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
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
    const refs = await readShikimoriRefs({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
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

describe('сборка схемы', () => {
  it('поля схемы = объявленный состав, значения — из справочников', async () => {
    const c = clock()
    const { fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const refs = await readShikimoriRefs({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
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

  it('гигантский справочник студий деградирует, а не роняет транспорт', async () => {
    const studios = Array.from({ length: 1200 }, (_, i) => ({ id: i + 1, name: `Студия ${String(i + 1).padStart(4, '0')}` }))
    const { fetchImpl } = stubUpstream(studios)
    const c = clock()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refs = await readShikimoriRefs({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
    const schema = buildShikimoriFilterSchema(refs, '2026-10-07T09:00:00.000Z')
    const field = schema.fields.find((item) => item.key === 'studios')!
    expect(field.options).toHaveLength(1000)
    expect(field.optionsTruncated).toBe(200)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('кэш схемы', () => {
  it('свежая схема не читает справочники повторно, после TTL — читает', async () => {
    const c = clock()
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const first = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
    const reads = calls.graphql + calls.rest
    expect(reads).toBeGreaterThan(0)

    const second = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
    expect(second).toBe(first)
    expect(calls.graphql + calls.rest).toBe(reads)

    c.advance(SHIKIMORI_SCHEMA_TTL_MS + 1)
    const third = await getShikimoriFilterSchema({ fetch: fetchImpl, now: c.now, sleep: c.sleep })
    expect(third.builtAt).not.toBe(first.builtAt)
    expect(calls.graphql + calls.rest).toBeGreaterThan(reads)
  })

  it('одновременные обращения делят ОДНУ сборку', async () => {
    const clk = clock()
    const { calls, fetchImpl } = stubUpstream([{ id: 858, name: 'Wit Studio' }])
    const deps = { fetch: fetchImpl, now: clk.now, sleep: clk.sleep }
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
    const first = await getShikimoriFilterSchema({ fetch: ok.fetchImpl, now: c.now, sleep: c.sleep })
    c.advance(SHIKIMORI_SCHEMA_TTL_MS + 1)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const failing = (async () => {
      throw new Error('сеть упала')
    }) as unknown as typeof globalThis.fetch
    const second = await getShikimoriFilterSchema({ fetch: failing, now: c.now, sleep: c.sleep, retryDelayMs: 1 })
    expect(second).toBe(first)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('первая сборка без кэша падает честной ошибкой', async () => {
    const failing = (async () => {
      throw new Error('сеть упала')
    }) as unknown as typeof globalThis.fetch
    await expect(getShikimoriFilterSchema({ fetch: failing, retryDelayMs: 1 })).rejects.toThrow(/недоступен/)
  })
})
