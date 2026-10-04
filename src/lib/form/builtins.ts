// Десять встроенных типов. Регистрируются ТЕМ ЖЕ способом, что и пользовательские:
// иначе у пользовательских был бы другой контракт и они отстали бы от развития.
import { type Constraint } from './constraints'
import type { DecodeResult, FieldType, Projection } from './field-types'
import type { HtmlAttrs, InputMode, ValueKind } from './types'

const ok = <V>(value: V): DecodeResult<V> => ({ ok: true, value })
const bad = (code: string, params?: Record<string, unknown>): DecodeResult<never> =>
  ({ ok: false, code, params })
const first = (e: readonly (string | File)[]) => (typeof e[0] === 'string' ? e[0] : '')

const num = (c: Constraint) => (c as { value: number }).value

/**
 * Правило разбора числа из спецификации HTML. Уже, чем Number(): агент санирует
 * '+20' и ' 5 ' в ПУСТОЕ значение, и поле с обязательностью окажется незаполненным.
 * Принимай ядро такие строки — браузер блокировал бы отправку там, где сервер её принял.
 */
const HTML_FLOAT = /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_TIME = /^\d{2}:\d{2}(:\d{2})?$/
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

const required: Projection = () => ({ required: true })

export const textType: FieldType<string> = {
  kind: 'text',
  inputs: ['text', 'email', 'password', 'tel', 'url', 'search', 'color', 'hidden', 'textarea'],
  multiple: false, empty: '',
  decode: (e) => ok(first(e)),
  encode: (v, n, out) => { out.push([n, v]) },
  constraints: {
    required: (_c, ctx) =>
      // обязательность скрытого поля заблокировала бы отправку всей формы
      ctx.input === 'hidden' ? { skip: 'обязательность на скрытом поле блокирует форму' } : { required: true },
    minLength: (c) => ({ minlength: num(c) }),
    maxLength: (c) => ({ maxlength: num(c) }),
    pattern: (c, ctx) =>
      // браузер игнорирует шаблон на многострочном поле
      ctx.input === 'textarea'
        ? { skip: 'браузер игнорирует шаблон в многострочном поле' }
        : { pattern: (c as { source: string }).source },
    oneOf: true,
    opaque: true,
  },
  attrs: (input) => (input === 'textarea' ? {} : { type: input === 'text' ? 'text' : input }),
  degradation: { withoutJs: 'обычное текстовое поле' },
}

export const numberType: FieldType<number | null> = {
  kind: 'number', inputs: ['number', 'range'], multiple: false, empty: null,
  decode: (e) => {
    const raw = first(e)
    if (raw.trim() === '') return ok(null)
    if (!HTML_FLOAT.test(raw)) return bad('type.number', { raw })
    const n = Number(raw)
    return Number.isFinite(n) ? ok(n) : bad('type.number', { raw })
  },
  encode: (v, n, out) => { if (v !== null) out.push([n, String(v)]) },
  constraints: {
    required,
    minMagnitude: (c) => ({ min: num(c) }),
    maxMagnitude: (c) => ({ max: num(c) }),
    step: (c) => ({ step: num(c) }),
    oneOf: true,
    opaque: true,
  },
  attrs: (input) => ({ type: input === 'range' ? 'range' : 'number', inputmode: 'numeric' }),
  degradation: { withoutJs: 'поле ввода числа' },
}

export const checkboxType: FieldType<boolean> = {
  kind: 'checkbox', inputs: ['checkbox'], multiple: false, empty: false,
  // отсутствие записи = не отмечен. Нативная семантика, а не ошибка.
  decode: (e) => ok(e.length > 0 && first(e) !== '' && first(e) !== 'off'),
  encode: (v, n, out) => { if (v) out.push([n, 'on']) },
  constraints: { required, opaque: true },
  attrs: () => ({ type: 'checkbox', value: 'on' }),
  degradation: { withoutJs: 'флажок' },
}

