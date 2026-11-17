/**
 * Подготовка формы добавления на сервере (`createFormHandler` → `prepare`): выполняется
 * ДО правил формы. Отдельный модуль, а не `handle.ts`: его проверяют тесты без окружения БД.
 */

const LINK = /(?:https?:\/\/|www\.)\S+/giu

/** Ссылки (`http(s)://…`, `www.…`) убираются, пробелы на их месте схлопываются. Без ссылок — как есть. */
export function stripLinks(text: string): string {
  if (!text.match(LINK)) return text
  return text.replace(LINK, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** Заголовок без ссылок; если что-то убрано — подсказка под полем. */
export const createPrepare = {
  title: (value: unknown) => {
    if (typeof value !== 'string') return value
    const clean = stripLinks(value)
    return clean === value ? value : { value: clean, note: 'Текст изменён: удалены ссылки' }
  },
}
