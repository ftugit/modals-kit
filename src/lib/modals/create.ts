// Модальная система.
//
//     модалка(ядро(хранилище), опции)
//
// Единственный собеседник модалки — ЯДРО. Ни движка, ни хранилища она
// не знает: как цепочка попадает в адрес, в localStorage или в состояние
// записи истории — целиком забота ядра.
//
// Так было не сразу: сначала `createModals` принимал среду и хранилище
// отдельно и сам их связывал. Тогда знание «адресуемое хранилище или нет»
// протекало в слой модалки — четыре ветвления по `storage.addressable`
// в коде, которому до носителя нет никакого дела. Проводка уехала
// в `build.ts`, то есть внутрь ядра.
import { chainEquals, closedSuffix, hasLockedEntry, isChainLocked, nextChain, resolveEntry, sameEntry } from './core'
import { createModalStore, type ModalStore } from './store'
import { DEFAULT_HOST_CONFIG } from './types'
import type {
  Chain, ChainOverrides, HostConfig, LibError, ErrorSink, ModalContext, RegisteredEntry, StackMode, TransientEntry,
} from './types'
import { entryLabel } from './types'
import type { AnyDefinition } from './registry'
import { assertTransient, assertTransientOnTop, type ModalCore } from './core-contract'

export interface OpenOptions<P extends Record<string, unknown> = Record<string, unknown>>
  extends ChainOverrides {
  /** Параметры, передаваемые новой зарегистрированной записи. */
  params?: P
  /** В каком источнике держать запись. По умолчанию — как объявлено у модалки. */
  source?: string
  /** заменить запись истории вместо добавления */
  replace?: boolean
  /**
   * Что сделать с текущей стопкой: `'new'` — начать новую, `'first'` —
   * закрыть текущую до первой модалки и открыть поверх неё.
   * По умолчанию — дополнить текущую. См. `StackMode` (§6 №9).
   */
  stack?: StackMode
}

/** Опции headless-записи: те же overrides, но без содержимого. */
export interface HeadlessOptions extends ChainOverrides {
  /** Заменить текущую history-запись вместо создания новой. */
  replace?: boolean
}

/** Опции разового transient-слоя с необязательным содержимым. */
export interface LayerOptions extends ChainOverrides {
  /**
   * Содержимое слоя. Ядру непрозрачно — разворачивает слой вида.
   *
   * Необязательно: слой может быть пустой оболочкой, в которую содержимое
   * въезжает порталом. Так делает `select` на узком экране — ему нужны фон,
   * scroll-lock и ловушка фокуса, а разметку он отдаёт сам.
   */
  content?: unknown
  /** Заменить текущую history-запись вместо создания новой. */
  replace?: boolean
}

/** Опции по умолчанию: то, чем модалка рисуется, если запись не сказала иначе. */
export type ModalsOptions<V = unknown> = Partial<HostConfig<V>>

export interface Modals<V = unknown> {
  /** Ядро. Единственная дверь наружу. */
  readonly core: ModalCore
  /** Состояние: цепочка, настройки, загрузка, обмен данными. */
  readonly store: ModalStore
  /** Текущие настройки хоста. */
  readonly config: HostConfig<V>

  /** Изменить настройки хоста на лету (хост зовёт на смену пропсов). */
  configure(patch: Partial<HostConfig<V>>): void

  /** Подключить ядро: прочитать начальную цепочку и следить за внешними изменениями. */
  attach(): () => void

  /** Текущая цепочка. */
  readonly chain: Chain

  /* ── действия ── */

  /** Открыть зарегистрированную модалку по имени. */
  open<P extends Record<string, unknown>>(name: string, options?: OpenOptions<P>): void
  /** Открыть разовый слой со своим содержимым. Возвращает его id. */
  openLayer(options: LayerOptions): string
  /**
   * Открыть запись цепочки БЕЗ собственного DOM. Возвращает её id.
   *
   * Запись участвует в истории и порядке закрытия, но хост для неё ничего
   * не рисует. Нужна, чтобы навесить свойства модалки на уже существующий
   * узел, не перенося его в слой (см. ChainOverrides.headless).
   */
  openHeadless(options?: HeadlessOptions): string
  /** Содержимое разового слоя по id (нужно слою вида). */
  layerContent(id: string): unknown
  /** Закрыть верхнюю. Заблокированная не закрывается. */
  close(options?: { replace?: boolean }): boolean
  /** Закрыть всё. Если внутри есть заблокированная — не трогает. */
  closeAll(): boolean
  /** Единственный способ закрыть заблокированную. */
  forceClose(name?: string): void
  /** Инвалидировать или очистить кэш асинхронных данных модалок. */
  invalidateLoader(name?: string, params?: Record<string, unknown>): void
  /**
   * Подключить приёмник ошибок (Q1). Отписка — при размонтировании.
   * Бросок приёмника распространяется вверх: серверный фатал доезжает до 500.
   */
  onError(sink: ErrorSink): () => void
  /** Сообщить конверт всем приёмникам (зовут загрузчик и точки размещения). */
  reportError(e: LibError): void
  /** Принудительно чистит всю цепочку, включая заблокированные записи. */
  forceCloseAll(): void
}