function temporal(kind: ValueKind, re: RegExp, input: InputMode, unit: string, label: string): FieldType<string | null> {
  return {
    kind, inputs: [input], multiple: false, empty: null,
    decode: (e) => {
      const raw = first(e).trim()
      if (raw === '') return ok(null)
      return re.test(raw) ? ok(raw) : bad(`type.${kind}`, { raw })
    },
    encode: (v, n, out) => { if (v !== null) out.push([n, v]) },
    constraints: {
      required,
      minMagnitude: (c) => ({ min: (c as { value: string | number }).value }),
      maxMagnitude: (c) => ({ max: (c as { value: string | number }).value }),
      step: (c) => {
        const declared = (c as { unit?: string }).unit
        // шаг у даты считается в днях, у времени в секундах: чужая единица опаснее отсутствия
        return declared && declared !== unit
          ? { skip: `шаг объявлен в «${declared}», представление считает в «${unit}»` }
          : { step: num(c) }
      },
      opaque: true,
    },
    attrs: () => ({ type: input }),
    degradation: { withoutJs: label },
  }
}

export const dateType = temporal('date', ISO_DATE, 'date', 'day', 'поле даты')
export const timeType = temporal('time', ISO_TIME, 'time', 'second', 'поле времени')
export const datetimeType = temporal('datetime', ISO_DATETIME, 'datetime-local', 'second', 'поле даты и времени')

export const selectType: FieldType<string | null> = {
  kind: 'select', inputs: ['select', 'radio'], multiple: false, empty: null,
  decode: (e) => { const raw = first(e); return ok(raw === '' ? null : raw) },
  encode: (v, n, out) => { if (v !== null) out.push([n, v]) },
  // список вариантов сам и есть ограничение: отдельный атрибут не нужен
  constraints: { required, oneOf: true, opaque: true },
  attrs: () => ({}),
  degradation: { withoutJs: 'обычный список', lost: 'поиск по вариантам' },
}

export const multiselectType: FieldType<readonly string[]> = {
  kind: 'multiselect', inputs: ['multiselect'], multiple: true, empty: [],
  decode: (e) => ok(e.filter((x): x is string => typeof x === 'string' && x !== '')),
  encode: (v, n, out) => { for (const x of v) out.push([n, x]) },
  constraints: {
    required,
    // нативного атрибута количества не существует
    minCount: () => ({ skip: 'у количества нет нативного атрибута' }),
    maxCount: () => ({ skip: 'у количества нет нативного атрибута' }),
    oneOf: true, opaque: true,
  },
  attrs: () => ({ multiple: true }),
  degradation: { withoutJs: 'список с множественным выбором' },
}

const fileConstraints = {
  required,
  // подсказка выбора, а не проверка: сервер всё равно смотрит содержимое
  accept: (c: Constraint) => ({ accept: (c as { types: readonly string[] }).types.join(',') }),
  maxSize: () => ({ skip: 'у предела размера нет нативного атрибута' }),
  opaque: true as const,
}

export const fileType: FieldType<File | null> = {
  kind: 'file', inputs: ['file'], multiple: false, empty: null,
  decode: (e) => { const f = e[0]; return ok(f && typeof f !== 'string' ? f : null) },
  encode: (v, n, out) => { if (v) out.push([n, v]) },
  constraints: fileConstraints,
  attrs: () => ({ type: 'file' }),
  degradation: { withoutJs: 'выбор файла', lost: 'перетаскивание, индикатор загрузки' },
}

export const filesType: FieldType<readonly File[]> = {
  kind: 'files', inputs: ['files'], multiple: true, empty: [],
  decode: (e) => ok(e.filter((x): x is File => typeof x !== 'string')),
  encode: (v, n, out) => { for (const f of v) out.push([n, f]) },
  constraints: {
    ...fileConstraints,
    maxCount: (c) => (num(c) > 1 ? { multiple: true } : { skip: 'множественность при пределе 1 не нужна' }),
    minCount: () => ({ skip: 'у количества нет нативного атрибута' }),
  },
  attrs: () => ({ type: 'file', multiple: true }),
  degradation: { withoutJs: 'выбор нескольких файлов', lost: 'перетаскивание' },
}

export const BUILTIN_TYPES = [
  textType, numberType, checkboxType, dateType, timeType, datetimeType,
  selectType, multiselectType, fileType, filesType,
] as const
