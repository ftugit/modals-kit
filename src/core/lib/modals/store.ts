// Состояние модальной системы. БЕЗ реактивности фреймворка.
//
// В оригинале здесь был `createStore` из solid-js/store, и его импортировал
// `registry.ts` — то есть чистая логика тянула за собой Solid (замер §0ε).
// Здесь простой объект + множество слушателей; реактивную обёртку делает
// слой фреймворка (svelte/store.svelte.ts).
//
// Тот же приём, что у lib/paginate: единственный файл ядра, знавший о
// фреймворке, — store; выносим знание наружу.
import { DEFAULT_HOST_CONFIG } from './types'
import type { Chain, HostConfig, InvalidateLoaderOptions, RuntimeState } from './types'

export interface ModalStoreData {
  /** Проекция транспорта. Писать напрямую нельзя — только через действия. */
  chain: Chain
  hostConfig: HostConfig
  /**
   * Скоупы настроек (обычно — путь страницы): слайсы, которые накладываются
   * на базовый `hostConfig` при чтении в своём скоупе. Так демка одной
   * страницы не течёт на модалки остальных (решение оператора 2026-10-10).
   */
  hostConfigBy: Record<string, Partial<HostConfig>>
  /**
   * Ключ активного скоупа (путь страницы). Пишет адаптер через
   * `setScope`, читают только мёрреные геттеры — см. `scopedConfig`
   * в `create.ts` (там же — почему это данные, а не функция).
   */
  scopeKey: string
  /** Состояние загрузки записи: ключ `${index}:${name}`. */
  runtime: Record<string, RuntimeState>
  /** Своя ячейка данных модалки. */
  data: Record<string, unknown>
  /** Общая доска: имя записи → данные. */
  sharedData: Record<string, unknown>
  /** Версия реестра: растёт при регистрации, чтобы триггеры узнали об имени. */
  registryVersion: number
}

const initial = (): ModalStoreData => ({
  chain: [],
  hostConfig: DEFAULT_HOST_CONFIG,
  hostConfigBy: {},
  scopeKey: '',
  runtime: {},
  data: {},
  sharedData: {},
  registryVersion: 0,
})

export type StoreListener = (state: ModalStoreData) => void
export type MemoryCleaner = (
  name?: string,
  params?: Record<string, unknown>,
  options?: InvalidateLoaderOptions & { cacheOnly?: boolean },
) => void
export type RekeyHandler = (
  slotKey: string,
  name: string,
  prevParams: Record<string, unknown>,
  nextParams: Record<string, unknown>,
) => void

/**
 * Стор модалок. Фабрика, а не класс: в проекте состояние и логика везде
 * живут в замыканиях (`createUrlChainStore`, `createPaginatorStore`,
 * `createAnchorTracker` — 20 фабрик в `lib/`), а классы используются
 * исключительно для подклассов `Error`.
 *
 * Экземплярный, а не модульный синглтон: на сервере два параллельных
 * запроса не должны видеть одну цепочку.
 */
