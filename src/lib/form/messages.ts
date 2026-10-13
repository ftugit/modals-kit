// Тексты НЕ зашиты в код валидаторов: валидатор отдаёт код и параметры.
// Как только текст появится в валидаторе хотя бы раз, он начнёт размножаться.
import { defaultPolicy } from './policy'

/** Словарь сообщений: строковый шаблон или функция от параметров. */
export type MessageDictionary = Record<string, string | ((p: Record<string, unknown>) => string)>

/** Русские сообщения по умолчанию для встроенных кодов ошибок. */
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
  step: (p) => `Шаг ${p['step']}`,
  multipleOf: (p) => `Шаг ${p['step']}`,
  oneOf: 'Выберите значение из списка',
  sameAs: 'Значения не совпадают',
  // ошибки БД (`lib/db`): уникальный индекс, CHECK-ограничение, значение не того
  // вида (строгие `gt`/`lt` zod, неизвестный формат) — коды из `FieldError`
  unique: 'Это значение уже занято',
  check: 'Значение не прошло проверку',
  invalid: 'Недопустимое значение',
  accept: (p) => `Файл ${p['name'] ?? ''} не подходит по типу`.replace('  ', ' '),
  maxSize: (p) => `Файл ${p['name'] ?? ''} больше ${Math.ceil(Number(p['bytes']) / 1024)} КБ`.replace('  ', ' '),
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

  // Выключение поля правилами `disabledWhen`: один текст на подсказку под
  // полем и на отказ набора. Виновник называется — «список невозможного»
  // пользователю не ответ. Подстановки — `disableParams`.
  'link.blocked': '«{field}» нельзя использовать вместе с {blockers}: {reason}',
  // Свои тексты правил (`DisableRule.message`), уже с подстановками.
  'link.message': '{text}',

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
  'submission.in-flight': 'Эта отправка уже выполняется. Дождитесь результата',
  'success-not-acknowledged': 'Операция не подтверждена',
  'interceptor.failed': 'Внутренняя ошибка обработки',
  'after.failed': 'Действие выполнено, но последующая задача завершилась с ошибкой',
  'check.failed': 'Не удалось выполнить проверку. Попробуйте ещё раз',
  'value.incompatible': 'Значение не подходит к изменившемуся полю',
  'method.not-allowed': 'Запрос отклонён: недопустимый метод',
  'origin.rejected': 'Запрос отклонён: чужой источник',
  'body.unsupported-type': 'Запрос отклонён: неподдерживаемый формат',
  'body.too-large': 'Запрос слишком большой',
  'body.too-many-keys': 'Запрос содержит слишком много полей',
  'request.too-many': 'Поле передано слишком много раз',
  'file.too-large': (p) => `Файл ${p['name'] ?? ''} слишком большой`.replace('  ', ' '),
  'rate.limited': (p) => {
    const s = Math.ceil(Number(p['retryAfterMs'] ?? 0) / 1000)
    return s > 0 ? `Слишком много попыток. Повторите через ${s} с` : 'Слишком много попыток. Повторите позже'
  },
}

/**
 * Приоритет (F56): свой текст ошибки (валидатор `.message()`) → в каждом
 * словаре сначала «поле:код» (сюда же `defineForm` кладёт `messages` поля),
 * потом код; словари — форма → приложение → пакет → код как текст.
 * Подстановка берётся из политики: падежи и множественное число — не дело ядра.
 */
export function makeRenderer(
  dicts: readonly (MessageDictionary | undefined)[],
  interpolate: (t: string, p: Record<string, unknown>) => string = defaultPolicy.interpolate,
) {
  const chain = dicts.filter(Boolean) as MessageDictionary[]
  return (
    code: string, params: Record<string, unknown> = {},
    at: { path?: string; template?: string } = {},
  ): string => {
    // F56: свой текст ошибки (валидатор `.message()`) сильнее любого словаря
    if (at.template !== undefined) return interpolate(at.template, params)
    // в каждом словаре «поле:код» конкретнее просто кода; словари — по порядку
    const keys = at.path ? [`${at.path}:${code}`, code] : [code]
    for (const d of chain) {
      for (const key of keys) {
        const t = d[key]
        if (typeof t === 'function') return t(params)
        if (typeof t === 'string') return interpolate(t, params)
      }
    }
    return code
  }
}
