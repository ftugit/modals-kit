/**
 * Перехватчик источника пагинатора: generic `Source<T>` ПОВЕРХ базового
 * источника. lib search не строит собственного пагинатора данных — она
 * подменяет источник существующего (fuzzy здесь — только МЕТОД сопоставления
 * и ранжирования, страницы добирает сама lib search):
 *
 * - запрос пуст → сквозной проход: базовый источник отдаёт обычные страницы
 *   каталога, пагинатор работает как до перехвата;
 * - SSR/no-JS с запросом → тот же базовый источник: серверное сужение точной
 *   подстрокой по сырому `q` (fuzzy-метод на сервере не исполняется);
 * - клиент с запросом → lib search забирает у источника данные первой
 *   страницы (батчем) и ДОБИРАЕТ следующие, пока отфильтрованного контента не
 *   хватит на страницу пагинатора; избыток переносится на следующую страницу
 *   и добор продолжается оттуда. Со словарём батчи сужены исправленным
 *   запросом, без словаря — сканирование без сужения.
 *
 * Два пространства страниц: пагинатор видит только виртуальные страницы и
 * явный `hasNext`; позиция чтения источника живёт в памяти клиента и никогда
 * не попадает в адрес. Выдача — «водяной знак с повтором шагов 1..p»:
 * страницы строятся по порядку из глобально отсортированного буфера, уже
 * выданные id заморожены — ни дублей, ни потерь, deep-link ≡ проходу кликами.
 * `totalItems` перехват не отдаёт никогда: число страниц непредсказуемо,
 * поэтому PageNav у перехваченного пагинатора автоматически остаётся на
 * стрелках; номера страниц — только у неперехваченного источника.
 */
import type { Extra, PageRequest, PageResponse, Source } from '$lib/paginate/types'
import { prepareQuery, prepareTexts, scorePrepared, type PreparedText } from './fuzzy'

/** Живая статистика перехватчика для демо-панелей и отладки. */
export type SearchInterceptStats = {
  /** Записей скачано у источника (просмотрено сканированием). */
  scanned: number
  /** Прошло фильтр релевантности (принято в ранжирование). */
  matched: number
  /** Уже отображено (заморожено в страницах водяного знака). */
  emitted: number
  /** Текущая страница ИСТОЧНИКА (следующий батч возьмёт её). */
  sourcePage: number
  /** Источник исчерпан. */
  exhausted: boolean
}

export type SearchCorrectionInfo = {
  /** Сырой запрос пользователя (он же остаётся в адресе). */
  query: string
  /** Запрос после коррекции; равен query, если исправлять было нечего. */
  corrected: string
  /** Коррекция реально переписала хотя бы один токен. */
  changed: boolean
}

/** Клиентское fuzzy-усиление перехвата (без него источник остаётся серверным). */
export type SearchFuzzyOptions<T> = {
  /** Стабильный id записи источника (дедупликация между батчами). */
  id: (record: T) => string
  /** Тексты записи для ранжирования (title, aliases, …). */
  texts: (record: T) => readonly string[]
  /**
   * Клиентская коррекция запроса по словарю корпуса. `null` — словарь не
   * готов/недоступен → запасной контур (сканирование). Не вызывается на сервере.
   */
  correct?: (query: string) => Promise<SearchCorrectionInfo | null>
  /** Подпись подмены для UI («искали X → показываем Y»). */
  onCorrection?: (info: SearchCorrectionInfo | null) => void
  /** Живая статистика (пере)стройки буфера; null — перехват неактивен (пустой q). */
  onStats?: (stats: SearchInterceptStats | null) => void
  /** Размер батча — pageSize, с которым источник опрашивается при поиске. @default 500 */
  batchSize?: number
  /** Бюджет батчей на один вызов loadPage. @default 8 */
  maxBatchesPerCall?: number
  /**
   * Потолок бюджета deep-link'а (прыжок на далёкую страницу): после первого
   * батча доля принятия предсказывает, сколько батчей нужно до запрошенной
   * страницы, и бюджет вызова поднимается до оценки — но не выше этого
   * потолка. Fail-fast сохраняется: один вызов не качает бесконечно.
   * @default 32
   */
  maxBatchesDeepLink?: number
  /**
   * Сколько батчей качаться ПАРАЛЛЕЛЬНО, когда до цели нужно больше двух.
   * Применение к буферу — строго по порядку страниц, поэтому выдача
   * детерминированно совпадает с последовательной раскачкой.
   * @default 4
   */
  parallelBatches?: number
}

