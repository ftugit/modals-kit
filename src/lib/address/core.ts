/**
 * Один писатель адреса на приложение (F41) — чистое ядро, без фреймворка.
 *
 * Зачем. Адрес и состояние записи истории делят три владельца: пагинатор
 * (`syncAddress`/`navigate`), модалки (цепочка в `?modal=` и `page.state`) и
 * флаги «мелких» записей (`shallowFlag`). Каждый правит только свои ключи, но
 * собирал следующий адрес из `page.*` в момент вызова, а `goto` в SvelteKit 3
 * асинхронен: пока первая запись в полёте, `page.*` ещё старый, и вторая запись
 * затирала ключи первой. Здесь все записи идут через одну точку:
 *
 *  • **Намерение синхронно.** `visible()` = последняя записанная, но ещё не
 *    применённая цель, иначе — реальность фреймворка (`read()`). Следующая
 *    запись строится от неё, а не от устаревшего `page.*`. Намерение живёт,
 *    только пока есть незаписанное: в покое источник истины — сам фреймворк.
 *  • **В полёте не больше одного коммита.** Остальные ждут в очереди; коммит
 *    материализуется в момент отправки (фрагмент `#якорь` читается тогда же).
 *  • **Замена уточняет последнюю запись, добавление начинает новую.** Две
 *    подряд открытые модалки — два шага истории, а не один; синхронизация
 *    пагинатора после открытия модалки уточняет запись модалки.
 *  • **Обход истории побеждает.** Назад/Вперёд сбрасывают очередь, а запись в
 *    полёте перестаёт быть намерением (отменить её нельзя: фреймворк уже пишет
 *    историю); владельцы пересинхронизируются из реальности сами.
 *  • Чужой переход с загрузкой (ссылка) очередь НЕ останавливает — как и до
 *    общего писателя. Признак «идёт переход» (`navigating` SvelteKit 3.0.1)
 *    бывает непустым и вне настоящего перехода: ожидание по нему выбрасывало
 *    собственный шаг по истории, и ядро модалок ждало обход, которого не было
 *    (R-24, ход 37).
 *  • **Адрес страницы переживает закрытие слоя** (ход 100). Слой (модалка,
 *    список селекта на узком экране, мобильная панель) — своя запись истории;
 *    запись страницы, пока он открыт, уточняет ЕГО запись (замена уточняет
 *    последнюю). Закрытие слоя — свой `go(-n)`, и без переноса браузер вернулся бы
 *    на запись до слоя со старым адресом страницы: выбор в списке «откатывался».
 *    Поэтому после своего шага назад писатель заменяет запись, на которую
 *    вернулись: ключи страницы — из закрытой записи, ключи слоёв (их объявляют
 *    владельцы через `layerKeys`, например цепочка `?modal=`) — из записи
 *    назначения, состояние — тоже её. Фреймворк применяет обход НЕ синхронно с
 *    `popstate` (SvelteKit 3.0.1 ждёт `get_navigation_intent`), а запись до
 *    применения оборвала бы его. Поэтому перенос считается в `popstate` по
 *    адресной строке (`here`) и сразу виден как намерение, а отправляется по
 *    сигналу `applied()` — фреймворк показал запись назначения. Тот же принцип, что у якоря (F39, решение
 *    владельца A): адрес принадлежит странице, а не записи слоя. Обход
 *    пользователя (кнопка «Назад» браузера, Android) переносится, только если
 *    среда сама определила, что обе записи из одной стопки слоёв, и передала
 *    закрытую запись в `external(from)` (ход 106, `layer-links.ts`): писатель
 *    направления и смысла чужого обхода не знает.
 *  • **Отказ коммита не глотается**: промис записи отклоняется, как раньше
 *    отклонялся `goto`. Незаписанные шаги после отказа остаются — они несут
 *    полное намерение и сами повторяют упавшую часть.
 *
 * Таймеров нет: очередь продвигается завершением коммита и событиями среды.
 */

import { checkKeys } from './keys.js'

export interface AddressSnapshot {
  /** Видимый адрес без `#фрагмента` (фрагмент принадлежит странице). */
  readonly url: Readonly<URL>
  /** Состояние текущей записи истории. */
  readonly state: Readonly<Record<string, unknown>>
}

/** Результат правки: адрес (строкой — относительно текущего) и, при желании, состояние. */
export interface AddressChange {
  /** `#фрагмент` в строке — явный; без него при отправке берётся текущий. */
  readonly url: string | Readonly<URL>
  /** Нет — состояние текущей записи остаётся как есть. */
  readonly state?: Readonly<Record<string, unknown>>
}

