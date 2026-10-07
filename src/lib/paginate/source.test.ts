/**
 * Слой источника (§ этап 1): пагинатор работает ТОЛЬКО с адаптированными
 * источниками, источник объявляет свои возможности, а UI потом гасит по ним
 * недоступное. Здесь пинится и «пропуск» (бренд: эмуляцию api слой не
 * принимает), и deny-safe-отсечение необъявленного (q без поиска, чужие
 * фильтры), и декораторы тумблеров (`srch`, `total`), и композиция
 * источников под ключом `src`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  composeSources,
  createLocalAdapter,
  createPaginatorStore,
  createUrlAdapter,
  definePaginator,
  defineSource,
  EMPTY_CAPABILITIES,
  featureGates,
  getState,
  initPaginator,
  isAdaptedSource,
  resetRegistry,
  setExtra,
  withSearchGate,
  withTotalsGate,
  type AdaptedSource,
  type Extra,
  type PageResponse,
  type SourceInput,
  type SourceLook,
  type SourceSpec,
} from './index'

type Rec = { id: string; title: string }

type Call = { look: SourceLook; input: SourceInput }

/** Источник теста: пишет каждый вызов данных и отдаёт одну запись. */
function make(calls: Call[], spec: Partial<SourceSpec<Rec>> = {}): AdaptedSource<Rec> {
  return defineSource<Rec>({
    ...spec,
    name: spec.name ?? 'items',
    record: spec.record ?? { id: (r) => r.id, title: (r) => r.title, texts: (r) => [r.title] },
    data: async (look, input) => {
      calls.push({ look, input })
      return { items: [{ id: 'a', title: 'A' }], hasNext: false }
    },
  })
}

afterEach(() => {
  resetRegistry()
})

describe('defineSource: возможности и deny-safe вход', () => {
  it('родной поиск объявлен: q доезжает, порог длины режет короткий запрос', async () => {
    const calls: Call[] = []
    const source = make(calls, { search: { minLength: 3 } })
    await source.fetchPage({ page: 2, pageSize: 10 }, { q: 'на' })
    await source.fetchPage({ page: 1, pageSize: 10 }, { q: 'наруто' })
    expect(calls[0].input.q).toBe('') // короче порога — как пустой
    expect(calls[1].input.q).toBe('наруто')
    expect(calls[0].look).toEqual({ page: 2, pageSize: 10 }) // страница зовущего, не перезапрос
    expect(source.capabilitiesFor().search).toEqual({ minLength: 3 })
    expect(source.extraKeys()).toEqual(['q'])
  })

  it('родного поиска нет: запрос до данных не доезжает, ключа q в паспорте нет', async () => {
    const calls: Call[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const source = make(calls)
    await source.fetchPage({ page: 1, pageSize: 5 }, { q: 'наруто' })
    expect(calls[0].input).toEqual({ q: '', filters: {} })
    expect(source.capabilitiesFor().search).toBeUndefined()
    expect(source.extraKeys()).toEqual([])
    // Отброс не молчаливый: в dev причина названа (молчание запрещено инвариантом).
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('отброшен'))
    warn.mockRestore()
  })

  it('фильтры: только объявленные ключи, пустые опускаются, чужие не видны', async () => {
    const calls: Call[] = []
    const source = make(calls, { filters: ['kind', 'year'] })
    await source.fetchPage({ page: 1, pageSize: 5 }, { kind: 'tv', year: '', layout: 'columns' })
    expect(calls[0].input.filters).toEqual({ kind: 'tv' })
    expect(source.extraKeys().sort()).toEqual(['kind', 'year'])
    expect(source.capabilitiesFor().filters).toEqual({ keys: ['kind', 'year'] })
  })

  it('featureGates: что включено у источника — то и можно включать в UI', () => {
    expect(featureGates(EMPTY_CAPABILITIES)).toEqual({
      nativeSearch: false,
      libSearch: false,
      filters: false,
      totals: false,
    })
    expect(
      featureGates({
        search: { minLength: 2 },
        fuzzy: { minLength: 2 },
        filters: { keys: ['kind'] },
        totals: true,
      }),
    ).toEqual({ nativeSearch: true, libSearch: true, filters: true, totals: true })
  })
})