export type SearchInterceptorOptions<T> = SearchFuzzyOptions<T> & {
  /**
   * Базовый источник пагинатора («дай страницу N размера M»). Обязан понимать
   * `extra.q` НА СЕРВЕРЕ как точное/подстрочное сужение — это контур SSR/no-JS.
   * ВАЖНО: `q` — отдельное поле транспорта, не значение фильтров.
   */
  source: Source<T>
  /** Минимальная длина запроса; короче — сквозной проход без сужения. @default 2 */
  minLength?: number
}

type Accumulated<T> = {
  key: string
  contour: 'main' | 'fallback'
  fallbackTried: boolean
  correction: SearchCorrectionInfo | null
  rankTokens: string[]
  /** Следующая страница БАЗОВОГО источника (батчей), 1-based. */
  batchPage: number
  exhausted: boolean
  recordsSeen: number
  seen: Set<string>
  byId: Map<string, T>
  /** Принятые (score > 0), глобально отсортированные: score ↓, порядок источника ↑. */
  ranked: { id: string; score: number; ord: number }[]
  /** Замороженные страницы: списки id в порядке выдачи. */
  pages: string[][]
  emitted: Set<string>
  /** Односторонняя очередь: параллельные loadPage не дерутся за позицию чтения. */
  lock: Promise<unknown> | null
}

function abortError(): Error {
  const error = new Error('search aborted')
  error.name = 'AbortError'
  return error
}

/**
 * Накопительный источник БЕЗ средовых гардов: чистый клиентский контур
 * (коррекция → батчи → буфер → водяной знак страниц). Отделён от
 * createSearchInterceptor, чтобы механика бюджета/параллельности была
 * тестируема вне браузера: обёртка отвечает за ПОЛИТИКУ (пустой запрос,
 * minLength, SSR/no-JS), этот источник — только за накопление.
 * Контракт: `extra.q` непустой и не короче minLength (гарды обёртки).
 */
