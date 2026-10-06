import type { PaginatorEvent } from '$lib/paginate'

export function describeEvent(e: PaginatorEvent): string {
  switch (e.type) {
    case 'loaded':
      return `Загружена стр. ${e.page} (${e.itemCount} элементов, via: ${e.via})`
    case 'empty-page':
      return `Пустая страница ${e.page}`
    case 'append-empty':
      return `Конец: следующая страница ${e.page} пуста`
    case 'error':
      return `Ошибка: ${String(e.error)} (стр. ${e.page ?? '?'}, phase: ${e.phase})`
    case 'page-changed':
      return `Смена текущей страницы → ${e.page} (via: ${e.via})`
    default:
      return (e as any).type
  }
}
