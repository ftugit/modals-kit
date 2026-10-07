// Реестр пагинаторов по name (R9): одна регистрация — клиент и сервер импортируют её же.
// R17 deny by default: неизвестный name → throw. Дословный порт registry.ts React-версии.
import { createLocalAdapter } from './adapter-local'
import { createEmitter, type Emitter } from './events'
import type { PaginatorAdapter, PaginatorConfig, ScrollDriver } from './types'

export type LastAction =
  { kind: 'goToPage'; page: number } | { kind: 'loadMore'; dir: 1 | -1 } | null

export type PaginatorInstance = {
  name: string
  /** Generic стирается на уровне реестра; типизация возвращается на границе хуков. */
  adapter: PaginatorAdapter<unknown>
  emitter: Emitter
  pageSize: number
  lastAction: LastAction
  /** Регистрирует хост (SPEC §3.7); ядро дёргает его после REPLACE/goToPage. */
  scrollDriver: ScrollDriver | null
  /** Контроллер отмены активного replace-запроса (D22). */
  replaceAbort: AbortController | null
  /** Максимальное число страниц в памяти (окно/выгрузка). */
  maxPages?: number
  /** Ключи extra, влияющие на данные источника: их смена = сброс + загрузка стр. 1. */
  reloadKeys: Set<string>
}

const instances = new Map<string, PaginatorInstance>()

export function definePaginator<T>(config: PaginatorConfig<T>): void {
  if (instances.has(config.name)) {
    throw new Error(`Paginator "${config.name}" already defined`)
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
          extraKeys: config.extraKeys,
        })
  instances.set(config.name, {
    name: config.name,
    adapter: adapter as PaginatorAdapter<unknown>,
    emitter: createEmitter(),
    pageSize: 'adapter' in config ? (config.pageSize ?? 20) : (config.pageSize ?? 20),
    lastAction: null,
    scrollDriver: null,
    replaceAbort: null,
    maxPages: config.maxPages,
    reloadKeys: new Set(config.reloadKeys ?? []),
  })
}

/** Зарегистрирован ли пагинатор (get-or-create для демо/динамических конфигов). */
export function hasPaginator(name: string): boolean {
  return instances.has(name)
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