describe('бренд: эмуляцию api слоя пагинатор не принимает', () => {
  const fake = async () => ({ items: [], hasNext: false })

  it('«просто функция» не адаптированный источник', () => {
    expect(isAdaptedSource(fake)).toBe(false)
    expect(() => createLocalAdapter({ name: 'nope', source: fake as unknown as AdaptedSource<never> })).toThrow(
      /источник не адаптирован/,
    )
    expect(() => createUrlAdapter({ name: 'nope', source: fake as unknown as AdaptedSource<never> })).toThrow(
      /источник не адаптирован/,
    )
  })

  it('объект с полями «как у источника» без бренда тоже не проходит', () => {
    const impostor = {
      name: 'impostor',
      capabilitiesFor: () => EMPTY_CAPABILITIES,
      recordFor: () => ({ id: () => 'x', title: () => '', texts: () => [] }),
      extraKeys: () => [],
      fetchPage: fake,
      with: () => impostor,
    }
    expect(isAdaptedSource(impostor)).toBe(false)
    expect(() => composeSources({ items: impostor as unknown as AdaptedSource<never> }, { select: () => 'items' })).toThrow(
      /источник не адаптирован/,
    )
  })
})

describe('декораторы тумблеров', () => {
  it('withSearchGate: выключенный родной поиск отдаёт пустой q, включённый — как есть', async () => {
    const calls: Call[] = []
    const source = make(calls, { search: {} }).with(withSearchGate({ gate: 'srch' }))
    await source.fetchPage({ page: 1, pageSize: 5 }, { q: 'наруто', srch: false })
    await source.fetchPage({ page: 1, pageSize: 5 }, { q: 'наруто', srch: true })
    expect(calls[0].input.q).toBe('')
    expect(calls[1].input.q).toBe('наруто')
    // Возможность поиска не исчезает: тумблер гасит ПРИМЕНЕНИЕ, сам q остаётся
    // в extra (его читает lib/search — сканирование без сужения источником).
    expect(source.capabilitiesFor({ srch: false }).search).toEqual({ minLength: 1 })
  })

  it('withTotalsGate: тумблер снимает totals у ответа и у возможностей', async () => {
    const calls: Call[] = []
    const base = defineSource<Rec>({
      name: 'paged',
      record: { id: (r) => r.id, title: (r) => r.title, texts: (r) => [r.title] },
      totals: true,
      data: async (look) => {
        calls.push({ look, input: { q: '', filters: {} } })
        return { items: [{ id: 'a', title: 'A' }], totalItems: 40, totalPages: 4, hasNext: true }
      },
    })
    const gated = base.with(withTotalsGate({ gate: 'total' }))
    const on = await gated.fetchPage({ page: 1, pageSize: 10 }, { total: true })
    expect(on.totalItems).toBe(40)
    expect(on.totalPages).toBe(4)
    expect(gated.capabilitiesFor({ total: true }).totals).toBe(true)
    const off = await gated.fetchPage({ page: 2, pageSize: 10 }, { total: false })
    expect(off.totalItems).toBeUndefined()
    expect(off.totalPages).toBeUndefined()
    expect(off.hasNext).toBe(true) // «страница полная» посчитана по totalItems источника
    expect(gated.capabilitiesFor({ total: false }).totals).toBe(false)
    expect(calls.map((c) => c.look.page)).toEqual([1, 2]) // данные зовутся как звали
  })
})

