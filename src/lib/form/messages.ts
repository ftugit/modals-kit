// Тексты НЕ зашиты в код валидаторов: валидатор отдаёт код и параметры.
// Как только текст появится в валидаторе хотя бы раз, он начнёт размножаться.
import { defaultPolicy } from './policy'

export type MessageDictionary = Record<string, string | ((p: Record<string, unknown>) => string)>

export const ru: MessageDictionary = {
  required: 'Обязательное поле',
  email: 'Введите корректный адрес почты',
  url: 'Введите корректную ссылку',
  pattern: 'Значение не соответствует формату',
  minLength: (p) => `Минимум ${p['min']} символов`,
  maxLength: (p) => `Не больше ${p['max']} символов`,
  minValue: (p) => `Не меньше ${p['min']}`,
  maxValue: (p) => `Не больше ${p['max']}`,
  minCount: (p) => `Выберите хотя бы ${p['min']}`,
  maxCount: (p) => `Не больше ${p['max']} вариантов`,
  minDate: (p) => `Не раньше ${p['min']}`,
  maxDate: (p) => `Не позже ${p['max']}`,
  integer: 'Введите целое число',
  multipleOf: (p) => `Шаг ${p['step']}`,
  oneOf: 'Выберите значение из списка',
  sameAs: 'Значения не совпадают',
  strength: (p) => {
    const why: Record<string, string> = {
      short: 'слишком короткий',
      'one-class': 'только один набор символов',
      repeat: 'это повторение одного куска',
      sequence: 'подряд идущие символы перебираются первыми',
      common: 'слишком известный',
    }
    const notes = (p['notes'] as string[] | undefined)?.map((n) => why[n]).filter(Boolean) ?? []
    const level: Record<string, string> = {
      weak: 'слабый', fair: 'средний', good: 'хороший', strong: 'надёжный',
    }
    const head = `Пароль ${level[String(p['got'])] ?? '—'}, нужен ${level[String(p['need'])] ?? '—'}`
    return notes.length ? `${head}: ${notes.join(', ')}` : head
  },

  'type.number': 'Введите число',
  'type.date': 'Введите дату',
  'type.time': 'Введите время',
  'type.datetime': 'Введите дату и время',

  'form.stale': 'Форма устарела: набор полей изменился',
  'network.failed': 'Неизвестно, выполнилась ли операция. Не отправляйте повторно',
  'envelope.invalid': 'Запрос отклонён',
  'envelope.missing': 'Запрос отклонён: не хватает конверта',
  'envelope.unknown-intent': 'Неизвестное действие',
  'envelope.instance-mismatch': 'Запрос отклонён',
  'envelope.form-mismatch': 'Запрос отклонён',
  'request.unexpected-field': 'Запрос содержит неизвестное поле',
  'request.duplicate': 'Поле передано дважды',
  'handler.failed': 'Операция не выполнена',
  'success-not-acknowledged': 'Операция не подтверждена',
  'interceptor.failed': 'Внутренняя ошибка обработки',
}

/**
 * Приоритет: поле → форма → приложение → пакет → код как текст.
 * Подстановка берётся из политики: падежи и множественное число — не дело ядра.
 */
export function makeRenderer(
  dicts: readonly (MessageDictionary | undefined)[],
  interpolate: (t: string, p: Record<string, unknown>) => string = defaultPolicy.interpolate,
) {
  const chain = dicts.filter(Boolean) as MessageDictionary[]
  return (code: string, params: Record<string, unknown> = {}): string => {
    for (const d of chain) {
      const t = d[code]
      if (typeof t === 'function') return t(params)
      if (typeof t === 'string') return interpolate(t, params)
    }
    return code
  }
}
