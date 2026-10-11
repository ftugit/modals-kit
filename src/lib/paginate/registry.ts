// Реестр пагинаторов по name (R9): одна регистрация — клиент и сервер импортируют её же.
// R17 deny by default: неизвестный name → throw. Дословный порт registry.ts React-версии.
import { createLocalAdapter } from './adapter-local'
import { createEmitter, type Emitter } from './events'
import type { PaginatorAdapter, PaginatorConfig } from './types'

export type LastAction =
  { kind: 'goToPage'; page: number } | { kind: 'loadMore'; dir: 1 | -1 } | null

/**
 * Экземпляр реестра — ОДИН на процесс: только конфигурация и подписчики.
 * Состояние полёта (отмена загрузки, последнее действие, буфер предзагрузки)
 * живёт рядом со стором (`core.ts` `sessionOf`), иначе SSR-запросы делили бы
 * его между собой (F13).
 */
export type PaginatorInstance = {
  name: string
  /** Generic стирается на уровне реестра; типизация возвращается на границе хуков. */
  adapter: PaginatorAdapter<unknown>
  emitter: Emitter
  pageSize: number
  /** Максимальное число страниц в памяти (окно/выгрузка). */
  maxPages?: number
  /** Ключи extra, влияющие на данные источника: их смена = сброс + загрузка стр. 1. */
  reloadKeys: Set<string>
  /**
   * Позиционные ключи extra: описывают место в уже выданном окне, а не условие выдачи.
   * Любая пересборка окна (смена `reloadKeys`-ключа) обязана их снять, иначе источник
   * получит указатель прошлого окна вместе с новым порядком/фильтром.
   */
  positionKeys: Set<string>
  /** Приёмники ошибок (Q1): config-уровень + провайдеры. Бросок sink'а — вверх. */
  errorSinks: Set<(e: import('./types').LibError) => void>
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
    maxPages: config.maxPages,
    reloadKeys: new Set(config.reloadKeys ?? []),
    positionKeys: new Set(config.positionKeys ?? []),
    errorSinks: new Set(config.onError ? [config.onError] : []),
  })
}

/**
 * Подключить приёмник ошибок инстанса (провайдер монти — Q1). Возвращает отписку.
 */
export function onPaginatorError(
  name: string,
  sink: (e: import('./types').LibError) => void,
): () => void {
  const sinks = getPaginator(name).errorSinks
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
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