export function createModalStore() {
  let state: ModalStoreData = initial()
  const listeners = new Set<StoreListener>()
  const cleaners = new Set<MemoryCleaner>()
  const rekeyHandlers = new Set<RekeyHandler>()

  const emit = () => {
    for (const fn of listeners) fn(state)
  }

  return {
    get state(): Readonly<ModalStoreData> {
      return state
    },

    subscribe(listener: StoreListener): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    /** Патч верхнего уровня. Ссылка меняется — реактивные обёртки это видят. */
    set(patch: Partial<ModalStoreData>): void {
      state = { ...state, ...patch }
      emit()
    },

    /** Слияние во вложенную карту (runtime/data/sharedData/hostConfigBy). */
    merge<K extends 'runtime' | 'data' | 'sharedData' | 'hostConfigBy'>(
      key: K,
      patch: Partial<ModalStoreData[K]>,
    ): void {
      state = { ...state, [key]: { ...state[key], ...patch } }
      emit()
    },

    /** Полная замена вложенных карт (не слияние с пустым объектом). */
    resetMaps(): void {
      state = { ...state, runtime: {}, data: {}, sharedData: {} }
      emit()
    },

    /**
     * Модуль (например, загрузчик) регистрирует свой сброс кеша.
     * Возвращает отписку: владелец
     * очистки (загрузчик) снимает её, когда освобождается, — иначе стор
     * держал бы его вместе с кешем до конца жизни (F26).
     */
    registerMemoryCleaner(fn: MemoryCleaner): () => void {
      cleaners.add(fn)
      return () => {
        cleaners.delete(fn)
      }
    },

    registerRekeyHandler(fn: RekeyHandler): () => void {
      rekeyHandlers.add(fn)
      return () => {
        rekeyHandlers.delete(fn)
      }
    },

    /** Перенести готовые данные слота и кеша под новый ключ параметров без перезапроса. */
    rekeyRuntime(
      slotKey: string,
      name: string,
      prevParams: Record<string, unknown>,
      nextParams: Record<string, unknown>,
    ): void {
      for (const fn of rekeyHandlers) fn(slotKey, name, prevParams, nextParams)
    },

    /** Инвалидация кеша и живых слотов загрузчика (по умолчанию SWR, с `{ hard: true }` — сброс данных). */
    invalidateLoader(
      name?: string,
      params?: Record<string, unknown>,
      options?: InvalidateLoaderOptions,
    ): void {
      if (cleaners.size > 0) {
        for (const fn of cleaners) fn(name, params, options)
        return
      }
      // Резервный путь без подключённого загрузчика (чистые unit-тесты стора).
      const openKeys = new Map<string, string>()
      state.chain.forEach((e, i) => {
        if (e.kind !== 'registered') return
        if (name && e.name !== name) return
        openKeys.set(`${i}:${e.name}`, e.name)
      })
      const nextRuntime = { ...state.runtime }
      let changed = false
      for (const rKey of Object.keys(nextRuntime)) {
        const entryName = rKey.slice(rKey.indexOf(':') + 1)
        if (name && entryName !== name) continue
        if (!openKeys.has(rKey)) {
          delete nextRuntime[rKey]
          changed = true
        }
      }
      for (const slotKey of openKeys.keys()) {
        const prev = nextRuntime[slotKey]
        const rev = (prev?.rev ?? 0) + 1
        nextRuntime[slotKey] = options?.hard
          ? { status: 'loading', data: undefined, error: undefined, ck: prev?.ck, rev }
          : { ...(prev ?? { status: 'idle' }), data: prev?.data, error: undefined, rev }
        changed = true
      }
      if (changed) {
        state = { ...state, runtime: nextRuntime }
        emit()
      }
    },

    /** Удалить запись только из кеша загрузчика, не трогая живые открытые слоты. */
    evictLoaderCache(name: string, params: Record<string, unknown>): void {
      for (const fn of cleaners) fn(name, params, { cacheOnly: true })
    },

    /** Полный сброс памяти: кеш загрузчика, обмен данными, состояния записей. */
    clearMemory(name?: string, params?: Record<string, unknown>): void {
      for (const fn of cleaners) fn(name, params)
      if (!name && !params) {
        this.resetMaps()
      }
    },

    /** Только для тестов. */
    reset(): void {
      state = initial()
      cleaners.clear()
      rekeyHandlers.clear()
      emit()
    },
  }
}

export type ModalStore = ReturnType<typeof createModalStore>

/* ── клиентский экземпляр ──────────────────────────────────────────── */

let client: ModalStore | null = null

/**
 * Стор браузера: один на приложение, переживает размонтирование хоста.
 * На сервере не используется — там стор создаётся на запрос.
 */
export function getClientStore(): ModalStore {
  if (!client) client = createModalStore()
  return client
}

/** Сбрасывает лениво созданный browser-store, главным образом для изолированных тестов. */
export function resetClientStore(): void {
  client = null
}
