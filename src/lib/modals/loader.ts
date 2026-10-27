// Ленивые модалки: кеш по имя+параметры, одна загрузка на ключ с подпиской
// нескольких записей, отмена при уходе последнего подписчика, предзагрузка
// для кнопки. Порт `loader.ts` оригинала.
//
// Фреймворка здесь нет вовсе: `definition.loader(params, signal)` — это код
// потребителя, а `AbortController` — веб-стандарт. В оригинале единственной
// связью с Solid был `import type { Accessor }`, то есть только тип.
import { loaderKey, runtimeKey } from './core'
import type { AnyDefinition } from './registry'
import type { ModalStore } from './store'
import type { LibError, ResolvedEntry, RuntimeState } from './types'

export interface LoaderDeps {
  store: ModalStore
  /**
   * Сообщить конверт в приёмники хоста (Q1): unknown-запись, сбой загрузчика,
   * сбой предзагрузки. Бросок — вверх (так серверный фатал доезжает до 500).
   */
  report?: (e: LibError) => void
  lookup: (name: string) => AnyDefinition | undefined
  /**
   * Данные маршрута силами фреймворка (`core.preload`). Есть — у модалки
   * с `route` собственный `loader` не нужен: данные берёт загрузчик самой
   * страницы, и дублирования «страница грузит своё, модалка то же ещё раз»
   * не возникает.
   */
  preload?: (href: string) => Promise<{ ok: true; data: unknown } | { ok: false; reason: string }>
  /**
   * Дождаться вида записи (слой вида: доехавший чанк ленивого компонента).
   * Готовность — данные И вид: без этого между скелетоном и содержимым
   * оставался пустой кадр на время импорта. Ядру вид непрозрачен — здесь
   * только ожидание. Нет хука — готовность по-прежнему только данные.
   */
  ensureView?: (definition: AnyDefinition) => Promise<void>
  /** href полноэкранной страницы записи, если он есть. */
  hrefOf?: (entry: ResolvedEntry) => string | null
  /** Максимальное количество записей в кэше данных. По умолчанию 50. */
  maxEntries?: number
}

