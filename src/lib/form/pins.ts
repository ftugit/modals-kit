/* ── Серверная ошибка закреплена за значением поля ───────────────────────────
 * Ошибку бизнес-действия («адрес занят», «секрет не подошёл», отказ БД) клиент
 * проверить не может. Она видна, пока поле хранит ровно то значение, которое сервер
 * отклонил: изменили символ — ошибка ушла (во время ввода, а не на уходе с поля:
 * иначе строка ошибки исчезала бы под нажатой кнопкой, сдвигала её, и клик терялся);
 * вернули прежнее — ошибка снова видна. Собственная проверка поля сильнее: пока у поля
 * есть ошибка клиента, серверная скрыта. Общие ошибки без полей не закрепляются и
 * держатся до следующей отправки.
 *
 * Чистые функции без фреймворка: обвязка хранит закрепы, отдаёт сюда текущие значения
 * формы (`FormData`) и факты, а получает новые факты — или `null`, если показ не меняется.
 *
 * Когда сверять (обвязке): после записи значения поля в состояние — в обработчике ввода
 * поля. Слушатель `input` на самой форме в Svelte не годится: он срабатывает раньше
 * делегированных обработчиков полей, и запись в состояние до них перерисовывала поле
 * прежним значением — набранный символ стирался (проверено в Chromium; микрозадача не
 * спасает: у доверенного события она выполняется между слушателями). При оживлении —
 * один раз, чтобы снять значения для ошибок продолжения.
 */
import type { FormError } from './result'

export interface Pin {
  readonly error: FormError
  /** Поля, за значениями которых закреплена ошибка: `path` или `params.fields`. */
  readonly fields: readonly string[]
  /** Отправленные значения; `null` — снять с формы при первой сверке (продолжение без JS). */
  sent: string[] | null
}

const fromServer = (e: FormError) => e.origin === 'server' || e.origin === 'external'

/** Значение поля как его несёт форма: все записи имени, файл — именем, размером и датой (пустая заглушка браузера `File([], '')` без имени имеет плавающий `Date.now()` и сводится к `''`). */
export const sampleField = (data: FormData, name: string): string =>
  data
    .getAll(name)
    .map((v) => (typeof v === 'string' ? v : v.name || v.size ? `${v.name}:${v.size}:${v.lastModified}` : ''))
    .join('\u0000')

/**
 * Закрепы для ошибок сервера, привязанных к известным полям. Без `sent` (продолжение пути
 * без JS) значения снимаются с разметки при оживлении: сервер отрисовал поля ровно с ними.
 */
export function pinErrors(errors: readonly FormError[], known: (name: string) => boolean, sent?: FormData): Pin[] {
  const out: Pin[] = []
  for (const error of errors) {
    if (!fromServer(error)) continue
    const group = error.params?.fields
    const fields = error.path
      ? [error.path]
      : Array.isArray(group) && group.every((x) => typeof x === 'string') ? (group as string[]) : []
    if (!fields.length || !fields.every(known)) continue
    out.push({ error, fields, sent: sent ? fields.map((n) => sampleField(sent, n)) : null })
  }
  return out
}

export const isPinned = (pins: readonly Pin[], e: FormError): boolean => pins.some((p) => p.error.id === e.id)

/**
 * Факты с видимыми закреплёнными ошибками: видна та, у которой все поля хранят отправленные
 * значения и ни на одном нет ошибки клиента. `null` — набор видимых не изменился.
 */
export function reconcilePins(pins: Pin[], facts: readonly FormError[], data: FormData): FormError[] | null {
  for (const p of pins) p.sent ??= p.fields.map((n) => sampleField(data, n))
  const clientBad = new Set(facts.filter((e) => e.path && !fromServer(e) && !isPinned(pins, e)).map((e) => e.path!))
  const visible = pins.filter((p) => p.fields.every((n, i) => !clientBad.has(n) && sampleField(data, n) === p.sent![i]))
  const now = new Set(facts.filter((e) => isPinned(pins, e)).map((e) => e.id))
  if (visible.length === now.size && visible.every((p) => now.has(p.error.id))) return null
  return [...facts.filter((e) => !isPinned(pins, e)), ...visible.map((p) => p.error)]
}