describe('composeSources: выбор источника по ключу extra', () => {
  const build = (callsA: Call[], callsB: Call[]) => {
    const a = make(callsA, { name: 'a', search: {} })
    const b = make(callsB, { name: 'b', filters: ['kind'] })
    return composeSources<Rec>(
      { a, b },
      { name: 'combo', select: (extra) => String(extra?.src ?? 'a') },
    )
  }

  it('данные, возможности и паспорт — по ТЕКУЩЕМУ выбору', async () => {
    const callsA: Call[] = []
    const callsB: Call[] = []
    const combo = build(callsA, callsB)
    await combo.fetchPage({ page: 1, pageSize: 5 }, { src: 'b', kind: 'tv' })
    expect(callsB.length).toBe(1)
    expect(callsA.length).toBe(0)
    expect(callsB[0].input.filters).toEqual({ kind: 'tv' })
    // Возможности резолвятся по выбору: панель гасит функции текущего источника.
    expect(combo.capabilitiesFor({ src: 'a' }).search).toEqual({ minLength: 1 })
    expect(combo.capabilitiesFor({ src: 'b' }).search).toBeUndefined()
    // Ключи — объединение: после переключения ключ снова осмыслен.
    expect(combo.extraKeys().sort()).toEqual(['kind', 'q'])
  })

  it('неизвестный выбор — ошибка разработчика, а не пустая выдача', async () => {
    const combo = build([], [])
    await expect(combo.fetchPage({ page: 1, pageSize: 5 }, { src: 'nope' })).rejects.toThrow(/неизвестный источник/)
    expect(() => composeSources({}, { select: () => 'a' })).toThrow(/пустой набор/)
  })
})

describe('связка со ядром: возможности в состоянии, запись только объявленного', () => {
  const rec = (): PageResponse<Rec> => ({ items: [{ id: 'a', title: 'A' }], totalPages: 2 })

  it('состояние пагинатора несёт возможности выбранного источника', async () => {
    const calls: Call[] = []
    const source = composeSources<Rec>(
      {
        a: make(calls, { name: 'a', search: {} }),
        b: make(calls, { name: 'b', totals: true }),
      },
      { select: (extra) => String(extra?.src ?? 'a') },
    )
    definePaginator<Rec>({ name: 'capsTest', source, extraKeys: ['src'] })
    const store = createPaginatorStore()
    await initPaginator(store, 'capsTest')
    // Дефолтный выбор — «a»: родной поиск есть, totals не объявлены.
    expect(getState(store, 'capsTest').capabilities.search).toEqual({ minLength: 1 })
    expect(getState(store, 'capsTest').capabilities.totals).toBe(false)
    await setExtra(store, 'capsTest', { src: 'b' })
    // Переключились на «b»: его возможности, а не константа потребителя.
    expect(getState(store, 'capsTest').capabilities.search).toBeUndefined()
    expect(getState(store, 'capsTest').capabilities.totals).toBe(true)
  })

  it('setExtra: ключ источника и ключ потребителя легальны, чужой — throw, снятие — легально', async () => {
    const calls: Call[] = []
    definePaginator<Rec>({
      name: 'keysTest',
      source: make(calls, { name: 'items', filters: ['kind'] }),
      extraKeys: ['layout'],
    })
    const store = createPaginatorStore()
    await initPaginator(store, 'keysTest')
    await setExtra(store, 'keysTest', { kind: 'tv', layout: 'columns' })
    expect(getState(store, 'keysTest').extra).toEqual({ kind: 'tv', layout: 'columns' })
    await expect(setExtra(store, 'keysTest', { nope: 'x' })).rejects.toThrow(/не объявлен/)
    await setExtra(store, 'keysTest', { kind: undefined })
    expect(getState(store, 'keysTest').extra.kind).toBeUndefined()
  })

  it('локальный адаптер строг только если потребитель объявил поверхность', async () => {
    const calls: Call[] = []
    const source = make(calls, { name: 'quiet' })
    // Без extraKeys поверхность не объявлена — судить нечем, запись проходит.
    const open = createLocalAdapter<Rec>({ name: 'open', source })
    expect(open.extraKeys?.()).toBeUndefined()
    const closed = createLocalAdapter<Rec>({ name: 'closed', source, extraKeys: ['layout'] })
    expect(closed.extraKeys?.()).toEqual(['layout'])
  })
})

describe('Extra не течёт в источник', () => {
  it('UI-ключи (раскладка, режим, скелетоны) до данных не доезжают', async () => {
    const calls: Call[] = []
    const source = make(calls, { name: 'ui', search: {}, filters: ['kind'] })
    const ui: Extra = {
      q: 'наруто',
      kind: 'tv',
      layout: 'columns',
      mode: 'accumulate',
      skel: true,
      cols: 'auto',
      src: 'items',
    }
    await source.fetchPage({ page: 1, pageSize: 5 }, ui)
    expect(calls[0].input).toEqual({ q: 'наруто', filters: { kind: 'tv' } })
  })
})