export function createLoader(deps: LoaderDeps) {
  const { store, lookup } = deps
  const maxEntries = deps.maxEntries ?? 50

  /** Кеш по имени + параметрам: повторное открытие не грузит заново. */
  const cache = new Map<string, unknown>()

  /**
   * Одна загрузка на имя+параметры, общая для записей стопки и предзагрузки
   * кнопки. `keys` — записи, ждущие результата в runtime; `preloads` —
   * ожидающие `preloadModal`. Загрузка отменяется, когда не ждёт никто
   * (F33, F34 — раньше предзагрузка шла мимо этой карты и грузила второй раз).
   */
  interface Job {
    controller: AbortController
    keys: Set<string>
    preloads: number
    /** Сбой уже отправлен в report как load-failed — preload не дублирует. */
    reported: boolean
    done: Promise<unknown>
    /** Данные после готовности вида: этим ожиданием ставится `ready`. */
    ready: Promise<unknown>
  }
  const inflight = new Map<string, Job>()

  /**
   * Ключи кеша записей, которые сейчас в стопке, — по РАЗРЕШЁННЫМ параметрам
   * (с `defaultParams`), как их грузит хост. По сырым параметрам цепочки
   * защита не узнавала модалки с умолчаниями (F32).
   */
  function pinnedKeys(): Set<string> {
    const keys = new Set<string>()
    for (const e of store.state.chain) {
      if (e.kind !== 'registered') continue
      const defaults = lookup(e.name)?.defaultParams ?? {}
      keys.add(loaderKey(e.name, { ...defaults, ...(e.params ?? {}) }))
    }
    return keys
  }

  function evictIfNeeded() {
    if (cache.size <= maxEntries) return
    // Активные модалки в стопке защищены от вытеснения (pinning)
    const pinned = pinnedKeys()
    for (const key of cache.keys()) {
      if (cache.size <= maxEntries) break
      if (!pinned.has(key)) cache.delete(key)
    }
  }

  function cacheSet(key: string, data: unknown) {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, data)
    evictIfNeeded()
  }

  function cacheGet(key: string) {
    if (!cache.has(key)) return undefined
    const val = cache.get(key)
    cache.delete(key)
    cache.set(key, val)
    return val
  }

  // Кеш сбрасывается вместе с остальной памятью модалок.
  const offCleaner = store.registerMemoryCleaner((name, params) => {
    if (!name && !params) {
      abortAll()
      cache.clear()
      return
    }
    clearLoaderCache(name, params)
  })

  function abortAll() {
    inflight.forEach((job) => job.controller.abort())
    inflight.clear()
  }

  const setRuntime = (key: string, next: RuntimeState) => store.merge('runtime', { [key]: next })

  // Текст сбоя загрузчика в интерфейс НЕ попадает (C13): `error.message`
  // потребителя может нести внутренние подробности (адреса, SQL, стек).
  // Исходная ошибка целиком уходит в `report` → `onError` хоста
  // (`load-failed` / `preload-failed`, `cause`), окну — общий текст.
  const errorMessage = (_error: unknown): string => 'Ошибка загрузки'

  const missing = (name: string) => `Нет такой модалки: «${name}»`

  /** Конверт «нет такой модалки»: причина — читаемая ошибка, а не `null` (F30). */
  const unknownModal = (name: string, via?: string): LibError => ({
    lib: 'modals',
    code: 'unknown-modal',
    cause: new Error(missing(name)),
    ctx: via ? { name, via } : { name },
  })

  /** Откуда брать данные записи: свой загрузчик или загрузчик маршрута. */
  function fetcher(
    entry: ResolvedEntry,
    definition: AnyDefinition,
  ): ((signal: AbortSignal) => Promise<unknown>) | null {
    if (definition.loader) {
      return (signal) => definition.loader!(entry.params, signal)
    }
    const href = deps.hrefOf?.(entry)
    if (href && deps.preload) {
      return async () => {
        const r = await deps.preload!(href)
        if (!r.ok) throw new Error(`Маршрут ${href}: ${r.reason}`)
        return r.data
      }
    }
    return null
  }

  /** Существующая загрузка ключа или новая. */
  function jobFor(
    ck: string,
    name: string,
    load: (signal: AbortSignal) => Promise<unknown>,
    definition?: AnyDefinition,
  ): Job {
    const existing = inflight.get(ck)
    if (existing) return existing

    const controller = new AbortController()
    const job: Job = {
      controller, keys: new Set(), preloads: 0, reported: false,
      done: undefined!, ready: undefined!,
    }
    const settle = () => {
      // Удаляем только если это всё ещё наш job: устаревший промис
      // может догонять уже созданный новый и не должен его затирать.
      if (inflight.get(ck) === job) inflight.delete(ck)
    }
    job.done = load(controller.signal)
    // Данные в кеш — как только пришли, не дожидаясь вида: повторное
    // открытие после сбоя вида не грузит данные заново.
    job.done.then(
      (data) => {
        if (!controller.signal.aborted) cacheSet(ck, data)
      },
      () => {},
    )
    // Готовность записи — данные И вид (ленивый чанк): `ready` ставится
    // только по этому ожиданию, иначе между скелетоном и содержимым
    // оставался пустой кадр на время импорта компонента.
    let view: Promise<void> = Promise.resolve()
    if (deps.ensureView && definition) {
      try {
        view = deps.ensureView(definition)
      } catch (error) {
        view = Promise.reject(error)
      }
    }
    job.ready = Promise.all([job.done, view]).then(([data]) => data)
    job.ready.then(
      (data) => {
        settle()
        if (controller.signal.aborted) return
        for (const k of job.keys) setRuntime(k, { status: 'ready', data })
      },
      (error: unknown) => {
        settle()
        if (!controller.signal.aborted && job.keys.size > 0) {
          for (const k of job.keys) setRuntime(k, { status: 'error', error: errorMessage(error) })
          job.reported = true
          deps.report?.({ lib: 'modals', code: 'load-failed', cause: error, ctx: { name } })
        }
      },
    )
    // Без ожидающих (одни записи стопки) отказ не должен стать unhandled rejection.
    job.ready.catch(() => {})
    inflight.set(ck, job)
    return job
  }

  /**
   * Только вид, без загрузки данных (кеш данных уже есть или загрузчика
   * нет): готовность записи откладывается до вида тем же ожиданием.
   */
  function viewGate(
    key: string,
    name: string,
    definition: AnyDefinition,
    data: unknown,
    hasData: boolean,
  ): () => void {
    if (!deps.ensureView) {
      setRuntime(key, hasData ? { status: 'ready', data } : { status: 'ready' })
      return () => {}
    }
    setRuntime(key, { status: 'loading' })
    let live = true
    deps.ensureView(definition).then(
      () => {
        if (live) setRuntime(key, hasData ? { status: 'ready', data } : { status: 'ready' })
      },
      (error: unknown) => {
        if (!live) return
        setRuntime(key, { status: 'error', error: errorMessage(error) })
        deps.report?.({ lib: 'modals', code: 'load-failed', cause: error, ctx: { name } })
      },
    )
    return () => {
      live = false
    }
  }

  /** Никто больше не ждёт — отменяем (F33: раньше это проверял только владелец). */
  function release(ck: string, job: Job) {
    if (job.keys.size > 0 || job.preloads > 0) return
    job.controller.abort()
    if (inflight.get(ck) === job) inflight.delete(ck)
  }

  /**
   * Запускает загрузчик — только для активной записи. Модалки в стопке
   * свой загрузчик не запускают. Возвращает функцию очистки.
   */
  function runLoader(entry: ResolvedEntry): () => void {
    const key = runtimeKey(entry.name, entry.index)

    if (!entry.known) {
      setRuntime(key, { status: 'error', error: missing(entry.name) })
      deps.report?.(unknownModal(entry.name))
      return () => {}
    }

    const definition = lookup(entry.name)
    const load = definition ? fetcher(entry, definition) : null
    if (!load) {
      // Данных нет — готовность решает только вид (ленивый чанк).
      if (!definition) {
        setRuntime(key, { status: 'ready' })
        return () => {}
      }
      return viewGate(key, entry.name, definition, undefined, false)
    }

    const ck = loaderKey(entry.name, entry.params)
    if (cache.has(ck)) {
      // Данные уже есть, но вид мог ещё не доехать (первое открытие
      // после предзагрузки одними данными) — ждём и его.
      return viewGate(key, entry.name, definition!, cacheGet(ck), true)
    }

    // Кто-то уже грузит те же name+params (другая запись или предзагрузка) —
    // подписываемся на тот же результат.
    const job = jobFor(ck, entry.name, load, definition)
    job.keys.add(key)
    setRuntime(key, { status: 'loading' })

    return () => {
      if (!job.keys.delete(key)) return
      // Запись ушла раньше результата: загрузка её больше не обновит.
      if (store.state.runtime[key]?.status === 'loading') setRuntime(key, { status: 'idle' })
      release(ck, job)
    }
  }

  /**
   * Предзагрузка для кнопки: загрузчик отрабатывает ДО открытия, поэтому
   * модалка появляется уже с данными, а на кнопке виден индикатор.
   *
   * `signal` — владелец ожидания (кнопка): его отмена снимает ожидание и,
   * если загрузку больше никто не ждёт, отменяет её.
   */
  async function preloadModal(
    name: string,
    params: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const definition = lookup(name)
    if (!definition) {
      deps.report?.(unknownModal(name, 'preload'))
      return { ok: false, error: missing(name) }
    }

    const merged = { ...(definition.defaultParams ?? {}), ...params }
    const entry = { name, params: merged } as ResolvedEntry
    const load = fetcher(entry, definition)
    if (!load) {
      // Данных нет, но вид может быть ленивым: кнопка греет и его.
      if (deps.ensureView) {
        try {
          await deps.ensureView(definition)
        } catch (error) {
          deps.report?.({ lib: 'modals', code: 'preload-failed', cause: error, ctx: { name } })
          return { ok: false, error: errorMessage(error) }
        }
      }
      return { ok: true }
    }

    const ck = loaderKey(name, merged)
    if (cache.has(ck)) {
      cacheGet(ck)
      return { ok: true }
    }

    const { signal } = options
    if (signal?.aborted) return { ok: false, error: 'Отменено' }

    const job = jobFor(ck, name, load, definition)
    job.preloads += 1
    let onAbort: (() => void) | undefined
    try {
      await new Promise<unknown>((resolve, reject) => {
        // Предзагрузка ждёт и вид: модалка откроется сразу с содержимым.
        job.ready.then(resolve, reject)
        if (signal) {
          onAbort = () => reject(signal.reason)
          signal.addEventListener('abort', onAbort, { once: true })
        }
      })
      return { ok: true }
    } catch (error) {
      if (signal?.aborted || job.controller.signal.aborted) return { ok: false, error: 'Отменено' }
      if (!job.reported) {
        deps.report?.({ lib: 'modals', code: 'preload-failed', cause: error, ctx: { name } })
      }
      return { ok: false, error: errorMessage(error) }
    } finally {
      if (onAbort) signal?.removeEventListener('abort', onAbort)
      job.preloads -= 1
      release(ck, job)
    }
  }

  function clearLoaderCache(name?: string, params?: Record<string, unknown>): void {
    if (!name) return cache.clear()
    if (params !== undefined) {
      const target = loaderKey(name, params)
      cache.delete(target)
      return
    }
    for (const key of [...cache.keys()]) {
      if (key.startsWith(`${name}|`)) cache.delete(key)
    }
  }

  const readRuntime = (name: string, index: number): RuntimeState =>
    store.state.runtime[runtimeKey(name, index)] ?? { status: 'idle' }

  /**
   * Освободить загрузчик: отменить загрузки, снять очистку со стора, забыть
   * кеш. Хост зовёт при замене загрузчика (смена ядра или scope) — иначе
   * старый экземпляр со всем кешем жил в сторе вечно (F26).
   */
  function dispose(): void {
    offCleaner()
    abortAll()
    cache.clear()
  }

  return { runLoader, preloadModal, clearLoaderCache, readRuntime, dispose }
}

export type Loader = ReturnType<typeof createLoader>
