/* ── Перехват поля: чистая логика ошибки операции ────────────────────────────
 * Перехватчик (клиентская обвязка, `svelte/bind`) готовит значение поля
 * асинхронно — например, конвертирует файл. Если подготовка не удалась,
 * это не ошибка проверки описания и не факт сервера: сервер её не знает
 * и воспроизвести не должен. Поэтому живёт она как закреп (pins) с
 * `origin: 'external'`: видна, пока носитель хранит значение, при котором
 * операция упала; собственная проверка поля сильнее; отправку блокирует
 * локально — теми же правилами, что локальная проверка в `runSubmit`
 * (только полные действия, subset учитывается).
 *
 * Здесь — только чистые решения по FormData; состояние и показ — обвязка.
 */
import type { LimitPolicy } from './policy'
import { sampleField, type Pin } from './pins'
import { normalizeErrors, type FormError, type RenderMessage } from './result'

/** Что перехватчик сообщает об упавшей операции: код словаря + подстановки. */
export interface OpErrorInput {
  code: string
  params?: Record<string, unknown>
}

/** Факт ошибки операции поля: `external`, у поля, текст — по словарю формы. */
export function opError(
  name: string,
  err: OpErrorInput,
  render: RenderMessage,
  limits: LimitPolicy,
): FormError | undefined {
  return normalizeErrors(
    [{ id: '', code: err.code, origin: 'external', path: name, params: err.params }],
    render,
    limits,
  )[0]
}

/**
 * Закреп ошибки операции за текущим значением носителя. Без `data`
 * (формы ещё нет в DOM) сэмпл снимет первая сверка — как у pins.
 */
export function opPin(name: string, error: FormError, data?: FormData): Pin {
  return { error, fields: [name], sent: data ? [sampleField(data, name)] : null }
}

/**
 * Ошибки операций, блокирующие это действие: действие полное
 * (`validate: 'full'`), поле входит в его subset (если задан), а значение
 * в отправляемых данных — то же, за которым ошибка закреплена.
 */
export function blockingOpErrors(
  pins: Iterable<Pin>,
  data: FormData,
  descriptor: { validate: string; subset?: readonly string[] } | undefined,
): FormError[] {
  if (!descriptor || descriptor.validate !== 'full') return []
  const out: FormError[] = []
  for (const p of pins) {
    if (descriptor.subset && !descriptor.subset.includes(p.fields[0]!)) continue
    p.sent ??= p.fields.map((n) => sampleField(data, n))
    if (p.fields.every((n, i) => sampleField(data, n) === p.sent![i])) out.push(p.error)
  }
  return out
}