export function createAccumulatingSource<T>(opts: SearchInterceptorOptions<T>): Source<T> {
  const batchSize = opts.batchSize ?? 500
  const maxBatchesPerCall = opts.maxBatchesPerCall ?? 8
  const maxBatchesDeepLink = opts.maxBatchesDeepLink ?? 32
  const parallelBatches = Math.max(1, Math.min(opts.parallelBatches ?? 4, 8))

  let state: Accumulated<T> | null = null

  const freshState = (key: string, contour: 'main' | 'fallback'): Accumulated<T> => ({
    key,
    contour,
    fallbackTried: contour === 'fallback',
    correction: null,
    rankTokens: [],
    batchPage: 1,
    exhausted: false,
    recordsSeen: 0,
    seen: new Set(),
    byId: new Map(),
    ranked: [],
    pages: [],
    emitted: new Set(),
    lock: null,
  })

  /** Применение батча к буферу: только после УСПЕШНОГО ответа — прерванный
   * запрос не двигает позицию чтения и не портит буфер. */
  function applyBatch(acc: Accumulated<T>, res: PageResponse<T>): void {
    for (const record of res.items) {
      const id = opts.id(record)
      acc.recordsSeen += 1
      if (acc.seen.has(id)) continue
      acc.seen.add(id)
      const prepared: PreparedText[] = prepareTexts(opts.texts(record))
      const score = scorePrepared(prepared, acc.rankTokens)
      if (score > 0) {
        acc.byId.set(id, record)
        acc.ranked.push({ id, score, ord: acc.seen.size })
      }
    }
    acc.ranked.sort((a, b) => b.score - a.score || a.ord - b.ord)
  }

  /** Батч = очередная страница базового источника с подставленным сужением. */
  async function fetchOne(acc: Accumulated<T>, baseExtra: Extra, signal?: AbortSignal): Promise<void> {
    const narrow = acc.contour === 'main' ? (acc.correction?.corrected ?? '') : ''
    const res = await opts.source({
      page: acc.batchPage,
      pageSize: batchSize,
      extra: { ...baseExtra, q: narrow },
      signal,
    })
    applyBatch(acc, res)
    acc.batchPage += 1
    acc.exhausted = !res.hasNext
  }

  /**
   * Параллельная группа батчей: запросы летят вместе, применение — СТРОГО по
   * порядку страниц, поэтому `ord` (тай-брейк сортировки) детерминирован и
   * совпадает с последовательной раскачкой. Группа атомарна: сбой любого
   * запроса не двигает позицию чтения.
   */
  async function fetchGroup(
    acc: Accumulated<T>,
    baseExtra: Extra,
    count: number,
    signal?: AbortSignal,
  ): Promise<void> {
    const narrow = acc.contour === 'main' ? (acc.correction?.corrected ?? '') : ''
    const start = acc.batchPage
    const responses = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        opts.source({
          page: start + i,
          pageSize: batchSize,
          extra: { ...baseExtra, q: narrow },
          signal,
        }),
      ),
    )
    for (const res of responses) {
      applyBatch(acc, res)
      acc.batchPage += 1
      acc.exhausted = !res.hasNext
    }
  }

  async function produce(acc: Accumulated<T>, req: PageRequest, rawQuery: string): Promise<PageResponse<T>> {
    const pageSize = req.pageSize
    const wanted = Math.max(1, Math.floor(req.page))
    const baseExtra: Extra = { ...(req.extra ?? {}) }

    // Коррекция резолвится один раз на аккумулятор.
    if (acc.correction === null && acc.contour === 'main') {
      const info = (await opts.correct?.(rawQuery)) ?? null
      if (req.signal?.aborted) throw abortError()
      if (info) {
        acc.correction = info
        acc.rankTokens = prepareQuery(info.corrected)
      } else {
        acc.contour = 'fallback'
        acc.fallbackTried = true
        acc.rankTokens = prepareQuery(rawQuery)
      }
      opts.onCorrection?.(acc.correction)
    }
    if (!acc.rankTokens.length) acc.rankTokens = prepareQuery(rawQuery)

    let batchesThisCall = 0
    let budgetLimit = maxBatchesPerCall
    const budgetLeft = () => batchesThisCall < budgetLimit
    /**
     * Оценка бюджета deep-link'а: доля принятия (ranked/recordsSeen) после
     * фактических батчей предсказывает, сколько ещё нужно до цели. Бюджет
     * вызова поднимается до оценки, но не выше maxBatchesDeepLink — fail-fast
     * сохраняется: один вызов качает ограниченный объём даже при прыжке на
     * далёкую страницу. +1 в числителе — нулевая выборка не обнуляет оценку.
     */
    const reestimate = (target: number) => {
      if (budgetLimit >= maxBatchesDeepLink || acc.recordsSeen === 0) return
      const remaining = target - acc.ranked.length
      if (remaining <= 0) return
      const rate = (acc.ranked.length + 1) / acc.recordsSeen
      const need = Math.ceil(remaining / (batchSize * rate))
      budgetLimit = Math.min(Math.max(budgetLimit, batchesThisCall + need), maxBatchesDeepLink)
    }

    // Водяной знак: страницы строятся по порядку; уже построенные заморожены.
    // Цель оценки бюджета — ЗАПРОШЕННАЯ страница (deep-link), а не текущий
    // шаг водяного знака: шаги — промежуточные вехи, до цели могло остаться
    // ещё много батчей.
    const goal = wanted * pageSize + 1
    while (acc.pages.length < wanted) {
      const step = acc.pages.length + 1
      const target = step * pageSize + 1 // +1 — честный hasNext без лишнего батча
      while (acc.ranked.length < target && !acc.exhausted && budgetLeft()) {
        if (req.signal?.aborted) throw abortError()
        // Группа = реальная потребность (не качаем 4 батча, когда нужен 1),
        // ограниченная параллельностью и остатком бюджета.
        const needBatches = Math.ceil((target - acc.ranked.length) / batchSize)
        const group = Math.min(parallelBatches, needBatches, budgetLimit - batchesThisCall)
        if (group > 1) {
          await fetchGroup(acc, baseExtra, group, req.signal)
          batchesThisCall += group
        } else {
          await fetchOne(acc, baseExtra, req.signal)
          batchesThisCall += 1
        }
        reestimate(goal)
      }
      // Основной контур исчерпал сужение и ничего не принял → один откат на
      // полное сканирование (словарь мог исправить в слово вне подстроки).
      if (
        acc.contour === 'main' &&
        acc.exhausted &&
        acc.ranked.length === 0 &&
        !acc.fallbackTried &&
        budgetLeft()
      ) {
        const correction = acc.correction
        const next = freshState(acc.key, 'fallback')
        next.correction = correction
        next.rankTokens = correction ? prepareQuery(correction.corrected) : prepareQuery(rawQuery)
        Object.assign(acc, next, { fallbackTried: true })
        continue
      }
      const fresh: string[] = []
      for (const entry of acc.ranked) {
        if (acc.emitted.has(entry.id)) continue
        fresh.push(entry.id)
        if (fresh.length === pageSize) break
      }
      if (!fresh.length) break // источник кончился или бюджет вышел — страницы дальше нет
      if (fresh.length < pageSize && !acc.exhausted && budgetLeft()) continue // добор не завершён
      acc.pages.push(fresh)
      for (const id of fresh) acc.emitted.add(id)
      if (!budgetLeft() && acc.pages.length < wanted && !acc.exhausted) break
    }

    const ids = acc.pages[wanted - 1] ?? []
    const items = ids
      .map((id) => acc.byId.get(id))
      .filter((record): record is T => record !== undefined)
    const unemitted = acc.ranked.length - acc.emitted.size
    const hasNext = acc.pages.length > wanted || unemitted > 0 || !acc.exhausted
    opts.onStats?.({
      scanned: acc.recordsSeen,
      matched: acc.ranked.length,
      emitted: acc.emitted.size,
      sourcePage: acc.batchPage,
      exhausted: acc.exhausted,
    })
    // totalItems НЕ отдаётся намеренно: у перехваченной выдачи число страниц
    // непредсказуемо, и PageNav автоматически остаётся на стрелках (R12) —
    // номерная навигация живёт только у неперехваченного источника.
    return { items, hasNext }
  }

  return async (req: PageRequest): Promise<PageResponse<T>> => {
    const rawQuery = String(req.extra?.q ?? '').trim()

    // Fingerprint буфера включает ВСЕ ключи источника (фильтры и т.п.), кроме
    // q: другой набор фильтров — другая выдача источника, буфер строится заново.
    const extraKey = Object.entries(req.extra ?? {})
      .filter(([k, v]) => k !== 'q' && v !== undefined && v !== null && v !== '')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${String(v)}`)
      .join('\u0001')
    const key = `${rawQuery}\u0000${req.pageSize}\u0000${extraKey}`
    if (!state || state.key !== key) state = freshState(key, opts.correct ? 'main' : 'fallback')
    const acc = state

    // Single-flight: replace, prefetch и back/forward делят один буфер и позицию чтения.
    const prev = acc.lock
    const job = (async () => {
      if (prev) await prev.catch(() => undefined)
      return produce(acc, req, rawQuery)
    })()
    acc.lock = job.catch(() => undefined)
    return job
  }
}

/**
 * Перехватчик источника пагинатора: ПОЛИТИКА контуров поверх
 * createAccumulatingSource. Пустой/короткий запрос и SSR/no-JS — сквозной
 * проход в базовый источник (на сервере — подстрока по сырому q, fuzzy не
 * исполняется); живой клиент с запросом — накопительный контур.
 */
export function createSearchInterceptor<T>(opts: SearchInterceptorOptions<T>): Source<T> {
  const minLength = opts.minLength ?? 2
  const accumulate = createAccumulatingSource(opts)
  return async (req: PageRequest): Promise<PageResponse<T>> => {
    const rawQuery = String(req.extra?.q ?? '').trim()

    // Нет запроса → сквозной проход: пагинатор остаётся обычным каталогом.
    if (!rawQuery) {
      opts.onCorrection?.(null)
      opts.onStats?.(null) // перехват неактивен — панель гасит живые счётчики
      return opts.source(req)
    }
    // Короче минимума → каталог без сужения (1 символ не должен резать выдачу).
    if (rawQuery.length < minLength) {
      opts.onCorrection?.(null)
      return opts.source({ ...req, extra: { ...(req.extra ?? {}), q: '' } })
    }
    // Контур SSR/no-JS: серверная подстрока по сырому q, fuzzy не исполняется.
    if (import.meta.env.SSR || typeof window === 'undefined') {
      return opts.source(req)
    }
    return accumulate(req)
  }
}
