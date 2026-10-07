/**
 * Порт проверок ядра поиска из исходника (SolidHono, `test/checks/search-fuzzy.mjs`):
 * foldKey, взвешенный Дамерау-Левенштейн, словарь терминов, скоринг, ранжирование,
 * SSR-граница перехвата и бюджет deep-link/параллельность аккумулятора.
 *
 * Намеренно НЕ здесь: водяной знак/дедуп/сброс по fingerprint перехваченного
 * накопителя на ЖИВОМ клиенте. Fuzzy-контур в `createSearchInterceptor` по
 * архитектуре только клиентский (`import.meta.env.SSR || typeof window ===
 * 'undefined'` → серверная подстрока), поэтому сценариям нужен браузер; здесь
 * SSR-граница пинится поведенчески, а механика аккумулятора проверяется
 * через `createAccumulatingSource` — он от гардов свободен намеренно.
 */
import { describe, it, expect } from 'vitest'
import * as fuzzy from './fuzzy'
import * as acc from './accumulator'

describe('search core (foldKey / дистанция Дамерау-Левенштейна)', () => {
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
    expect(fuzzy.damerauLevenshtein('адин', 'один')).toBe(0.5) // типовая конфузия а/о = 0.5
    expect(fuzzy.damerauLevenshtein('один', 'адин')).toBe(0.5) // симметрично
    expect(fuzzy.substitutionCost('ж', 'ш')).toBe(0.5)
    expect(fuzzy.substitutionCost('б', 'л')).toBe(1) // несвязанные буквы = 1
  })

  it('maxCostFor: короткие слова — строже', () => {
    expect(fuzzy.maxCostFor('но')).toBe(1)
    expect(fuzzy.maxCostFor('abcd')).toBe(1)
    expect(fuzzy.maxCostFor('abcde')).toBe(2)
    expect(fuzzy.maxCostFor('мандариновый')).toBeGreaterThanOrEqual(fuzzy.maxCostFor('но'))
  })
})