export interface AddressWriteOptions {
  /** Заменить текущую запись (`true`) или добавить новую (`false`). */
  readonly replace: boolean
  /** Обычная навигация с загрузкой данных, а не «мелкая» запись. */
  readonly load?: boolean
  /**
   * Владелец правки (бронь `claimQuery` из `keys.ts`): при том же пути
   * изменившиеся ключи обязаны быть своими, чужое — запись отклоняется.
   */
  readonly owner?: string
}

export interface AddressCommit {
  readonly href: string
  readonly state: Record<string, unknown>
  readonly replace: boolean
  readonly load: boolean
}

export interface AddressWriterDeps {
  /** Реальность фреймворка: видимый адрес и состояние текущей записи. */
  read(): AddressSnapshot
  /** Отправить шаг. Промис — до применения (или отмены) фреймворком. */
  commit(step: AddressCommit): Promise<unknown>
  /** `#фрагмент` адресной строки в момент отправки. */
  hash?(): string
  /** Шаг по истории. */
  traverse?(delta: number): void
  /**
   * Адресная строка браузера целиком. В `popstate` она уже указывает на запись
   * назначения, а `read()` — ещё нет. Нет — перенос считается и уходит сразу.
   */
  here?(): URL
}

/** Ключ строки запроса принадлежит слою (модалкам), а не странице. */
export type LayerKeyTest = (key: string) => boolean

export interface AddressWriter {
  /** Намерение, если есть незаписанное, иначе реальность. */
  visible(): AddressSnapshot
  /** Записать правку от текущего намерения. */
  write(change: (current: AddressSnapshot) => AddressChange, options: AddressWriteOptions): Promise<void>
  /** Шаг по истории — после того как применятся записи, сделанные до него. */
  go(delta: number): void
  /**
   * Обход истории (Назад/Вперёд, в том числе свой `go`): незаписанное устарело.
   * `from` — запись, с которой ушли, если среда установила, что она и запись
   * назначения из одной стопки слоёв: тогда адрес страницы переносится и при
   * чужом обходе. Без `from` переносит только свой шаг назад.
   */
  external(from?: { readonly url: Readonly<URL>; readonly hash: string }): void
  /**
   * Фреймворк применил изменение адреса (реактивный сигнал среды). Нужен для
   * переноса адреса страницы после закрытия слоя — см. `here`.
   */
  applied(): void
  /**
   * Объявить ключи строки запроса, которые принадлежат слою (цепочка модалок):
   * при закрытии слоя они НЕ переносятся с закрытой записи. Остальные ключи —
   * адрес страницы — переносятся. Возвращает отмену объявления.
   */
  layerKeys(test: LayerKeyTest): () => void
  /** Намерение изменилось (для реактивных читателей). */
  subscribe(fn: () => void): () => void
  /** Записей нет ни в очереди, ни в полёте. */
  readonly idle: boolean
  /**
   * Свой шаг по истории ждёт отправки или своего `popstate`. Изменение адреса
   * в это окно — применение записи, сделанной ДО шага, а не итог обхода.
   */
  readonly traversing: boolean
}

type Waiter = { resolve: () => void; reject: (e: unknown) => void }
type WriteStep = {
  kind: 'write'
  url: URL
  hash: string | null
  state: Record<string, unknown>
  replace: boolean
  load: boolean
  waiters: Waiter[]
  /**
   * Состояние — записи, на которой окажется коммит, в момент отправки. Так у
   * записи, сделанной, пока обход ещё применяется (перенос ждёт `applied()`):
   * её `visible().state` — ещё состояние закрытого слоя.
   */
  inheritState?: boolean
}
type GoStep = { kind: 'go'; delta: number; waiters: Waiter[] }
type Step = WriteStep | GoStep

const withoutHash = (url: Readonly<URL>): URL => {
  const copy = new URL(url.href)
  copy.hash = ''
  return copy
}

