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
import type { ResolvedEntry, RuntimeState } from './types'

export interface LoaderDeps {
  store: ModalStore
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
  /** Одна загрузка на имя+параметры; keys — все записи, ждущие результата. */
  const inflight = new Map<string, { controller: AbortController; keys: Set<string> }>()

  function evictIfNeeded() {
    if (cache.size <= maxEntries) return

    // Активные модалки в стопке защищены от вытеснения (pinning)
    const activeKeys = new Set(
      store.state.chain.map((e) =>
        e.kind === 'registered' ? loaderKey(e.name, e.params ?? {}) : '',
      ),
    )

    for (const key of cache.keys()) {
      if (cache.size <= maxEntries) break
      if (!activeKeys.has(key)) {
        cache.delete(key)
      }
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
  store.registerMemoryCleaner((name, params) => {
    if (!name && !params) {
      inflight.forEach((job) => job.controller.abort())
      inflight.clear()
      cache.clear()
      return
    }
    clearLoaderCache(name, params)
  })

  const setRuntime = (key: string, next: RuntimeState) => store.merge('runtime', { [key]: next })

  const errorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : 'Ошибка загрузки'

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

  /**
   * Запускает загрузчик — только для активной записи. Модалки в стопке
   * свой загрузчик не запускают. Возвращает функцию очистки.
   */
  function runLoader(entry: ResolvedEntry): () => void {
    const key = runtimeKey(entry.name, entry.index)

    if (!entry.known) {
      setRuntime(key, { status: 'error', error: `Нет такой модалки: «${entry.name}»` })
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

    // Кто-то уже грузит те же name+params — подписываемся на результат.
    const existing = inflight.get(ck)
    if (existing) {
      existing.keys.add(key)
      setRuntime(key, { status: 'loading' })
      return () => {
        existing.keys.delete(key)
      }
    }

    const controller = new AbortController()
    const job = { controller, keys: new Set([key]) }
    inflight.set(ck, job)
    setRuntime(key, { status: 'loading' })

    load(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        cacheSet(ck, data)
        for (const k of job.keys) setRuntime(k, { status: 'ready', data })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        for (const k of job.keys) setRuntime(k, { status: 'error', error: errorMessage(error) })
      })
      .finally(() => {
        // Удаляем только если это всё ещё наш job: устаревший промис
        // может догонять уже созданный новый и не должен его затирать.
        if (inflight.get(ck) === job) inflight.delete(ck)
      })

    return () => {
      job.keys.delete(key)
      if (job.keys.size === 0) {
        controller.abort()
        inflight.delete(ck)
        if (store.state.runtime[key]?.status === 'loading') setRuntime(key, { status: 'idle' })
      }
    }
  }

  /**
   * Предзагрузка для кнопки: загрузчик отрабатывает ДО открытия, поэтому
   * модалка появляется уже с данными, а на кнопке виден индикатор.
   */
  async function preloadModal(
    name: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const definition = lookup(name)
    if (!definition) return { ok: false, error: `Нет такой модалки: «${name}»` }

    const merged = { ...(definition.defaultParams ?? {}), ...params }
    const entry = { name, params: merged } as ResolvedEntry
    const load = fetcher(entry, definition)
    if (!load) return { ok: true }

    const ck = loaderKey(name, merged)
    if (cache.has(ck)) {
      cacheGet(ck)
      return { ok: true }
    }

    try {
      const data = await load(new AbortController().signal)
      cacheSet(ck, data)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: errorMessage(error) }
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

  return { runLoader, preloadModal, clearLoaderCache, readRuntime }
}

export type Loader = ReturnType<typeof createLoader>
