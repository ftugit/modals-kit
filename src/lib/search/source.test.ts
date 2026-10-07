/**
 * Декоратор поиска поверх АДАПТИРОВАННОГО источника: `withSearch`.
 *
 * Контур fuzzy по архитектуре только клиентский (`import.meta.env.SSR ||
 * typeof window === 'undefined'` → родной поиск), поэтому клиентские сценарии
 * включают окружение браузера явно (`withClientEnv`). SSR-граница пинится
 * отдельным тестом: сервер не строит словарь и не накапливает батчи.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineSource } from '$lib/paginate'
import type { SourceFuzzySpec } from '$lib/paginate/types'
import { withSearch } from './source'
import { getSearchCorrection, getSearchStats, reportSearchStats } from './registry'

type Record_ = { id: string; title: string }

const RECORDS: Record_[] = [
  { id: '1', title: 'Наруто' },
  { id: '2', title: 'Тетрадь смерти' },
  { id: '3', title: 'Нарутару' },
]

const fuzzy: SourceFuzzySpec<Record_> = {
  id: (record) => record.id,
  texts: (record) => [record.title],
  batchSize: 50,
}

/** Базовый источник: серверное сужение подстрокой (контур SSR/no-JS). */
function catalogueSource() {
  const calls: { page: number; pageSize: number; q?: unknown }[] = []
  const source = defineSource<Record_>({
    id: 'catalogue',
    label: 'Каталог',
    dataKeys: ['q'],
    search: { fuzzy },
    page: async ({ page, pageSize, extra }) => {
      calls.push({ page, pageSize, q: extra?.q })
      const q = typeof extra?.q === 'string' ? extra.q.toLowerCase() : ''
      const rows = q ? RECORDS.filter((r) => r.title.toLowerCase().includes(q)) : RECORDS
      const from = (page - 1) * pageSize
      const items = rows.slice(from, from + pageSize)
      return { items, hasNext: from + items.length < rows.length }
    },
  })
  return { source, calls }
}

/** Источник «просто данные»: спецификации поиска нет. */
function dataOnlySource() {
  return defineSource<Record_>({
    id: 'data-only',
    label: 'Данные',
    totals: true,
    page: async ({ page, pageSize }) => ({
      items: RECORDS.slice((page - 1) * pageSize, page * pageSize),
      totalItems: RECORDS.length,
    }),
  })
}

