/**
 * Описание формы единицы закрытия устройств: скрытые поля набора и текст
 * подтверждения.
 *
 * План сессий ред. 6 §6.1: успех в модалке не меняет адрес носителя и не
 * закрывает слой самовольно — компонент возвращает результат, а решение о
 * переходе живёт в регистрации формы (для случая без JS).
 */
import { defineForm, field } from '#lib/form/index.js'
import { AUTH_MESSAGES } from '../../messages.js'
import { SESSIONS_FILTER_KEYS } from '../sessions-list/source.js'
import { MAX_SESSION_DELETE_IDS, type SessionDeleteVariant } from '../../session-delete.js'

export const SESSION_DELETE_FORM_ID = 'user-session-delete'

/** Что закрывает форма: явный набор, срез списка или одиночная строка. */
export interface SessionDeleteShape {
  ids: readonly string[]
  variant: SessionDeleteVariant
  /** Поля фильтров среза: их принёс носитель, клиент их не выдумывает. */
  sliceFields?: Readonly<Record<string, string>> | undefined
}

/** Словами и числом: набор показан человеку, а не спрятан в адресе (§6.3). */
export function sessionDeleteSummary(shape: {
  count: number
  slice: boolean
  variant: SessionDeleteVariant
}): { title: string; detail: string; hold: boolean } {
  const { count, slice, variant } = shape
  const verb = variant === 'logout' ? 'Выйти' : 'Закрыть'
  const title = slice
    ? `${verb} все устройства в этом срезе?`
    : count === 1
      ? `${verb} это устройство?`
      : `${verb} ${count} ${plural(count, 'устройство', 'устройства', 'устройств')}?`
  const detail = slice
    ? 'Набор считает сервер по фильтру списка в момент отправки: строки могут появиться или исчезнуть.'
    : 'Закрытая авторизация перестаёт действовать сразу; запись остаётся в истории аккаунта.'
  // Удержание — только когда набор заведомо больше одного: у среза число строк
  // известно лишь серверу, поэтому срез всегда требует удержания (§6.2).
  const hold = slice || count > 1
  return { title, detail, hold }
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** Предел набора — один, доменный: форма не вводит своё число. */
export { MAX_SESSION_DELETE_IDS }

/** Поле среза в форме: ключ списка — с префиксом, чтобы не спорить с `ids`. */
export function sliceFieldName(key: string): string {
  return `filter_${key}`
}

/**
 * Описание формы — **одно** и не зависит от адреса: и сервер, и компонент
 * строят его одной функцией, иначе ревизии разъедутся и форма не примет POST.
 * Набор и срез приходят значениями скрытых полей, а не новой формой.
 */
export function sessionDeleteForm() {
  const fields: Record<string, ReturnType<typeof field.hidden>> = {
    ids: field.hidden({ defaultValue: '', validate: [] }),
    variant: field.hidden({ defaultValue: 'delete', validate: [] }),
  }
  // Срез едет теми же ключами, что у списка: домен уже умеет их разбирать.
  for (const key of SESSIONS_FILTER_KEYS) {
    fields[sliceFieldName(key)] = field.hidden({ defaultValue: '', validate: [] })
  }
  return defineForm({
    id: SESSION_DELETE_FORM_ID,
    revision: 1,
    messages: { ...AUTH_MESSAGES },
    actions: [{ id: 'delete', label: 'Закрыть', validate: 'none' }],
    fields,
  })
}
