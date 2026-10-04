// Ядро под роутер FastEdge из SolidHono.
//
// Доказательство переносимости: ни строчки ядра, хранилищ и модалки
// не менялось — написан только этот файл. Контракт взят дословно из
// `src/lib/modals/adapter-url.ts` оригинала:
//
//     searchStr(): string
//     pathname():  string
//     navigate(url, { replace?, state? }): void
//
// Роутер инжектируется, а не импортируется: так ядро прогоняется обычным
// раннером без Solid и без самого FastEdge.
import { buildCore, type CoreOptions, type ReconfigurableCore } from '../build'
import type { ChainEngine } from '../engine'
import { urlStorage } from '../storages'
import type { Sources } from '../build'
import type { ModalCore, PreloadResult } from '../core-contract'

/** Срез роутера FastEdge, нужный ядру. */
export interface FastEdgeRouter {
  /** Сырая строка поиска текущего адреса (с '?'). */
  searchStr(): string
  /** Текущий pathname. */
  pathname(): string
  /** Навигация роутером. `state` уезжает в history.state записи. */
  navigate(url: string, opts: { replace?: boolean; state?: Record<string, unknown> }): void

  /**
   * Смена адреса извне (Назад/Вперёд). В оригинале это `createEffect`
   * на `app.searchStr` → `chainStore.notify()`.
   * Нет — внешние изменения не отслеживаются.
   */
  onSearchChange?(fn: () => void): () => void

  /**
   * Состояние текущей записи истории. FastEdge кладёт `state` напрямую
   * в `history.state`, без обёртки — в отличие от SvelteKit.
   */
  state?(): Record<string, unknown>

  /** Шаг по истории. Нет — истории нет, закрытие пойдёт через replace. */
  go?(delta: number): void

  /**
   * Резолвится ли путь в маршрут. У FastEdge это есть в рантайме —
   * `useResolves()`; у SvelteKit нет, там проверяет тип.
   */
  resolves?(href: string): boolean

  /** Предзагрузка данных маршрута, если роутер умеет. */
  preload?(href: string): Promise<PreloadResult>
}

/** Среда FastEdge под контракт `ChainEngine`. */
export function fastEdgeEngine(router: FastEdgeRouter): ChainEngine {
  return {
    name: 'fastedge',

    location: () => ({ pathname: router.pathname(), search: router.searchStr() }),

    // У FastEdge одна функция навигации на оба случая — различает `replace`.
    pushState: (url, state) => router.navigate(url, { state }),
    replaceState: (url, state) => router.navigate(url, { replace: true, state }),

    state: () => router.state?.() ?? {},

    onPopState: router.onSearchChange ? (fn) => router.onSearchChange!(fn) : undefined,
    go: router.go ? (d) => router.go!(d) : undefined,
    resolves: router.resolves ? (h) => router.resolves!(h) : undefined,
    preload: router.preload ? (h) => router.preload!(h) : undefined,
  }
}

/**
 * Ядро FastEdge. Хранилище по умолчанию — адрес: у этой среды есть
 * и роутер, и история.
 *
 *     const core = fastEdgeCore(router)
 *     createModals(core, { tailCount: 3 })
 */
export function fastEdgeCore(
  router: FastEdgeRouter,
  sources: Sources = urlStorage(),
  options: CoreOptions = {},
): ReconfigurableCore {
  return buildCore(fastEdgeEngine(router), sources, options)
}