describe('search core (словарь терминов)', () => {
  it('buildTermDictionary: df = число текстов, повтор в тексте не считается', () => {
    const dict = fuzzy.buildTermDictionary(['Наруто смотрит наруто', 'Наруто и Боруто', 'я'])
    expect(dict.get('наруто')?.df).toBe(2) // два текста с термином
    expect(dict.get('наруто')?.display).toBe('наруто') // поверхность — токен в нижнем регистре
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
    expect(typo.correctedQuery).toBe('наруто') // подставлен display термина (нижний регистр)
    expect(typo.tokens[0].cost).toBe(0.5) // конфузия а/о — половинная дистанция
    const unknown = fuzzy.suggestCorrections('гиперболоид', dict)
    expect(unknown.changed).toBe(false)
    expect(unknown.tokens[0].cost).toBe(Infinity) // вне дистанции — не исправлен
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

describe('search core (скоринг и ранжирование)', () => {
  it('скоринг: монотонность точное > префикс > подстрока > опечатка', () => {
    const exact = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('наруто'))
    expect(exact).toBe(1)
    const prefix = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('нарут'))
    expect(prefix).toBe(0.92)
    const inside = fuzzy.scorePrepared(fuzzy.prepareTexts(['наруто']), fuzzy.prepareQuery('рут'))
    expect(inside).toBe(0.8)
    const typo = fuzzy.scorePrepared(fuzzy.prepareTexts(['атака']), fuzzy.prepareQuery('аткаа'))
    expect(Math.abs(typo - 0.575)).toBeLessThan(1e-9) // транспозиция = 0.575
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
    const byAlias = fuzzy.rankFuzzy(records, 'attack')
    expect(byAlias[0].record.id).toBe('aot') // алиасы ранжируются
    const typo = fuzzy.rankFuzzy(records, 'аткаа')
    expect(typo[0].record.id).toBe('aot') // опечатка-транспозиция находит запись
    expect(fuzzy.rankFuzzy(records, 'зелёное-зелёное')).toEqual([]) // постороннее не попадает
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
    const loader = async (cursor: unknown) => {
      const pages = [base.slice(0, 2), base.slice(2)]
      const i = cursor ? 1 : 0
      return {
        items: pages[i] ?? [],
        nextCursor: i === 0 ? 'next' : undefined,
        hasNext: i === 0,
      }
    }
    const page = await fuzzy.collectFuzzyPage({ query: 'атака', pageSize: 3, load: loader })
    expect(page.items.map((r) => r.id)).toEqual(['a1', 'a2', 'a3'])
    expect(page.hasNext).toBe(false) // источник исчерпан
  })
})

describe('search interceptor (политика контуров)', () => {
  it('SSR/no-JS-контур: запрос проходит в источник как есть (без батча 500)', async () => {
    const calls: acc.SearchInterceptorOptions<{ id: string; title: string }>['source'] extends never
      ? never
      : { page: number; pageSize: number; extra: Record<string, unknown> }[] = []
    const base = async (req: { page: number; pageSize: number; extra?: Record<string, unknown> }) => {
      calls.push({ page: req.page, pageSize: req.pageSize, extra: req.extra ?? {} })
      return { items: [{ id: 'x', title: 'Наруто' }], hasNext: false }
    }
    const source = acc.createSearchInterceptor({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      correct: async () => ({ query: 'нарута', corrected: 'наруто', changed: true }),
      source: base as never,
    })
    const res = await source({ page: 3, pageSize: 20, extra: { q: 'нарута', kind: 'tv' } })
    expect(res.items.length).toBe(1)
    expect(calls.length).toBe(1) // без накопительных батчей
    expect(calls[0].page).toBe(3) // страница зовущего — не перезапрос с первой
    expect(calls[0].pageSize).toBe(20) // pageSize зовущего — не batchSize=500
    expect(calls[0].extra.q).toBe('нарута') // сырой запрос — серверной подстроке
    expect(calls[0].extra.kind).toBe('tv') // прочие ключи extra на месте
  })

  it('пустой и короче minLength запрос — сквозной каталог', async () => {
    const calls: { extra: Record<string, unknown> }[] = []
    const base = async (req: { extra?: Record<string, unknown> }) => {
      calls.push({ extra: req.extra ?? {} })
      return { items: [{ id: 'x', title: 'Наруто' }], hasNext: false }
    }
    const source = acc.createSearchInterceptor({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: base as never,
    })
    await source({ page: 1, pageSize: 20, extra: { q: '   ' } })
    await source({ page: 1, pageSize: 20, extra: { q: 'н' } })
    await source({ page: 1, pageSize: 20, extra: {} })
    expect(calls.length).toBe(3)
    expect(calls[1].extra.q).toBe('') // одиночный символ не должен резать выдачу
  })
})

// ── Бюджет deep-link + параллельные батчи (регрессия 2026-09-30) ─────────────
type Track = { inFlight: number; maxInFlight: number }
/** Фикстура: источник из N страниц × 10 записей, всё релевантно (acceptance 100%). */
const pagedSource =
  (pages: number, track?: Track) =>
  async (req: { page: number }) => {
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

describe('search accumulator (бюджет и параллельность)', () => {
  it('deep-link за базовым бюджетом: оценка поднимает бюджет до цели (один вызов)', async () => {
    let calls = 0
    const base = async (req: { page: number }) => {
      calls += 1
      return pagedSource(60)(req)
    }
    const source = acc.createAccumulatingSource({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: base as never,
      batchSize: 10,
      maxBatchesPerCall: 2, // без оценки страница 10 недостижима за вызов
      maxBatchesDeepLink: 60,
      parallelBatches: 2,
    })
    const res = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    expect(res.items.length).toBe(20) // страница 10 собрана ЗА ОДИН вызов
    expect(res.hasNext).toBe(true) // источник не исчерпан
    expect(calls).toBeGreaterThan(8)
    expect(calls).toBeLessThanOrEqual(22) // бюджет поднят по оценке
  })

  it('за потолком бюджета: честная пустота с hasNext, продолжение накапливает', async () => {
    let calls = 0
    const base = async (req: { page: number }) => {
      calls += 1
      return pagedSource(60)(req)
    }
    const source = acc.createAccumulatingSource({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: base as never,
      batchSize: 10,
      maxBatchesPerCall: 2,
      maxBatchesDeepLink: 5, // жёсткий потолок: ~50 записей за вызов
      parallelBatches: 1,
    })
    // Страница 10 требует ~201 ранжированную запись: за вызов не добраться.
    const first = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    expect(first.items.length).toBe(0) // страница не достигнута
    expect(first.hasNext).toBe(true) // но это НЕ конец: пустота с hasNext — сигнал «ищем ещё»
    const afterFirst = calls
    expect(afterFirst).toBe(5) // потолок соблюдён: ровно 5 батчей за вызов
    // «Продолжить поиск» = повторный goToPage на ту же страницу: бюджет свежий,
    // позиция чтения сохранена — аккумулятор НЕ начинает с нуля.
    let res = first
    for (let i = 0; i < 4 && res.items.length === 0; i++) {
      res = await source({ page: 10, pageSize: 20, extra: { q: 'запись' } })
    }
    expect(res.items.length).toBe(20) // накопление между вызовами доводит до страницы
    expect(calls).toBeGreaterThan(afterFirst) // второй заход продолжил, а не перезапустил скан
    expect(res.items.every((r) => r.title.startsWith('запись'))).toBe(true)
  })

  it('параллельная группа ≡ последовательной раскачке (детерминизм выдачи)', async () => {
    const trackA: Track = { inFlight: 0, maxInFlight: 0 }
    const trackB: Track = { inFlight: 0, maxInFlight: 0 }
    const sequential = acc.createAccumulatingSource({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: pagedSource(40, trackA) as never,
      batchSize: 10,
      maxBatchesPerCall: 50,
      maxBatchesDeepLink: 50,
      parallelBatches: 1,
    })
    const parallel = acc.createAccumulatingSource({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: pagedSource(40, trackB) as never,
      batchSize: 10,
      maxBatchesPerCall: 50,
      maxBatchesDeepLink: 50,
      parallelBatches: 4,
    })
    const req = { page: 3, pageSize: 20, extra: { q: 'запись' } }
    const [a, b] = await Promise.all([sequential(req), parallel(req)])
    expect(b.items.map((r) => r.id)).toEqual(a.items.map((r) => r.id))
    expect(trackA.maxInFlight).toBe(1) // последовательная — один запрос в полёте
    expect(trackB.maxInFlight).toBeGreaterThan(1) // параллельная — несколько запросов в полёте
  })

  it('группа не качает лишнего: батчей ровно по потребности', async () => {
    let calls = 0
    const base = async (req: { page: number }) => {
      calls += 1
      return pagedSource(60)(req)
    }
    const source = acc.createAccumulatingSource({
      id: (r: { id: string }) => r.id,
      texts: (r: { title: string }) => [r.title],
      source: base as never,
      batchSize: 10,
      maxBatchesPerCall: 8,
      maxBatchesDeepLink: 32,
      parallelBatches: 4,
    })
    // Страница 1 (pageSize 20): цель 21 запись = 3 батча по 10 — не 4.
    const res = await source({ page: 1, pageSize: 20, extra: { q: 'запись' } })
    expect(res.items.length).toBe(20)
    expect(calls).toBe(3) // ровно столько батчей, сколько нужно до цели
  })
})