/**
 * @param core   ядро со своим хранилищем: `svelteKitCore()`, `memoryCore()`
 * @param options умолчания внешнего вида и поведения
 */
export function createModals<V = unknown>(
  core: ModalCore,
  options: ModalsOptions<V> & { onError?: ErrorSink } = {},
): Modals<V> {
  const store = createModalStore()

  // Q1: приёмник — НЕ часть HostConfig, выделен до копирования умолчаний,
  // иначе осел бы в store как настройка внешнего вида.
  const { onError, ...hostOptions } = options
  const errorSinks = new Set<ErrorSink>(onError ? [onError] : [])

  // Умолчания задаются один раз при создании; запись цепочки может их
  // переопределить своими `overrides`.
  const clean = Object.fromEntries(
    Object.entries(hostOptions).filter(([, v]) => v !== undefined),
  ) as Partial<HostConfig>
  store.set({ hostConfig: { ...DEFAULT_HOST_CONFIG, ...clean } })

  /** Содержимое разовых слоёв. В адрес и хранилище не попадает. */
  const layers = new Map<string, unknown>()
  let layerSeq = 0

  /**
   * Метка headless-записи: содержимого нет и не будет, но запись живая.
   *
   * Кладётся в тот же `layers`, потому что `aliveOnly` отсеивает
   * transient-записи именно по отсутствию содержимого. Без метки
   * headless-запись считалась бы осиротевшей и умирала сразу.
   */
  const HEADLESS = Symbol('headless')

  const lockedTop = (chain: Chain): boolean => {
    const top = chain[chain.length - 1]
    return top ? top.overrides.lock === true : false
  }
  const hasLocked = (chain: Chain): boolean => chain.some((e) => e.overrides.lock === true)

  /**
   * Единственная точка записи цепочки.
   *
   * Закрытие — это шаг НАЗАД по истории, а не новая запись: иначе pushState
   * затрёт стек «Вперёд», и вернуть модалку кнопкой браузера будет нельзя.
   */
  const commit = (next: Chain, options?: { replace?: boolean }) => {
    const prev = store.state.chain
    if (chainEquals(prev, next)) return

    // Проверяем до изменения store: core.write() тоже проверяет инвариант,
    // но ошибка после store.set() оставляла UI с transient в середине цепочки,
    // хотя history оставалась прежней. Одна проверка здесь делает отклонённое
    // открытие атомарным — и Back/Forward продолжают работать с тем же снимком.
    assertTransientOnTop(next)

    // Состояние обновляем ПЕРВЫМ, до записи в ядро.
    //
    // `core.write` уведомляет подписчиков, и одним из них является `sync`.
    // Если стор ещё хранит прежнюю цепочку, `sync` примет наше собственное
    // изменение за внешнее: применит его повторно и второй раз вызовет
    // события жизненного цикла. При обновлённом сторе эхо гасится
    // сравнением `chainEquals` внутри `sync`.
    store.set({ chain: next })

    const closed = (options?.replace || isNonTailEdited) ? null : closedSuffix(prev, next)
    if (closed !== null && core.back) {
      core.back(closed, next)
    } else {
      core.write(next, options)
      if (next.length <= 1) isNonTailEdited = false
    }

    fireLifecycle(prev, next)
    releaseLayers(prev, next)
  }


  /**
   * Освобождение содержимого снятых разовых слоёв.
   *
   * 🔴 Почему не сразу в `commit`: пока играет анимация выхода, хост ещё
   * рисует уходящий слой и читает его содержимое через `layerContent`.
   * Удаление в тот же такт показало бы пустую оболочку вместо уходящей
   * модалки. Поэтому содержимое отпускается на СЛЕДУЮЩЕЙ смене цепочки —
   * к этому моменту анимация давно закончилась.
   *
   * 🔴 Отсрочка нужна и headless-записям, хотя рисовать им нечего:
   * `aliveOnly` опознаёт живую запись именно по наличию в карте, а
   * `noForward` успевает почистить историю только пока запись «жива».
   * Снятая сразу метка ломала разбор «Вперёд» (поймано регрессией R-03).
   */
  let pendingRelease: string[] = []
  let isNonTailEdited = false
  const releaseLayers = (prev: Chain, next: Chain) => {
    const alive = new Set(
      next.filter((e): e is TransientEntry => e.kind === 'transient').map((e) => e.id),
    )
    // 🔴 Живые записи не трогаем, даже если они числились в отложенных.
    //
    // «Вперёд» возвращает закрытый слой в цепочку, и к этому моменту он уже
    // лежал в `pendingRelease`. Безусловная чистка стирала содержимое
    // вернувшейся записи — слой оказывался пустой оболочкой. Поймано
    // независимым разбором (механизм 3) и закреплено тестом в build.test.ts.
    for (const id of pendingRelease) {
      if (!alive.has(id)) layers.delete(id)
    }
    pendingRelease = []
    for (const e of prev) {
      if (e.kind !== 'transient' || alive.has(e.id) || !layers.has(e.id)) continue
      pendingRelease.push(e.id)
    }
  }

  /**
   * Отсев осиротевших разовых слоёв.
   *
   * Запись истории переживает перезагрузку, а содержимое слоя — нет: оно
   * лежало в памяти вкладки. После F5 в состоянии остаётся id, за которым
   * ничего нет. Такой слой считается закрытым, а запись истории подчищается
   * заменой — иначе глубина врёт и `back()` посчитает лишние шаги.
   */
  const aliveOnly = (chain: Chain): Chain =>
    chain.filter((e) => e.kind !== 'transient' || layers.has(e.id))

  /**
   * Разовый слой, содержимого которого больше нет (перезагрузка стёрла
   * память вкладки), считается закрытым.
   *
   * Запись истории при этом НЕ правим: попытка сделать это на холодном
   * старте падает («Cannot call replaceState before router is initialized»),
   * а отложенная правка затирала цепочку, если пользователь успевал
   * что-то нажать. Вместо этого мёртвую запись учитывает `back()`
   * через метку глубины.
   */
  const prune = (chain: Chain): Chain => aliveOnly(chain)


  const lookup = (core.lookup ?? (() => undefined)) as (n: string) => AnyDefinition | undefined

  const ctxOf = (chain: Chain, index: number): ModalContext => {
    const e = chain[index]
    const r = resolveEntry(e, index, lookup)
    return {
      name: entryLabel(e), index, depth: chain.length,
      params: r.params, chain, data: store.state.sharedData,
    }
  }

  /** Кто открылся и кто закрылся между двумя цепочками. */
  const fireLifecycle = (prev: Chain, next: Chain) => {
    const cfg = store.state.hostConfig
    const id = (e: Chain[number], i: number) => `${i}:${entryLabel(e)}`
    const prevIds = prev.map(id)
    const nextIds = next.map(id)

    next.forEach((e, i) => {
      if (prevIds.includes(id(e, i))) return
      const ctx = ctxOf(next, i)
      lookup(entryLabel(e))?.onOpen?.(ctx)
      cfg.onModalOpen?.(ctx)
    })
    prev.forEach((e, i) => {
      if (nextIds.includes(id(e, i))) return
      lookup(entryLabel(e))?.onClose?.(ctxOf(prev, i))
    })
    // хост: только первая в стопке, вложенные не триггерят
    if (prev.length === 0 && next.length > 0) cfg.onHostOpen?.(ctxOf(next, next.length - 1))
    if (prev.length > 0 && next.length === 0) cfg.onHostClose?.()
  }

  /**
   * Применение цепочки, пришедшей ИЗВНЕ (Назад/Вперёд, чужая вкладка).
   * Порт `applyFromStore` оригинала: без него `lock` и `noForward`
   * оставались только в типах, а поведения за ними не было.
   */
  const sync = (incoming: Chain) => {
    const prev = store.state.chain
    const alive = prune(incoming)
    if (chainEquals(prev, alive)) return

    // Блокировка: внешнее изменение не должно закрывать заблокированную —
    // возвращаем адрес обратно.
    if (isChainLocked(prev, lookup) && alive.length < prev.length) {
      core.write(prev, { replace: true })
      return
    }

    // noForward: запись, которой не было в прошлой цепочке, всплыла
    // из истории («Вперёд»). Такую модалку не открываем и чистим адрес.
    // Сравнение — sameEntry: `source` проставляется источником при чтении,
    // и без проекции собственное эхо выглядело бы «новой» записью.
    let next = alive
    const cut = alive.findIndex(
      (e, i) =>
        resolveEntry(e, i, lookup).noForward &&
        !sameEntry(prev[i], e),
    )
    if (cut >= 0) {
      next = alive.slice(0, cut)
      core.write(next, { replace: true })
    }
    if (chainEquals(prev, next)) return

    store.set({ chain: next })
    fireLifecycle(prev, next)
    releaseLayers(prev, next)
  }

  const api: Modals<V> = {
    core,
    store,

    get config() {
      return store.state.hostConfig as HostConfig<V>
    },

    get chain() {
      return store.state.chain
    },

    configure(patch) {
      const next = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ) as Partial<HostConfig>
      store.set({ hostConfig: { ...store.state.hostConfig, ...next } })
    },

    /**
     * Читает начальную цепочку и подписывается на внешние изменения
     * (Назад/Вперёд, соседняя вкладка). Возвращает отписку.
     *
     * Применение цепочки с учётом `lock` и `noForward`, а также вызов
     * `onOpen`/`onClose` появятся вместе с действиями — см. `HOST-GAP.md`.
     */
    attach() {
      const first = prune(core.read())
      store.set({ chain: first })
      fireLifecycle([], first)
      const off = core.subscribe?.(sync)
      return () => off?.()
    },

    open(name, options = {}) {
      const { params, replace, source, stack, ...overrides } = options
      const clean: ChainOverrides = {}
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) (clean as Record<string, unknown>)[k] = v
      }
      const entry: RegisteredEntry = {
        kind: 'registered',
        name,
        params: (params ?? {}) as Record<string, unknown>,
        overrides: clean,
        ...(source ? { source } : null),
      }
      /**
       * 🔴 Системные оверлеи уступают место зарегистрированной записи.
       *
       * Запись без собственного DOM (`headless`) — эфемерный UI поверх
       * страницы, а не содержимое стопки. Если оставить её под новой
       * зарегистрированной записью, нарушается инвариант «transient только
       * на вершине» (`assertTransientOnTop`): адрес кодирует параметры
       * позиционно, а при чтении transient-записи всегда дописываются в
       * конец — порядок было бы не восстановить.
       *
       * Без этого открытие модалки поверх открытого мобильного листа
       * бросало исключение прямо в `write`: модалка рисовалась, но адрес
       * не писался, и после перезагрузки она пропадала. Найдено при
       * проверке независимого разбора (механизм 5).
       *
       * Хост увидит пропажу записи своим эффектом и закроет лист —
       * открытие модалки поверх списка его и должно закрывать.
       */
      const base = store.state.chain.filter((e) => e.overrides.headless !== true)
      // Режим стопки ('new'/'first') — по решению владельца (§6 №9):
      // раньше такого у действия не было вовсе (наследие fromRoot, №8).
      isNonTailEdited = false
      commit(nextChain(base, entry, stack), { replace })
    },

    openLayer({ content, replace, ...overrides }) {
      assertTransient(core)
      const id = `layer-${++layerSeq}`
      layers.set(id, content)
      const clean: ChainOverrides = {}
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) (clean as Record<string, unknown>)[k] = v
      }
      const entry: TransientEntry = { kind: 'transient', id, overrides: clean }
      isNonTailEdited = false
      commit([...store.state.chain, entry], { replace })
      return id
    },

    openHeadless(options = {}) {
      assertTransient(core)
      const { replace, ...overrides } = options
      const id = `headless-${++layerSeq}`
      layers.set(id, HEADLESS)
      const clean: ChainOverrides = { headless: true }
      for (const [k, v] of Object.entries(overrides)) {
        if (v !== undefined) (clean as Record<string, unknown>)[k] = v
      }
      const entry: TransientEntry = { kind: 'transient', id, overrides: clean }
      isNonTailEdited = false
      commit([...store.state.chain, entry], { replace })
      return id
    },

    // Содержимого у headless-записи нет: отдаём undefined, чтобы хост
    // ничего не пытался отрисовать, но запись при этом остаётся живой.
    layerContent: (id) => {
      const value = layers.get(id)
      return value === HEADLESS ? undefined : value
    },

    close(options) {
      const chain = store.state.chain
      if (chain.length === 0) return false
      if (isChainLocked(chain, lookup)) return false
      commit(chain.slice(0, -1), options?.replace ? { replace: true } : undefined)
      return true
    },

    closeAll() {
      const chain = store.state.chain
      if (chain.length === 0) return false
      if (hasLockedEntry(chain, lookup)) return false
      commit([])
      return true
    },

    forceClose(name) {
      const chain = store.state.chain
      if (chain.length === 0) return
      if (!name) return commit(chain.slice(0, -1))
      const next = chain.filter((e) => (e.kind === 'registered' ? e.name : e.id) !== name)
      if (next.length === chain.length) return
      const top = chain[chain.length - 1]
      const topKey = top.kind === 'registered' ? top.name : top.id
      const isTop = topKey === name
      if (!isTop) isNonTailEdited = true
      commit(next, isTop ? undefined : { replace: true })
    },

    // forceCloseAll оригинала (registry.ts): в отличие от closeAll не
    // проверяет lock — «принудительно» и есть смысл метода.
    forceCloseAll() {
      if (store.state.chain.length === 0) return
      commit([])
    },

    invalidateLoader(name, params) {
      store.clearMemory(name, params)
    },

    onError(sink) {
      errorSinks.add(sink)
      return () => {
        errorSinks.delete(sink)
      }
    },

    reportError(e) {
      for (const sink of errorSinks) sink(e)
    },
  }

  return api
}
