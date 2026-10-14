/**
 * Опрос «что появилось» глазами списка: адрес вопроса и разбор ответа.
 *
 * Отметка (`mark`) — `created_at` самой свежей строки выдачи на момент, когда
 * список её последний раз видел целиком. Вопрос к серверу — «строки новее
 * отметки под этим же фильтром» (`/api/db-posts?since=…`); ответ не зависит ни
 * от страницы, ни от порядка, ни от курсора, поэтому своя запись и переподписанный
 * токен «новым» больше не притворяются.
 *
 * Чего отметка не видит: строка, созданная между загрузкой списка и базовым
 * запросом отметки (один сетевой круг сразу после включения опроса или сброса),
 * попадёт в отметку и пилюлей не покажется — список её покажет при следующей
 * загрузке.
 */
import { DB_FRESH_LIMIT, type DbPost } from './definition'

/** Отметка пустой выдачи: «новее начала времён» = любая строка. */
export const FRESH_EPOCH = '1970-01-01T00:00:00.000Z'

/** `mark === undefined` — отметки ещё нет, спрашиваем её саму (`since=` пусто). */
export function freshUrl(filter: string | undefined, mark: string | null | undefined): string {
  const q = new URLSearchParams({ since: mark === undefined ? '' : (mark ?? FRESH_EPOCH) })
  if (filter) q.set('flt', filter)
  return `/api/db-posts?${q.toString()}`
}

/**
 * Ожидающие показа строки после очередного ответа: свежие первыми, без строки-
 * отметки (она может вернуться из-за точности времени), без уже известных
 * (показаны в окне или это своя запись) и без повторов, не больше потолка ответа.
 */
export function mergeFresh(
  waiting: readonly DbPost[],
  items: readonly DbPost[],
  opts: { markId: string | null; known: (id: string) => boolean },
): DbPost[] {
  const seen = new Set(waiting.map((r) => r.id))
  const add = items.filter((r) => r.id !== opts.markId && !opts.known(r.id) && !seen.has(r.id))
  if (!add.length) return waiting as DbPost[]
  return [...add, ...waiting].slice(0, DB_FRESH_LIMIT)
}

/** Подпись пилюли: потолок ответа честно назван «50+», а не «50». */
export function freshLabel(count: number): string {
  return `↑ ${count >= DB_FRESH_LIMIT ? `${DB_FRESH_LIMIT}+` : count} ${plural(count)} — показать`
}

function plural(n: number): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'новая запись'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'новые записи'
  return 'новых записей'
}
