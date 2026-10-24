import type { PaginatorEvent } from '#lib/paginate/index.js'

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
      // Сюда попадает только вид события, которого приложение ещё не знает
      // (библиотека новее): показываем имя, чтобы лог не врал «undefined».
      return (e as { type: string }).type
  }
}
