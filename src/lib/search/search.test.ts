/**
 * Unit-набор ядра поиска (§ 3.6 канона): foldKey, взвешенный
 * Дамерау-Левенштейн, словарь терминов и скоринг — на фиксированном корпусе,
 * через ИМПОРТ модулей (не строковые пины исходников).
 *
 * Намеренно НЕ здесь: водяной знак/дедуп/сброс по fingerprint перехваченного
 * накопителя. Fuzzy-контур в `createSearchInterceptor` по архитектуре только
 * клиентский (под `import.meta.env.SSR || typeof window === 'undefined'` идёт
 * серверная подстрока) — в node он и не должен исполняться, поэтому его место
 * в браузерном сценарии. Здесь SSR-граница перехвата пинится поведенчески
 * (ниже), а сам накопитель тестируется напрямую — `createAccumulatingSource`
 * средовых гардов не имеет.
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as fuzzy from './fuzzy'
import { createAccumulatingSource, createSearchInterceptor } from './accumulator'
import { defineSearch, getSearch, hasSearch, resetSearchRegistry, searchAddressSpec } from './registry'
import { normalizeSearchQuery } from './core'
import { getPaginator, hasPaginator, resetRegistry, type Extra, type PageRequest, type PageResponse } from '../paginate'

type Rec = { id: string; title: string }

afterEach(() => {
  resetSearchRegistry()
  resetRegistry()
})

describe('foldKey и дистанция', () => {
  it('foldKey: регистр, ё→е, диакритика, латино-кириллический гомоглиф', () => {
    expect(fuzzy.foldKey('Ёлка')).toBe('елка')
    // Диакритика снимается до гомоглифов: обе записи складываются в один
    // канонический ключ (латинские p/o/k/e/m — парные кириллические).
    expect(fuzzy.foldKey('Pokémon')).toBe(fuzzy.foldKey('pokemon'))
    expect(fuzzy.foldKey('ace')).toBe(fuzzy.foldKey('асе'))
    expect(fuzzy.foldKey('АТАКА')).toBe(fuzzy.foldKey('атака'))
  })

  it('damerauLevenshtein: крайние случаи, транспозиция, конфузия 0.5', () => {
    expect(fuzzy.damerauLevenshtein('', 'абв')).toBe(3)
    expect(fuzzy.damerauLevenshtein('атака', 'атака')).toBe(0)
    expect(fuzzy.damerauLevenshtein('abcd', 'acbd')).toBe(1) // транспозиция соседних = 1
    expect(fuzzy.damerauLevenshtein('молоко', 'млоко')).toBe(1) // удаление = 1
    expect(fuzzy.damerauLevenshtein('адин', 'один')).toBe(0.5) // типовая конфузия а/о
    expect(fuzzy.damerauLevenshtein('один', 'адин')).toBe(0.5) // симметрично
    expect(fuzzy.substitutionCost('ж', 'ш')).toBe(0.5)
    expect(fuzzy.substitutionCost('б', 'л')).toBe(1) // несвязанные буквы
  })

  it('maxCostFor: короткие слова — строже', () => {
    expect(fuzzy.maxCostFor('но')).toBe(1)
    expect(fuzzy.maxCostFor('abcd')).toBe(1)
    expect(fuzzy.maxCostFor('abcde')).toBe(2)
    expect(fuzzy.maxCostFor('мандариновый')).toBeGreaterThanOrEqual(fuzzy.maxCostFor('но'))
  })
})

describe('словарь терминов', () => {
  it('buildTermDictionary: df = число текстов, повтор в тексте не считается', () => {
    const dict = fuzzy.buildTermDictionary(['Наруто смотрит наруто', 'Наруто и Боруто', 'я'])
    expect(dict.get('наруто')?.df).toBe(2)
    expect(dict.get('наруто')?.display).toBe('наруто') // поверхность — токен tokenize (нижний регистр)
    expect(dict.get('боруто')?.df).toBe(1)
    expect(dict.get('я')).toBeUndefined() // термины короче MIN_TERM_LEN не собираются
  })

  it('serializeTermDictionary ↔ parseTermDictionary: круговой артефакт', () => {
    const dict = fuzzy.buildTermDictionary(['Атака Титанов', 'Атака'])
    const parsed = fuzzy.parseTermDictionary(fuzzy.serializeTermDictionary(dict))
    expect([...parsed.values()].map((e) => [e.key, e.display, e.df])).toEqual(
      [...dict.values()].map((e) => [e.key, e.display, e.df]),
    )
    // Мусорные строки артефакта пропускаются, ключ пересчитывается из display.
    const repaired = fuzzy.parseTermDictionary('ШумоваяСтрока\nТитанов\t7\nBad\tnan')
    expect(repaired.get('титанов')?.df).toBe(7)
    expect(repaired.size).toBe(1)
  })

  it('suggestCorrections: безошибочный не трогаем, опечатка исправляется', () => {
    const dict = fuzzy.buildTermDictionary(['Наруто', 'Атака Титанов'])
    const clean = fuzzy.suggestCorrections('наруто', dict)
    expect(clean.changed).toBe(false)
    expect(clean.tokens[0].cost).toBe(0)
    const typo = fuzzy.suggestCorrections('нарута', dict)
    expect(typo.changed).toBe(true)
    expect(typo.correctedQuery).toBe('наруто') // подставлен display термина
    expect(typo.tokens[0].cost).toBe(0.5) // конфузия а/о — половинная дистанция
    const unknown = fuzzy.suggestCorrections('гиперболоид', dict)
    expect(unknown.changed).toBe(false)
    expect(unknown.tokens[0].cost).toBe(Infinity)
  })

  it('suggestCorrections: тай-брейк детерминирован (df ↓), не от порядка Map', () => {
    // Кандидаты на равной дистанции: побеждает более частотный термин;
    // перестановка порядка выгрузки (другой Map order) результат не меняет.
    const a = fuzzy.buildTermDictionary(['Зодро Зодро', 'бодро'])
    const b = fuzzy.buildTermDictionary(['бодро', 'Зодро Зодро'])
    const first = fuzzy.suggestCorrections('ходро', a).correctedQuery
    const second = fuzzy.suggestCorrections('ходро', b).correctedQuery
    expect(first).toBe(second)
    expect(first).toMatch(/Зодро|бодро/)
  })
})

describe('скоринг и ранжирование', () => {
  it('скоринг: монотонность точное > префикс > подстрока > опечатка', () => {
    const exact = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('наруто'))
    expect(exact).toBe(1)
    const prefix = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('нарут'))
    expect(prefix).toBe(0.92)
    const inside = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('рут'))
    expect(inside).toBe(0.8)
    const typo = fuzzy.scorePrepared(fuzzy.prepareTexts(['атака']), fuzzy.prepareQuery('аткаа'))
    expect(typo).toBeCloseTo(0.575, 9) // опечатка-транспозиция
    expect(exact).toBeGreaterThan(prefix)
    expect(prefix).toBeGreaterThan(inside)
    expect(inside).toBeGreaterThan(typo)
  })

  it('скоринг: min-агрегация по токенам, неизвестный токен обнуляет запись', () => {
    const text = fuzzy.prepareTexts(['Атака Титанов'])
    expect(fuzzy.scorePrepared(text, fuzzy.prepareQuery('атака титанов'))).toBe(0.8)
    expect(fuzzy.scorePrepared(text, fuzzy.prepareQuery('атака наруто'))).toBe(0)
    expect(fuzzy.scorePrepared(text, [])).toBe(0) // пустой запрос не ранжируется
  })

  it('rankFuzzy: топ — точное название, посторонние отброшены, стабильный порядок', () => {
    const records = [
      { id: 'naruto', title: 'Наруто', aliases: ['Naruto'] },
      { id: 'shippuden', title: 'Наруто: Ураганные хроники', aliases: ['Naruto Shippuden'] },
      { id: 'aot', title: 'Атака титанов', aliases: ['Attack on Titan'] },
      { id: 'boruto', title: 'Боруто', aliases: ['Boruto'] },
    ]
    const byTitle = fuzzy.rankFuzzy(records, 'наруто')
    expect(byTitle[0].record.id).toBe('naruto') // точный заголовок выше составного
    expect(byTitle.every((r) => r.score > 0)).toBe(true)
    expect(fuzzy.rankFuzzy(records, 'attack')[0].record.id).toBe('aot') // алиасы ранжируются
    expect(fuzzy.rankFuzzy(records, 'аткаа')[0].record.id).toBe('aot') // опечатка находит запись
    expect(fuzzy.rankFuzzy(records, 'зелёное-зелёное')).toEqual([])
    for (const r of byTitle.slice(1)) expect(r.score).toBeLessThanOrEqual(byTitle[0].score)
    // Пустой запрос — нейтральный список совместимости, скор 0.
    const empty = fuzzy.rankFuzzy(records, '')
    expect(empty.length).toBe(records.length)
    expect(empty.every((r) => r.score === 0)).toBe(true)
  })

  it('collectFuzzyPage: срез до pageSize + hasNext последнего батча', async () => {
    const base = [
      { id: 'a1', title: 'Атака раз' },
      { id: 'a2', title: 'Атака два' },
      { id: 'b1', title: 'Боруто' },
      { id: 'a3', title: 'Атака три' },
    ]
    const pages = [base.slice(0, 2), base.slice(2)]
    const page = await fuzzy.collectFuzzyPage({
      query: 'атака',
      pageSize: 3,
      load: async (cursor) => {
        const i = cursor ? 1 : 0
        return { items: pages[i] ?? [], nextCursor: i === 0 ? 'next' : undefined, hasNext: i === 0 }
      },
    })
    expect(page.items.map((r) => r.id)).toEqual(['a1', 'a2', 'a3'])
    expect(page.hasNext).toBe(false) // источник исчерпан
  })
})

describe('перехватчик источника', () => {
  const base = (calls: PageRequest[], recs: Rec[] = [{ id: 'x', title: 'Наруто' }]) => {
    return async (req: PageRequest): Promise<PageResponse<Rec>> => {
      calls.push(req)
      return { items: recs, hasNext: false }
    }
  }

  it('SSR/no-JS-контур: запрос проходит в источник как есть (без батча 500)', async () => {
    const calls: PageRequest[] = []
    const source = createSearchInterceptor<Rec>({
      id: (r) => r.id,
      texts: (r) => [r.title],
      correct: async () => ({ query: 'нарута', corrected: 'наруто', changed: true }),
      source: base(calls),
    })
    const res = await source({ page: 3, pageSize: 20, extra: { q: 'нарута', kind: 'tv' } })
    expect(res.items.length).toBe(1)
    expect(calls.length).toBe(1) // без накопительных батчей
    expect(calls[0].page).toBe(3) // страница зовущего — не перезапрос с первой
    expect(calls[0].pageSize).toBe(20) // pageSize зовущего — не batchSize=500
    expect(calls[0].extra?.q).toBe('нарута') // сырой запрос — серверной подстроке
    expect(calls[0].extra?.kind).toBe('tv') // прочие ключи extra на месте
  })

  it('пустой и короче minLength запрос — сквозной каталог', async () => {
    const calls: PageRequest[] = []
    const source = createSearchInterceptor<Rec>({ id: (r) => r.id, texts: (r) => [r.title], source: base(calls) })
    await source({ page: 1, pageSize: 20, extra: { q: '   ' } })
    await source({ page: 1, pageSize: 20, extra: { q: 'н' } })
    await source({ page: 1, pageSize: 20, extra: {} })
    expect(calls.length).toBe(3)
    expect(calls[1].extra?.q).toBe('') // одиночный символ не должен резать выдачу
  })
})

describe('накопитель: бюджет, потолок, параллельность', () => {
  /** Фикстура: источник из N страниц × 10 записей, всё релевантно (acceptance 100%). */
  const pagedSource =
    (pages: number, track?: { inFlight: number; maxInFlight: number }) =>
    async (req: PageRequest): Promise<PageResponse<Rec>> => {
      if (track) {
        track.inFlight += 1
        track.maxInFlight = Math.max(track.maxInFlight, track.inFlight)
        await new Promise((r) => setTimeout(r, 5))
        track.inFlight -= 1
      }
      const page = req.page
      const items =
        page <= pages
          ? Array.from({ length: 10 }, (_, j) => ({ id: `r${page}-${j}`, title: `запись ${page * 10 + j}` }))
          : []
      return { items, hasNext: page < pages }
    }

  const opts = (source: (req: PageRequest) => Promise<PageResponse<Rec>>, over: Record<string, unknown> = {}) => ({
    id: (r: Rec) => r.id,
    texts: (r: Rec) => [r.title],
    source,
    ...over,
  })

  it('deep-link за базовым бюджетом: оценка поднимает бюджет до цели (один вызов)', async () => {
    let calls = 0
    const source = createAccumulatingSource<Rec>(
      opts(
        async (req) => {
          calls += 1
          return pagedSource(60)(req)
        },
        { batchSize: 10, maxBatchesPerCall: 2, maxBatchesDeepLink: 60, parallelBatches: 2 },
      ),
    )
    const res = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    expect(res.items.length).toBe(20) // страница 10 собрана ЗА ОДИН вызов
    expect(res.hasNext).toBe(true)
    expect(calls).toBeGreaterThan(8)
    expect(calls).toBeLessThanOrEqual(22) // бюджет поднят по оценке
  })

  it('за потолком бюджета: честная пустота с hasNext, продолжение накапливает', async () => {
    let calls = 0
    const source = createAccumulatingSource<Rec>(
      opts(
        async (req) => {
          calls += 1
          return pagedSource(60)(req)
        },
        { batchSize: 10, maxBatchesPerCall: 2, maxBatchesDeepLink: 5, parallelBatches: 1 },
      ),
    )
    // Страница 10 требует ~201 ранжированную запись: за вызов не добраться.
    let res = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    expect(res.items.length).toBe(0)
    expect(res.hasNext).toBe(true) // но это НЕ конец: пустота с hasNext — «ищем ещё»
    const afterFirst = calls
    expect(afterFirst).toBe(5) // потолок соблюдён: ровно 5 батчей за вызов
    // «Продолжить поиск» = повторный запрос той же страницы: бюджет свежий,
    // позиция чтения сохранена — аккумулятор НЕ начинает с нуля.
    for (let i = 0; i < 4 && res.items.length === 0; i++) {
      res = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    }
    expect(res.items.length).toBe(20)
    expect(calls).toBeGreaterThan(afterFirst)
    expect(res.items.every((r) => r.title.startsWith('запись'))).toBe(true)
  })

  it('параллельная группа ≡ последовательной раскачке (детерминизм выдачи)', async () => {
    const trackA = { inFlight: 0, maxInFlight: 0 }
    const trackB = { inFlight: 0, maxInFlight: 0 }
    const sequential = createAccumulatingSource<Rec>(
      opts(pagedSource(40, trackA), { batchSize: 10, maxBatchesPerCall: 50, maxBatchesDeepLink: 50, parallelBatches: 1 }),
    )
    const parallel = createAccumulatingSource<Rec>(
      opts(pagedSource(40, trackB), { batchSize: 10, maxBatchesPerCall: 50, maxBatchesDeepLink: 50, parallelBatches: 4 }),
    )
    const req = { page: 3, pageSize: 20, extra: { q: 'запись' } }
    const [a, b] = await Promise.all([sequential(req), parallel(req)])
    expect(b.items.map((r) => r.id)).toEqual(a.items.map((r) => r.id))
    expect(trackA.maxInFlight).toBe(1) // последовательная — один запрос в полёте
    expect(trackB.maxInFlight).toBeGreaterThan(1) // параллельная — несколько
  })

  it('группа не качает лишнего: батчей ровно по потребности', async () => {
    let calls = 0
    const source = createAccumulatingSource<Rec>(
      opts(
        async (req) => {
          calls += 1
          return pagedSource(60)(req)
        },
        { batchSize: 10, maxBatchesPerCall: 8, maxBatchesDeepLink: 32, parallelBatches: 4 },
      ),
    )
    // Страница 1 (pageSize 20): цель 21 запись = 3 батча по 10 — не 4.
    const res = await source({ page: 1, pageSize: 20, extra: { q: 'запись' } })
    expect(res.items.length).toBe(20)
    expect(calls).toBe(3)
  })
})