const sameState = (a: unknown, b: unknown): boolean => {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function createAddressWriter(deps: AddressWriterDeps): AddressWriter {
  const queue: Step[] = []
  let inflight: WriteStep | null = null
  // Запись в полёте, которую обогнала внешняя навигация: отменить её нельзя,
  // но и намерением она больше не является — видимым снова становится `read()`.
  let orphan: WriteStep | null = null
  // Свой шаг по истории отправлен, `popstate` ещё не пришёл: следующая запись
  // легла бы в историю раньше самого перехода (браузер обходит историю позже).
  // Так же ждёт своего обхода и ядро модалок — без таймеров.
  let traversing = false
  // Адрес закрываемой записи в момент своего шага НАЗАД: после `popstate` ключи
  // страницы из него переносятся на запись назначения (ход 100).
  let leaving: { url: URL; hash: string } | null = null
  // Перенос посчитан в `popstate`, ждёт применения обхода фреймворком.
  let carry: { url: URL; hash: string | null } | null = null
  const layerTests = new Set<LayerKeyTest>()
  const listeners = new Set<() => void>()
  const isLayerKey = (key: string) => [...layerTests].some((test) => test(key))

  const emit = () => {
    for (const fn of [...listeners]) fn()
  }

  const settle = (step: Step, error?: unknown) => {
    for (const w of step.waiters) error === undefined ? w.resolve() : w.reject(error)
  }

  const lastWrite = (): WriteStep | null => {
    for (let i = queue.length - 1; i >= 0; i--) {
      const step = queue[i]!
      if (step.kind === 'write') return step
    }
    return inflight === orphan ? null : inflight
  }

  function visible(): AddressSnapshot {
    // Реальность читается ВСЕГДА: реактивный читатель обязан зависеть от неё
    // и тогда, когда сейчас отвечает намерение — иначе после применения записи
    // его вычисление не перезапустилось бы.
    const real = deps.read()
    const intent = lastWrite()
    if (intent) return { url: new URL(intent.url.href), state: intent.state }
    // Обход ещё применяется: адрес — уже перенесённый, состояние — фреймворка.
    if (carry) return { url: new URL(carry.url.href), state: real.state }
    return { url: withoutHash(real.url), state: real.state }
  }

  function dropQueued() {
    // Выброшенная запись не ошибка: её отменила навигация пользователя.
    for (const step of queue.splice(0)) settle(step)
  }

  function pump() {
    // Пока обход не применён, коммит оборвал бы его (SvelteKit отменяет
    // навигацию `popstate`, если началась другая): записи ждут `applied()`.
    while (!inflight && !traversing && !carry && queue.length > 0) {
      const step = queue.shift()!
      if (step.kind === 'go') {
        settle(step)
        if (!deps.traverse) continue
        traversing = true
        // Очередь до шага пуста и коммитов в полёте нет: `read()` — уже применённый
        // адрес закрываемой записи, со всеми записями страницы, сделанными в ней.
        leaving = step.delta < 0 ? { url: withoutHash(deps.read().url), hash: deps.hash?.() ?? '' } : null
        deps.traverse(step.delta)
        return
      }
      const real = deps.read()
      if (step.inheritState) {
        step.state = { ...real.state }
        step.inheritState = false
      }
      if (
        step.replace &&
        !step.load &&
        real.url.pathname === step.url.pathname &&
        real.url.search === step.url.search &&
        (step.hash === null || step.hash === real.url.hash) &&
        sameState(real.state, step.state)
      ) {
        // Записывать нечего: замена на то же самое — без `goto`.
        settle(step)
        emit()
        continue
      }
      inflight = step
      const href = step.url.pathname + step.url.search + (step.hash ?? deps.hash?.() ?? '')
      let sent: Promise<unknown>
      try {
        sent = Promise.resolve(
          deps.commit({ href, state: step.state, replace: step.replace, load: step.load }),
        )
      } catch (error) {
        sent = Promise.reject(error)
      }
      const done = (error?: unknown) => {
        inflight = null
        if (orphan === step) orphan = null
        settle(step, error)
        emit()
        pump()
      }
      sent.then(
        () => done(),
        (error: unknown) => done(error ?? new Error('address commit rejected')),
      )
    }
  }

  /**
   * Адрес записи назначения с перенесённым адресом страницы: ключи страницы — из
   * закрытой записи (в их порядке), ключи слоёв — из назначения. Другой путь —
   * не закрытие слоя, а уход со страницы: переносить нечего. `#якорь`
   * переносится, если в закрытой записи он был и отличается. `null` — адрес
   * страницы под слоем не менялся.
   */
  function carried(from: { url: URL; hash: string }, here: URL, hereHash: string) {
    if (here.pathname !== from.url.pathname) return null
    const params = new URLSearchParams()
    for (const [k, v] of from.url.searchParams) if (!isLayerKey(k)) params.append(k, v)
    for (const [k, v] of here.searchParams) if (isLayerKey(k)) params.append(k, v)
    const pageOf = (p: URLSearchParams) =>
      [...p].filter(([k]) => !isLayerKey(k)).map(([k, v]) => `${k}=${v}`).sort().join('&')
    const hash = from.hash !== '' && from.hash !== hereHash ? from.hash : null
    if (pageOf(params) === pageOf(here.searchParams) && hash === null) return null
    const qs = params.toString()
    return { url: new URL(`${here.pathname}${qs ? `?${qs}` : ''}`, here), hash }
  }

  /** Отправить перенос: состояние — записи назначения, уже применённой фреймворком. */
  function sendCarry(target: { url: URL; hash: string | null }) {
    const real = deps.read()
    // Фреймворк ушёл на другой путь (обход перебила навигация) — не наше.
    if (withoutHash(real.url).pathname !== target.url.pathname) return
    // В НАЧАЛО очереди: записи, сделанные, пока обход применялся, построены
    // поверх перенесённого адреса и должны лечь после него.
    queue.unshift({ kind: 'write', url: target.url, hash: target.hash, state: { ...real.state }, replace: true, load: false, waiters: [] })
  }

  return {
    visible,

    write(change, options) {
      const current = visible()
      const next = change(current)
      const raw = typeof next.url === 'string' ? next.url : next.url.href
      const url = new URL(raw, current.url)
      const hash = typeof next.url === 'string' && raw.includes('#') ? url.hash : null
      url.hash = ''
      // Та же страница — правка адреса, и ключи обязаны быть своими (бронь
      // `keys.ts`). Чужой ключ — отклонение записи, мимо брони не пройти.
      if (options.owner && url.pathname === current.url.pathname)
        checkKeys(options.owner, current.url.search, url.search)
      const state = { ...(next.state ?? current.state) }
      const load = options.load ?? false
      const inheritState = carry !== null && next.state === undefined

      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject }
        const last = queue.at(-1)
        if (options.replace && last?.kind === 'write') {
          // Замена ещё не отправленной записи: уточняем её, шаг истории тот же.
          last.url = url
          last.hash = hash
          last.state = state
          last.load ||= load
          last.inheritState = next.state === undefined ? last.inheritState || inheritState : false
          last.waiters.push(waiter)
        } else {
          queue.push({ kind: 'write', url, hash, state, replace: options.replace, load, waiters: [waiter], inheritState })
        }
        emit()
        pump()
      })
    },

    go(delta) {
      queue.push({ kind: 'go', delta, waiters: [] })
      pump()
    },

    external(given) {
      const wasTraversing = traversing
      traversing = false
      // Источник переноса: от среды (обе записи из одной стопки) или свой шаг назад.
      const from = given ? { url: withoutHash(given.url), hash: given.hash } : wasTraversing ? leaving : null
      leaving = null
      // Новый обход отменяет ещё не отправленный перенос прежнего.
      const hadCarry = carry !== null
      carry = null
      // Перенос считается синхронно, в том же `popstate`: намерение (адрес
      // страницы) видно читателям сразу, без мигания старого адреса.
      if (from) {
        const here = deps.here ? withoutHash(deps.here()) : withoutHash(deps.read().url)
        carry = carried(from, here, deps.hash?.() ?? '')
      }
      if (!carry && !hadCarry && queue.length === 0 && (!inflight || orphan === inflight)) return
      orphan = inflight
      dropQueued()
      if (carry && !deps.here) {
        // Среда без адресной строки (тесты, SSR-заглушки): применение синхронно.
        const target = carry
        carry = null
        sendCarry(target)
      }
      emit()
      if (wasTraversing || queue.length > 0) pump()
    },

    applied() {
      if (!carry) return
      const target = carry
      carry = null
      sendCarry(target)
      emit()
      pump()
    },

    layerKeys(test) {
      layerTests.add(test)
      return () => layerTests.delete(test)
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    get idle() {
      return !inflight && queue.length === 0
    },

    get traversing() {
      return traversing || queue.some((step) => step.kind === 'go')
    },
  }
}

/**
 * Параметр `next`/`return` из запроса → ЛОКАЛЬНЫЙ путь или null: защита от
 * открытого редиректа. Схема/автор/`//` не проходят; ведущий слэш обязателен.
 * Место helper-а — здесь, у слоя адреса: семантика «куда можно вернуть
 * пользователя» — адресная, не доменная.
 */
export function localPath(raw: string | null | undefined): string | null {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}