function withClientEnv(): void {
  vi.stubEnv('SSR', false)
  vi.stubGlobal('window', {})
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('withSearch: усиление адаптированного источника', () => {
  it('обычную функцию усилить нельзя — нужен адаптированный источник', () => {
    const plain = async () => ({ items: [] })
    expect(() => withSearch(plain as never, { name: 'x' })).toThrow(/defineSource/)
  })

  it('источник без спецификации перехвата проходит сквозь, статистика гаснет', async () => {
    reportSearchStats(
      'plain-name',
      { scanned: 3, matched: 2, emitted: 1, sourcePage: 1, exhausted: false },
    )
    const source = withSearch(dataOnlySource(), { name: 'plain-name' })
    const res = await source.page({ page: 1, pageSize: 2, extra: { q: 'нарута' } })
    expect(res.items).toHaveLength(2)
    expect(res.totalItems).toBe(3)
    expect(getSearchStats('plain-name')).toBeNull()
    expect(getSearchCorrection('plain-name')).toBeNull()
  })

  it('возможности, ключи данных и ключи возможностей сохраняются', () => {
    const { source: base } = catalogueSource()
    const source = withSearch(base, { name: 'caps' })
    expect(source.capabilitiesFor({})).toEqual(base.capabilitiesFor({}))
    expect(source.dataKeys).toEqual(base.dataKeys)
    expect(source.capabilityKeys).toEqual(base.capabilityKeys)
    expect(source.page).not.toBe(base.page)
  })

  it('SSR-контур: запрос уходит источнику как есть, батчей и коррекции нет', async () => {
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, {
      name: 'ssr',
      correct: () => async (query: string) => ({ query, corrected: 'наруто', changed: true }),
    })
    const res = await source.page({ page: 2, pageSize: 20, extra: { q: 'нарута', kind: 'tv' } })
    expect(calls).toEqual([{ page: 2, pageSize: 20, q: 'нарута' }])
    expect(res.items).toEqual([])
    expect(getSearchCorrection('ssr')).toBeNull()
    expect(getSearchStats('ssr')).toBeNull()
  })

  it('клиент с запросом: батчи по бюджету источника, статистика жива', async () => {
    withClientEnv()
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, { name: 'client' })
    const res = await source.page({ page: 1, pageSize: 20, extra: { q: 'нарут' } })
    // Опечатка не мешает: fuzzy нашёл и «Наруто», и «Нарутару».
    expect(res.items.map((r) => r.id).sort()).toEqual(['1', '3'])
    // Батч — потолок источника (50), а не размер страницы пагинатора.
    expect(calls.every((call) => call.pageSize === 50)).toBe(true)
    const stats = getSearchStats('client')
    expect(stats).not.toBeNull()
    expect(stats!.scanned).toBe(RECORDS.length)
    expect(stats!.matched).toBe(2)
    expect(stats!.emitted).toBe(2)
    expect(stats!.exhausted).toBe(true)
    // totalItems перехват не отдаёт: число страниц непредсказуемо.
    expect(res.totalItems).toBeUndefined()
  })

  it('словарь правит запрос: источник опрашивается исправленным, подпись объявлена', async () => {
    withClientEnv()
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, {
      name: 'corrected',
      correct: () => async (query: string) => ({ query, corrected: 'наруто', changed: true }),
    })
    const res = await source.page({ page: 1, pageSize: 20, extra: { q: 'нарута' } })
    expect(res.items.map((r) => r.id)).toEqual(['1'])
    expect(calls.every((call) => call.q === 'наруто')).toBe(true)
    const correction = getSearchCorrection('corrected')
    expect(correction).toEqual({ query: 'нарута', corrected: 'наруто', changed: true })
  })

  it('словаря нет (null) — запасной контур: сканирование без сужения', async () => {
    withClientEnv()
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, { name: 'fallback', correct: () => async () => null })
    const res = await source.page({ page: 1, pageSize: 20, extra: { q: 'нарут' } })
    // Пустой запрос до источника не доезжает вовсе (слой источника ключ снимает).
    expect(calls.every((call) => call.q === undefined)).toBe(true)
    expect(res.items.map((r) => r.id).sort()).toEqual(['1', '3'])
    expect(getSearchCorrection('fallback')).toBeNull()
  })

  it('политика приложения (active=false) выключает усиление: запрос идёт как есть', async () => {
    withClientEnv()
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, {
      name: 'inactive',
      active: (extra) => extra.fuzzy !== false,
    })
    const res = await source.page({ page: 1, pageSize: 20, extra: { q: 'нарута', fuzzy: false } })
    // Родной контур источника: подстрока «нарута» нашла только Нарутару.
    expect(res.items.map((r) => r.id)).toEqual(['3'])
    expect(calls).toEqual([{ page: 1, pageSize: 20, q: 'нарута' }])
    expect(getSearchStats('inactive')).toBeNull()
  })

  it('короткий запрос — сквозной каталог даже на клиенте', async () => {
    withClientEnv()
    const { source: base, calls } = catalogueSource()
    const source = withSearch(base, { name: 'shortq', minLength: 3 })
    const res = await source.page({ page: 1, pageSize: 20, extra: { q: 'на' } })
    expect(res.items.map((r) => r.id)).toEqual(['1', '2', '3'])
    expect(calls).toEqual([{ page: 1, pageSize: 20, q: undefined }])
  })
})
