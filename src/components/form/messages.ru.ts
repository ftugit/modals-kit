// Русский UI-словарь встроенных кодов ошибок форм (`#lib/form` + `#lib/db`).
//
// Ядро `#lib/form` держит только компактный английский базовый словарь `en`
// (сервер и чистые библиотеки общаются на контракте `EN + code`), а русский
// перевод подключается один раз в UI-слое (`forms.config.ts`).
import type { MessageDictionary } from '#lib/form/index.js'

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
  notAbove: 'Не больше верхней границы ({other})',
  notBelow: 'Не меньше нижней границы ({other})',
  noOverlap: (p) =>
    Number(p['count']) > 1
      ? 'Эти значения выбраны и здесь, и в соседнем поле'
      : 'Это значение выбрано и здесь, и в соседнем поле',
  unique: 'Это значение уже занято',
  check: 'Значение не прошло проверку',
  reference: 'Связанная запись не найдена',
  referenced: 'Нельзя удалить: на запись ссылаются другие записи',
  invalid: 'Недопустимое значение',
  accept: (p) => `Файл ${p['name'] ?? ''} не подходит по типу`.replace('  ', ' '),
  maxSize: (p) => `Файл ${p['name'] ?? ''} больше ${Math.ceil(Number(p['bytes']) / 1024)} КБ`.replace('  ', ' '),
  'form.budget': (p) => {
    const mb = (n: unknown) => Math.round((Number(n) / (1024 * 1024)) * 10) / 10
    return `Форма больше допустимого: ${mb(p['total'])} МБ при пределе ${mb(p['max'])} МБ. Уберите файл или сократите текст`
  },
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
      weak: 'слабый',
      fair: 'средний',
      good: 'хороший',
      strong: 'надёжный',
    }
    const head = `Пароль ${level[String(p['got'])] ?? '—'}, нужен ${level[String(p['need'])] ?? '—'}`
    return notes.length ? `${head}: ${notes.join(', ')}` : head
  },
  'link.blocked': '«{field}» нельзя использовать вместе с {blockers}: {reason}',
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
  'request.timeout': 'Форма не успела обработаться. Попробуйте ещё раз',
  'kit.not-list': 'Описание полей не распознано',
  'type.fields': 'Набор полей не распознан',
  'kit.too-many-fields': (p) => `Полей ${p['count']}, можно не больше ${p['max']}`,
  'kit.field-shape': 'Описание поля не распознано',
  'kit.unknown-kind': 'Такого вида поля нет',
  'kit.rule-not-allowed': 'Это правило не подходит к виду поля',
  'kit.rule-duplicate': 'Правило выбрано дважды',
  'kit.arg-type': 'Значение правила — число',
  'kit.arg-missing': 'Укажите значение правила',
  'kit.spec': 'Поле описано неверно: проверьте его правила',
  'rate.limited': (p) => {
    const s = Math.ceil(Number(p['retryAfterMs'] ?? 0) / 1000)
    return s > 0 ? `Слишком много попыток. Повторите через ${s} с` : 'Слишком много попыток. Повторите позже'
  },
}
