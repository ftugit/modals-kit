// Реестр пагинаторов по name (R9): одна регистрация — клиент и сервер импортируют её же.
// R17 deny by default: неизвестный name → throw. Дословный порт registry.ts React-версии.
import { createLocalAdapter } from './adapter-local'
import { createEmitter, type Emitter } from './events'
import { assertAdaptedSource, sourceCapabilities, type AdaptedSource, type SourceCapabilities } from './source'
import type { Extra, PaginatorAdapter, PaginatorConfig, ScrollDriver } from './types'

export type LastAction =
  { kind: 'goToPage'; page: number } | { kind: 'loadMore'; dir: 1 | -1 } | null

export type PaginatorInstance = {
  name: string
  /** Generic стирается на уровне реестра; типизация возвращается на границе хуков. */
  adapter: PaginatorAdapter<unknown>
  /**
   * Адаптированный источник пагинатора (или null у курсорного транспорта, у
   * которого свой контракт). Отсюда UI берёт возможности: что источник умеет —
   * то и можно показывать.
   */
  source: AdaptedSource<unknown> | null
  emitter: Emitter
  pageSize: number
  lastAction: LastAction
  /** Регистрирует хост (SPEC §3.7); ядро дёргает его после REPLACE/goToPage. */
  scrollDriver: ScrollDriver | null
  /** Контроллер отмены активного replace-запроса (D22). */
  replaceAbort: AbortController | null
  /** Максимальное число страниц в памяти (окно/выгрузка). */
  maxPages?: number
  /**
   * Минимальное время показа pending-группы (скелетоны подгрузки), мс.
   * Выставляет хост (`<PaginatorHost pendingDelayMs>`) — как `scrollDriver`:
   * это UX-политика, а не семантика ядра. 0/undefined — скелетоны живут ровно
   * столько, сколько идёт запрос (поведение исходника).
   */
  pendingDelayMs?: number
  /** Ключи extra, влияющие на данные источника: их смена = сброс + загрузка стр. 1. */
  reloadKeys: Set<string>
}

const instances = new Map<string, PaginatorInstance>()

export function definePaginator<T>(config: PaginatorConfig<T>): void {
  if (instances.has(config.name)) {
    throw new Error(`Paginator "${config.name}" already defined`)
  }
  // Deny by default: в ветке «источник + опции» принимается только адаптированный
  // источник — объект, лишь повторяющий форму общего слоя, отвергается сразу.
  if (!('adapter' in config)) {
    assertAdaptedSource<T>(config.source, `definePaginator("${config.name}")`)
  }
  const adapter =
    'adapter' in config
      ? config.adapter
      : createLocalAdapter<T>({
          name: config.name,
          source: config.source,
          pageSize: config.pageSize,
          append: config.append,
          storage: config.storage,
        })
  instances.set(config.name, {
    name: config.name,
    adapter: adapter as PaginatorAdapter<unknown>,
    source: (adapter.source as AdaptedSource<unknown> | undefined) ?? null,
    emitter: createEmitter(),
    pageSize: 'adapter' in config ? (config.pageSize ?? 20) : (config.pageSize ?? 20),
    lastAction: null,
    scrollDriver: null,
    replaceAbort: null,
    maxPages: config.maxPages,
    pendingDelayMs: 0,
    reloadKeys: new Set(config.reloadKeys ?? []),
  })
}

/** Зарегистрирован ли пагинатор (get-or-create для демо/динамических конфигов). */
export function hasPaginator(name: string): boolean {
  return instances.has(name)
}

/**
 * Возможности источника пагинатора на текущий выбор: UI/панель спрашивают
 * здесь, а не угадывают по названию источника. Курсорный транспорт источника
 * не несёт — отдаём минимальные возможности.
 */
export function paginatorCapabilities(name: string, extra?: Extra): SourceCapabilities {
  return sourceCapabilities(getPaginator(name).source ?? undefined, extra)
}

export function getPaginator(name: string): PaginatorInstance {
  const instance = instances.get(name)
  if (!instance) throw new Error(`Unknown paginator "${name}"`)
  return instance
}

/** Только для тестов: сброс реестра. */
export function resetRegistry(): void {
  instances.clear()
}