describe('реестр и действия', () => {
  it('defineSearch регистрирует пагинатор на URL-адаптере и объявляет ключ q', () => {
    let seen: Extra = {}
    const instance = defineSearch<Rec>({
      name: 'demo-search',
      pageParam: 'search',
      pageSize: 10,
      source: async (req) => {
        seen = req.extra ?? {}
        return { items: [{ id: 'x', title: 'Наруто' }], hasNext: false }
      },
    })
    expect(instance.pageParam).toBe('search')
    expect(instance.queryKey).toBe('q')
    expect(instance.debounce).toBe(300)
    expect(instance.maxQueryLength).toBe(120)
    expect(hasSearch('demo-search')).toBe(true)
    expect(getSearch('demo-search')).toBe(instance)
    expect(hasPaginator('demo-search')).toBe(true)
    const adapter = getPaginator('demo-search').adapter as { setRouter?: unknown }
    expect(typeof adapter.setRouter).toBe('function') // URL-транспорт: адрес принадлежит адаптеру
    expect(seen).toEqual({}) // регистрация источник не дёргает
  })

  it('searchAddressSpec: ключ q и дополнительные ключи источника под префиксом', () => {
    const spec = searchAddressSpec('search', 40, { filters: () => undefined }) as {
      pageParam: string
      extra: Record<string, unknown>
    }
    expect(spec.pageParam).toBe('search')
    expect(Object.keys(spec.extra).sort()).toEqual(['filters', 'q'])
    const validate = spec.extra.q as (raw: unknown) => unknown
    expect(validate('  на\u0000руто  ')).toBe('на руто') // управляющий символ → пробел, trim по краям
    expect(validate('') ).toBeUndefined() // пустой запрос в адрес не пишется
    expect(String(validate('x'.repeat(100))).length).toBe(40)
  })

  it('normalizeSearchQuery: та же нормализация, что у валидатора адреса', () => {
    expect(normalizeSearchQuery('  атака\u001fтитанов  ')).toBe('атака титанов')
    expect(normalizeSearchQuery('x'.repeat(200), 10).length).toBe(10)
  })
})
