/**
 * Сессионная единица удаления: вариант, набор и предел — одной таблицей, без
 * разбора адреса в компоненте.
 *
 * План сессий (ред. 6) §6.3 и §8.1: удаление сессии — **один** компонент с
 * вариантом «удаление» / «выход», **один** ключ модалки и **два** адреса (свой
 * аккаунт и переданная цель). Набор едет адресом в трёх формах: `id`, `ids` и
 * срез; здесь живут только первые две и предел, срез — дело хоста списков.
 *
 * Предел — 500: столько же, сколько домен сессий уже держит в `ids`
 * (`sessions.server.ts`, `db.limits.inValues`). Превышение — отказ формы с
 * кодом, **не** молчаливое усечение: усечённый набор сказал бы человеку, что
 * закрыл сто устройств, закрыв пятьдесят.
 */

/** Вариант сессионной единицы: обычное закрытие или «выйти здесь». */
import { SESSIONS_BULK_IDS_LIMIT } from './types.js'

export type SessionDeleteVariant = 'delete' | 'logout'

/** Закрытый набор вариантов: незнакомое значение — не режим, а `delete`. */
export const SESSION_DELETE_VARIANTS: ReadonlySet<string> = new Set<SessionDeleteVariant>([
  'delete',
  'logout',
])

/**
 * Ключ модалки единицы. Регистрация компонента — этап S3: ключ объявлен здесь,
 * чтобы адрес, ключ и вариант жили в одном месте и не разъезжались.
 */
export const SESSION_DELETE_MODAL_KEY = 'user.session.delete'

/**
 * Предел числа `ids` в наборе одной отправки сессий — **то же** объявление, что
 * у доменного набора (`SESSIONS_BULK_IDS_LIMIT`), а не второе число «на глаз»:
 * предел адреса не должен разъезжаться с пределом домена.
 */
export const MAX_SESSION_DELETE_IDS = SESSIONS_BULK_IDS_LIMIT

/** Разобрать `?variant=`: незнакомое и пустое — обычное закрытие. */
export function parseSessionDeleteVariant(raw: unknown): SessionDeleteVariant {
  return typeof raw === 'string' && SESSION_DELETE_VARIANTS.has(raw)
    ? (raw as SessionDeleteVariant)
    : 'delete'
}

/** Итог разбора набора: значения и признак «пришло больше предела». */
export interface SessionDeleteIds {
  ids: string[]
  tooMany: boolean
}

/**
 * Разобрать `?id=` и `?ids=` в набор без повторов и пустых частей.
 *
 * Порядок сохраняется: набор показывает человеку то, что он отметил. Признак
 * `tooMany` возвращается вместо усечения — вызывающий обязан отказать формой.
 */
export function parseSessionDeleteIds(idRaw: unknown, idsRaw: unknown): SessionDeleteIds {
  const parts = [idRaw, idsRaw]
    .filter((v): v is string => typeof v === 'string')
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter(Boolean)
  const seen = new Set<string>()
  const ids: string[] = []
  for (const part of parts) {
    if (seen.has(part)) continue
    seen.add(part)
    ids.push(part)
  }
  return { ids: ids.slice(0, MAX_SESSION_DELETE_IDS + 1), tooMany: ids.length > MAX_SESSION_DELETE_IDS }
}
