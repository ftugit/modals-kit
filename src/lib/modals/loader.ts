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

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : 'Ошибка загрузки'

  /** Конверт «нет такой модалки»: причина — читаемая ошибка, а не `null` (F30). */
  const unknownModal = (name: string, via?: string): LibError => ({
    lib: 'modals',
    code: 'unknown-modal',
    cause: new Error(`Нет такой модалки: «${name}»`),
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
  function jobFor(ck: string, name: string, load: (signal: AbortSignal) => Promise<unknown>): Job {
    const existing = inflight.get(ck)
    if (existing) return existing

    const controller = new AbortController()
    const job: Job = { controller, keys: new Set(), preloads: 0, reported: false, done: undefined! }
    const settle = () => {
      // Удаляем только если это всё ещё наш job: устаревший промис
      // может догонять уже созданный новый и не должен его затирать.
      if (inflight.get(ck) === job) inflight.delete(ck)
    }
    job.done = load(controller.signal).then(
      (data) => {
        settle()
        if (controller.signal.aborted) return data
        cacheSet(ck, data)
        for (const k of job.keys) setRuntime(k, { status: 'ready', data })
        return data
      },
      (error: unknown) => {
        settle()
        if (!controller.signal.aborted && job.keys.size > 0) {
          for (const k of job.keys) setRuntime(k, { status: 'error', error: errorMessage(error) })
          job.reported = true
          deps.report?.({ lib: 'modals', code: 'load-failed', cause: error, ctx: { name } })
        }
        throw error
      },
    )
    // Без ожидающих (одни записи стопки) отказ не должен стать unhandled rejection.
    job.done.catch(() => {})
    inflight.set(ck, job)
    return job
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
      setRuntime(key, { status: 'error', error: `Нет такой модалки: «${entry.name}»` })
      deps.report?.(unknownModal(entry.name))
      return () => {}
    }

    const definition = lookup(entry.name)
    const load = definition ? fetcher(entry, definition) : null
    if (!load) {
      setRuntime(key, { status: 'ready' })
      return () => {}
    }

    const ck = loaderKey(entry.name, entry.params)
    if (cache.has(ck)) {
      setRuntime(key, { status: 'ready', data: cacheGet(ck) })
      return () => {}
    }

    // Кто-то уже грузит те же name+params (другая запись или предзагрузка) —
    // подписываемся на тот же результат.
    const job = jobFor(ck, entry.name, load)
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
      return { ok: false, error: `Нет такой модалки: «${name}»` }
    }

    const merged = { ...(definition.defaultParams ?? {}), ...params }
    const entry = { name, params: merged } as ResolvedEntry
    const load = fetcher(entry, definition)
    if (!load) return { ok: true }

    const ck = loaderKey(name, merged)
    if (cache.has(ck)) {
      cacheGet(ck)
      return { ok: true }
    }

    const { signal } = options
    if (signal?.aborted) return { ok: false, error: 'Отменено' }

    const job = jobFor(ck, name, load)
    job.preloads += 1
    let onAbort: (() => void) | undefined
    try {
      await new Promise<unknown>((resolve, reject) => {
        job.done.then(resolve, reject)
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
