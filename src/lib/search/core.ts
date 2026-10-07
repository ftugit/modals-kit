// Действия поиска — vanilla, без Solid: тонкие обёртки над ядром lib/paginate.
// lib search — НЕ хранилище и НЕ транспорт: адрес, состояние и снапшоты
// принадлежат пагинатору, здесь нет ни своей записи в URL, ни persistence.
// Запрос живёт в extra пагинатора ('q' входит в reloadKeys), поэтому смена
// запроса = штатный setExtra: сброс на страницу 1, отмена in-flight, persist
// в адрес через URL-адаптер пагинатора.
import { getClientStore, getState, goToPage, setExtra } from '$lib/paginate'
import { getSearch } from './registry'

/** Нормализация запроса перед записью в состояние/адрес (та же, что валидатор адреса). */
export function normalizeSearchQuery(value: string, maxLength = 120): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength)
}

/**
 * Установить запрос (клиент): пагинатор результатов сбрасывается на страницу 1
 * и грузит выдачу с новым `q`; URL-адаптер пишет `?<pageParam>.q` в адрес.
 */
export async function setSearchQuery(name: string, value: string): Promise<void> {
  const search = getSearch(name)
  const store = getClientStore()
  await setExtra(store, search.name, { q: normalizeSearchQuery(value, search.maxQueryLength) })
}

/** Очистить запрос: выдача пуста, ключ `.q` уходит из адреса (extraDefaults). */
export async function clearSearchQuery(name: string): Promise<void> {
  await setSearchQuery(name, '')
}

/**
 * Клиентский перезапрос текущей страницы ЧЕРЕЗ lib search (после гидратации).
 *
 * Поделённый адрес (`?search=N&search.q=…`) на сервере рендерится ДАННЫМИ
 * ИСТОЧНИКА (серверная подстрока — fuzzy-метод на сервере не работает). С JS
 * та же страница обязана прийти от lib search: она просит источник С ПЕРВОЙ
 * страницы, в фоне добирает данные на нужное число страниц и показывает
 * именно запрошенную страницу N — НЕ продолжая от перехваченных серверных
 * данных. Адрес при этом не меняется (goToPage на ту же страницу в
 * single-семантике = REPLACE, persist гасится echo-guard'ом адаптера).
 *
 * Из-за разницы методов данные lib search и источника для одной и той же
 * страницы могут различаться — это осознанный компромисс шаринга адреса, а
 * не баг. Без JS механизм не работает (и не нужен): остаётся честная
 * серверная выдача источника.
 */
export async function resyncSearch(name: string): Promise<void> {
  if (typeof window === 'undefined') return
  const search = getSearch(name)
  const store = getClientStore()
  const state = getState(store, search.name)
  const q = typeof state.extra?.q === 'string' ? state.extra.q.trim() : ''
  if (!q) return // без запроса перехвата нет — данные и так от источника
  await goToPage(store, search.name, state.page)
}
