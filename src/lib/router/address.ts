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
 *  • **Отказ коммита не глотается**: промис записи отклоняется, как раньше
 *    отклонялся `goto`. Незаписанные шаги после отказа остаются — они несут
 *    полное намерение и сами повторяют упавшую часть.
 *
 * Таймеров нет: очередь продвигается завершением коммита и событиями среды.
 */

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
}

export interface AddressWriter {
  /** Намерение, если есть незаписанное, иначе реальность. */
  visible(): AddressSnapshot
  /** Записать правку от текущего намерения. */
  write(change: (current: AddressSnapshot) => AddressChange, options: AddressWriteOptions): Promise<void>
  /** Шаг по истории — после того как применятся записи, сделанные до него. */
  go(delta: number): void
  /** Обход истории (Назад/Вперёд, в том числе свой `go`): незаписанное устарело. */
  external(): void
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
  const listeners = new Set<() => void>()

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
    return { url: withoutHash(real.url), state: real.state }
  }

  function dropQueued() {
    // Выброшенная запись не ошибка: её отменила навигация пользователя.
    for (const step of queue.splice(0)) settle(step)
  }

  function pump() {
    while (!inflight && !traversing && queue.length > 0) {
      const step = queue.shift()!
      if (step.kind === 'go') {
        settle(step)
        if (!deps.traverse) continue
        traversing = true
        deps.traverse(step.delta)
        return
      }
      const real = deps.read()
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

  return {
    visible,

    write(change, options) {
      const current = visible()
      const next = change(current)
      const raw = typeof next.url === 'string' ? next.url : next.url.href
      const url = new URL(raw, current.url)
      const hash = typeof next.url === 'string' && raw.includes('#') ? url.hash : null
      url.hash = ''
      const state = { ...(next.state ?? current.state) }
      const load = options.load ?? false

      return new Promise<void>((resolve, reject) => {
        const waiter = { resolve, reject }
        const last = queue.at(-1)
        if (options.replace && last?.kind === 'write') {
          // Замена ещё не отправленной записи: уточняем её, шаг истории тот же.
          last.url = url
          last.hash = hash
          last.state = state
          last.load ||= load
          last.waiters.push(waiter)
        } else {
          queue.push({ kind: 'write', url, hash, state, replace: options.replace, load, waiters: [waiter] })
        }
        emit()
        pump()
      })
    },

    go(delta) {
      queue.push({ kind: 'go', delta, waiters: [] })
      pump()
    },

    external() {
      const wasTraversing = traversing
      traversing = false
      if (queue.length === 0 && (!inflight || orphan === inflight)) return
      orphan = inflight
      dropQueued()
      emit()
      if (wasTraversing) pump()
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
