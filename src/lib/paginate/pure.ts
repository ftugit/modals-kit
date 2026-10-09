// Чистые функции ядра — без эффектов, без реактивности, тестируются без браузера.
// Дословный порт pure.ts React-версии + pagesList (бывшие атомы) со стабильными ссылками
// на группы — чтобы Solid <For> переиспользовал DOM-узлы страниц между обновлениями.
import type { PageGroup, PageResponse, PaginatorState, ViewState } from './types'

export type DerivedMeta = {
  totalItems: number | null
  totalPages: number | null
  hasNext: boolean | null
}

/**
 * Вывод meta из конверта источника. Приоритет: totalPages > ceil(totalItems/pageSize) > hasNext.
 * Нет ничего → все null (R12: номерные кнопки не рендерятся, только стрелки).
 * page — страница, для которой загружен ответ: hasNext выводится как page < totalPages,
 * если источник его не прислал (иначе сентинел грузит за последней страницей, T4.5).
 */
export function deriveMeta(
  resp: PageResponse<unknown>,
  pageSize: number,
  page: number,
): DerivedMeta {
  const totalItems = resp.totalItems ?? null
  if (resp.totalPages != null) {
    return {
      totalItems,
      totalPages: resp.totalPages,
      hasNext: resp.hasNext ?? page < resp.totalPages,
    }
  }
  if (totalItems != null) {
    const totalPages = Math.ceil(totalItems / pageSize)
    return { totalItems, totalPages, hasNext: resp.hasNext ?? page < totalPages }
  }
  return { totalItems: null, totalPages: null, hasNext: resp.hasNext ?? null }
}

/**
 * Текущая страница по маркерам, прошедшим линию (модель «верёвка с номером»): маркер
 * страницы стоит в её начале; прошёл линию вверх — страница «началась». Текущая =
 * максимальный прошедший; ни одного — fallback (первая загруженная).
 */
export function pickCurrentPage(passed: ReadonlySet<number>, fallback: number): number {
  let max: number | null = null
  for (const page of passed) if (max === null || page > max) max = page
  return max ?? fallback
}

/** Стрелки UI: существует ли соседняя страница в направлении dir. */
export function canGo(dir: 1 | -1, s: PaginatorState<unknown>): boolean {
  if (dir === -1) return s.page > 1
  if (s.hasNext != null) return s.hasNext
  if (s.totalPages != null) return s.page < s.totalPages
  return false // total неизвестен (R12) — источник не дал hasNext
}

/** Сентинели подгрузки: dir=-1 требует загруженных страниц выше первой. */
export function canLoadMore(dir: 1 | -1, s: PaginatorState<unknown>): boolean {
  if (dir === -1) {
    return s.hasPrev !== false && s.loadedPages.length > 0 && Math.min(...s.loadedPages) > 1
  }
  return canGo(1, s)
}

/** Элементы всех загруженных страниц по порядку. */
export function flattenPages<T>(s: PaginatorState<T>): T[] {
  const out: T[] = []
  for (const page of s.loadedPages) {
    const items = s.pages[page]
    if (items) out.push(...items)
  }
  return out
}

/** notReady / error / loading / empty / ready. */
export function viewState<T>(s: PaginatorState<T>): ViewState {
  if (s.status === 'init') return 'notReady'
  if (s.status === 'error') return 'error'
  if (s.status === 'loading') return 'loading'
  return flattenPages(s).length === 0 ? 'empty' : 'ready'
}

/**
 * Группы страниц ВКЛЮЧАЯ pending (D17): UI рендерит слоты-скелетоны внутри PageAnchor.
 *
 * prev — группы прошлого вывода: неизменившиеся (та же страница, тот же массив items /
 * число слотов) возвращаются ТЕМИ ЖЕ объектами. Solid <For> держит DOM по ссылке на
 * элемент списка — без переиспользования любое обновление state (включая смену текущей
 * страницы при скролле) пересоздавало бы DOM всех страниц.
 */
export function pagesList<T>(
  s: PaginatorState<T>,
  prev: readonly PageGroup<T>[] = [],
): PageGroup<T>[] {
  const prevBy = new Map<number, PageGroup<T>>()
  for (const g of prev) prevBy.set(g.page, g)
  const reuseLoaded = (page: number, items: T[]): PageGroup<T> => {
    const old = prevBy.get(page)
    return old && !old.pending && old.items === items ? old : { page, pending: false, items }
  }
  const reusePending = (page: number, slots: number): PageGroup<T> => {
    const old = prevBy.get(page)
    return old && old.pending && old.slots === slots ? old : { page, pending: true, slots }
  }
  const groups: PageGroup<T>[] = []
  for (const page of s.loadedPages) groups.push(reuseLoaded(page, s.pages[page] ?? []))
  const p = s.pending
  if (p && p.mode === 'replace') return [reusePending(p.page, p.count)]
  if (p && p.mode === 'prepend') groups.unshift(reusePending(p.page, p.count))
  if (p && p.mode === 'append') groups.push(reusePending(p.page, p.count))
  return groups
}
