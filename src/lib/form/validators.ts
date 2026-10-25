// Валидатор — обычная функция. Описание себя — необязательная добавка.
//
// Есть `describe` — правило относит себя к виду ограничения, и тип может
// спроецировать его в разметку. Нет `describe` — правило работает в браузере
// и на сервере, но атрибута не даёт. Честно, без догадок.
import type { FormLimits } from './budget'
import { opaque, type Constraint } from './constraints'
import { keep } from './keep'
import {
  LEVEL_MIN_LENGTH, meetsLevel, strengthOf, type Strength, type StrengthLevel,
} from './strength'
import type { FieldPath } from './types'

/**
 * Короткая ошибка валидатора до нормализации в FormError. `message` — свой
 * текст этой ошибки (шаблон с подстановками из `params`): сильнее любого
 * словаря (F56). Обычно его ставит `.message()` валидатора.
 */
export interface Issue { code: string; params?: Record<string, unknown>; path?: FieldPath; message?: string }
/** Создаёт Issue. */
export const issue = (code: string, params?: Record<string, unknown>): Issue => ({ code, params })

/** Контекст синхронного валидатора. */
export interface FieldContext {
  /** Путь проверяемого поля. */
  path: FieldPath
  /** Значения всей формы после декодирования. */
  values: Record<string, unknown>
  /** Ограничения текущего поля: нужны валидаторам, чья семантика зависит от соседних правил. */
  constraints?: readonly Constraint[]
  /** Бюджет формы. Нет — форма бюджета не объявляла, суммарная проверка выключена. */
  limits?: FormLimits
}

/** Функция проверки значения поля с необязательным описанием ограничений. */
export interface Validator<V = unknown> {
  (value: V, ctx: FieldContext): Issue | null
  describe?(): readonly Constraint[]
  /**
   * Тот же валидатор со своим текстом ошибки (F56):
   * `v.minValue(18).message('Вам должно быть {min}')`. Подстановки — из
   * параметров ошибки. Сильнее текста поля и словарей. Есть у всех
   * валидаторов, собранных через `describe` (встроенные, `check`).
   */
  message?(text: string): Validator<V>
}

/**
 * Валидатор, у которого `.message()` ЕСТЬ наверняка: встроенные `v.*` и `check`
 * (собраны через `describe`/`withText`). Отдельный тип нужен строгому
 * TypeScript: у произвольной функции-валидатора метода нет, поэтому в
 * `Validator` он необязателен, а у этих — вызывается без проверки.
 */
export type MessageValidator<V = unknown> = Validator<V> & {
  message(text: string): MessageValidator<V>
}

/**
 * Ссылка: функция (код) либо имя из реестра (сериализуемое описание).
 * `message` у именованной ссылки — то же, что `.message()` у функции.
 */
export type ValidatorRef = Validator<any> | { name: string; arg?: unknown; message?: string }

/** Валидатор `v` со своим текстом ошибки; описание и асинхронная метка сохраняются. */
export function withText<V>(v: Validator<V>, text: string): MessageValidator<V> {
  const out = ((value: V, ctx: FieldContext) => {
    const found = v(value, ctx)
    return found ? { ...found, message: text } : found
  }) as MessageValidator<V>
  if (v.describe) out.describe = v.describe
  // асинхронная проверка (`check`) отвечает не из функции, а из реестра проверок
  const meta = (v as { asyncCheck?: object }).asyncCheck
  if (meta) Object.assign(out, { asyncCheck: { ...meta, message: text } })
  out.message = (next: string) => withText(v, next)
  return out
}

/** Прикрепляет к валидатору описание ограничений для HTML-проекции. */
export function describe<V>(fn: (v: V, ctx: FieldContext) => Issue | null,
                            constraints: readonly Constraint[]): MessageValidator<V> {
  const out = Object.assign(fn, { describe: () => constraints }) as MessageValidator<V>
  out.message = (text: string) => withText(out, text)
  return out
}

/** Реестр именованных валидаторов. */
export class ValidatorRegistry {
  #byName = new Map<string, (arg: any) => Validator<any>>()
  register(name: string, factory: (arg: any) => Validator<any>): this {
    keep(this.#byName, name, factory, 'валидатор')
    return this
  }
  has = (name: string) => this.#byName.has(name)
  resolve(ref: ValidatorRef): Validator<any> {
    if (typeof ref === 'function') return ref
    const f = this.#byName.get(ref.name)
    if (!f) throw new Error(`[form] валидатор не зарегистрирован: ${ref.name}`)
    return ref.message === undefined ? f(ref.arg) : withText(f(ref.arg), ref.message)
  }
}

/** Ограничения, о которых рассказали валидаторы поля. Молчуны дают `opaque`. */
export function constraintsOf(
  refs: readonly ValidatorRef[], registry: ValidatorRegistry,
): Constraint[] {
  const out: Constraint[] = []
  for (const ref of refs) {
    let v: Validator<any>
    try { v = registry.resolve(ref) } catch { continue }
    if (!v.describe) { out.push(opaque('валидатор не описал себя')); continue }
    out.push(...v.describe())
  }
  return out
}

/* ── встроенные правила ────────────────────────────────────────────── */


const finiteNumber = (name: string, value: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new Error(`[form] ${name}: ожидается конечное число`)
  return value
}

const nonNegative = (name: string, value: number) => {
  const n = finiteNumber(name, value)
  if (n < 0) throw new Error(`[form] ${name}: ожидается неотрицательное число`)
  return n
}

const positive = (name: string, value: number) => {
  const n = finiteNumber(name, value)
  if (n <= 0) throw new Error(`[form] ${name}: ожидается положительное число`)
  return n
}

const nonEmptyString = (name: string, value: string) => {
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`[form] ${name}: ожидается непустая строка`)
  return value
}

const stepBaseConstraint = (ctx: FieldContext | undefined) =>
  ctx?.constraints?.find((c) => c.kind === 'minMagnitude' && c.safeAsAttr !== false) as
    | (Constraint & { value: number | string })
    | undefined

const decimalPlaces = (n: number) => {
  const s = String(n)
  const exp = /e-(\d+)$/i.exec(s)?.[1]
  if (exp) return Number(exp)
  return s.includes('.') ? s.split('.')[1]!.length : 0
}

const aligned = (value: number, step: number, base = 0) => {
  const scale = 10 ** Math.min(Math.max(decimalPlaces(value), decimalPlaces(step), decimalPlaces(base)), 12)
  const v = Math.round((value - base) * scale)
  const s = Math.round(step * scale)
  return s !== 0 && Math.abs(v % s) === 0
}

const parseDateDay = (value: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000
}

const parseTimeSecond = (value: string): number | null => {
  const m = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
}

const parseDateTimeSecond = (value: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!m) return null
  return Math.floor(Date.UTC(
    Number(m[1]), Number(m[2]) - 1, Number(m[3]),
    Number(m[4]), Number(m[5]), Number(m[6] ?? 0),
  ) / 1000)
}

const stepValue = (value: unknown, unit: string | undefined): { amount: number; unit: 'number' | 'day' | 'second' } | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? { amount: value, unit: 'number' } : null
  if (typeof value !== 'string' || value === '') return null

  const inferred = unit ?? (value.includes('T') || /^\d{2}:/.test(value) ? 'second' : 'day')
  if (inferred === 'day') {
    const amount = parseDateDay(value)
    return amount === null ? null : { amount, unit: 'day' }
  }
  if (inferred === 'second') {
    const amount = value.includes('T') ? parseDateTimeSecond(value) : parseTimeSecond(value)
    return amount === null ? null : { amount, unit: 'second' }
  }
  return null
}

const stepBase = (ctx: FieldContext, parsed: { unit: 'number' | 'day' | 'second' }) => {
  const c = stepBaseConstraint(ctx)
  if (!c) return 0
  if (parsed.unit === 'number') return typeof c.value === 'number' ? c.value : 0
  if (typeof c.value !== 'string') return 0
  if (parsed.unit === 'day') return parseDateDay(c.value) ?? 0
  return (c.value.includes('T') ? parseDateTimeSecond(c.value) : parseTimeSecond(c.value)) ?? 0
}

/** Значение поля `file` (один файл) или `files` (массив) — списком файлов. */
const filesOf = (value: File | readonly File[] | null | undefined): readonly File[] =>
  value == null ? [] : Array.isArray(value) ? value : [value as File]

/**
 * Совпадение файла с токеном `accept` по правилам HTML: `.ext` — суффикс имени
 * без учёта регистра, `type/*` — любой подтип, иначе MIME-тип целиком без учёта
 * регистра и параметров. Строковое сравнение, не RegExp: в MIME есть `+` и `.`.
 * Проверяется ЗАЯВЛЕННЫЙ клиентом тип — содержимое файла никто не смотрит.
 */
const acceptsFile = (token: string, f: File): boolean => {
  const t = token.trim().toLowerCase()
  if (t.startsWith('.')) return f.name.toLowerCase().endsWith(t)
  const type = (f.type ?? '').split(';')[0]!.trim().toLowerCase()
  if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1))
  return type === t
}

const filled = (x: unknown) =>
  x !== null && x !== undefined && x !== '' && x !== false && !(Array.isArray(x) && !x.length)
const len = (x: unknown) => (typeof x === 'string' ? x.length : Array.isArray(x) ? x.length : 0)
const EMAIL_HTML5 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_STRICT = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

/**
 * Первый файл формы, выводящий сумму за бюджет файлов, — в порядке объявления
 * полей и файлов в значении. Возвращает поле-владельца: ошибку показывает
 * только оно.
 */
/** Набор встроенных валидаторов. */
export const v = {
  required: () => describe<unknown>(
    (x) => (filled(x) ? null : issue('required')),
    [{ kind: 'required' }]),

  email: (mode: 'html5' | 'strict' = 'html5') => describe<string>(
    (x) => {
      if (!filled(x)) return null
      return (mode === 'strict' ? EMAIL_STRICT : EMAIL_HTML5).test(x) ? null : issue('email')
    },
    // строгая проверка строже браузерной: атрибут поставил бы ограничение мягче,
    // чем сервер, и это допустимо; обратное — нет, поэтому строгую не проецируем
    mode === 'strict'
      ? [{ kind: 'opaque', why: 'строгий формат строже проверки браузера', safeAsAttr: false }]
      : [{ kind: 'pattern', source: '[^@\\s]+@[^@\\s]+\\.[^@\\s]+' }]),

  url: () => describe<string>(
    (x) => {
      if (!filled(x)) return null
      try { new URL(x); return null } catch { return issue('url') }
    },
    [{ kind: 'opaque', why: 'разбор ссылки точнее любого шаблона', safeAsAttr: false }]),

  /** Шаблон задаётся исходником: именованные живут в реестре приложения. */
  pattern: (name: { source: string }) => {
    const source = name?.source
    if (typeof source !== 'string') throw new Error('[form] pattern: ожидается { source: string }')
    const re = new RegExp(`^(?:${source})$`, 'u')
    return describe<string>(
      (x) => (!filled(x) || re.test(x) ? null : issue('pattern')),
      [{ kind: 'pattern', source }])
  },

  minLength: (n: number) => {
    const min = nonNegative('minLength', n)
    return describe<string>(
      (x) => (!filled(x) || len(x) >= min ? null : issue('minLength', { min, actual: len(x) })),
      [{ kind: 'minLength', value: min }])
  },

  maxLength: (n: number) => {
    const max = nonNegative('maxLength', n)
    return describe<string>(
      (x) => (len(x) <= max ? null : issue('maxLength', { max, actual: len(x) })),
      [{ kind: 'maxLength', value: max }])
  },

  minValue: (n: number, exclusive = false) => {
    const min = finiteNumber('minValue', n)
    return describe<number | null>(
      (x) => {
        if (x === null || x === undefined) return null
        return (exclusive ? x > min : x >= min) ? null : issue('minValue', { min })
      },
      // исключающая граница: браузер принял бы само пограничное значение
      [{ kind: 'minMagnitude', value: min, exclusive,
         safeAsAttr: !exclusive, why: exclusive ? 'граница исключающая' : undefined }])
  },

  maxValue: (n: number, exclusive = false) => {
    const max = finiteNumber('maxValue', n)
    return describe<number | null>(
      (x) => {
        if (x === null || x === undefined) return null
        return (exclusive ? x < max : x <= max) ? null : issue('maxValue', { max })
      },
      [{ kind: 'maxMagnitude', value: max, exclusive,
         safeAsAttr: !exclusive, why: exclusive ? 'граница исключающая' : undefined }])
  },

  minDate: (value: string) => {
    const min = nonEmptyString('minDate', value)
    return describe<string | null>(
      (x) => (!x || x >= min ? null : issue('minDate', { min })),
      [{ kind: 'minMagnitude', value: min }])
  },

  maxDate: (value: string) => {
    const max = nonEmptyString('maxDate', value)
    return describe<string | null>(
      (x) => (!x || x <= max ? null : issue('maxDate', { max })),
      [{ kind: 'maxMagnitude', value: max }])
  },

  minCount: (n: number) => {
    const min = nonNegative('minCount', n)
    return describe<readonly unknown[]>(
      (x) => (x.length >= min ? null : issue('minCount', { min, actual: x.length })),
      [{ kind: 'minCount', value: min }])
  },

  maxCount: (n: number) => {
    const max = nonNegative('maxCount', n)
    return describe<readonly unknown[]>(
      (x) => (x.length <= max ? null : issue('maxCount', { max, actual: x.length })),
      [{ kind: 'maxCount', value: max }])
  },

  integer: () => describe<number | null>(
    (x) => (x === null || Number.isInteger(x) ? null : issue('integer')),
    [{ kind: 'step', value: 1, unit: 'number' }]),

  step: (n: number, unit?: string) => {
    const step = positive('step', n)
    return describe<unknown>(
      (x, ctx) => {
        if (!filled(x)) return null
        const parsed = stepValue(x, unit)
        if (!parsed) return issue('step', { step, unit })
        const base = stepBase(ctx, parsed)
        return aligned(parsed.amount, step, base) ? null : issue('step', { step, base })
      },
      [{ kind: 'step', value: step, unit }])
  },

  oneOf: (values: readonly string[]) => {
    if (!Array.isArray(values)) throw new Error('[form] oneOf: ожидается массив строк')
    return describe<string | null>(
      (x) => (x === null || values.includes(x) ? null : issue('oneOf')),
      [{ kind: 'oneOf', values }])
  },

  accept: (types: readonly string[]) => {
    if (!Array.isArray(types) || types.some((t) => typeof t !== 'string' || !t))
      throw new Error('[form] accept: ожидается непустой массив MIME-типов или расширений')
    return describe<File | readonly File[] | null>(
      (value) => {
        // `files` несёт массив: правило действует на КАЖДЫЙ файл, как атрибут `accept`
        const bad = filesOf(value).find((f) => !types.some((t) => acceptsFile(t, f)))
        return bad ? issue('accept', { types, name: bad.name }) : null
      },
      [{ kind: 'accept', types }])
  },

  maxSize: (bytes: number) => {
    const max = nonNegative('maxSize', bytes)
    return describe<File | readonly File[] | null>(
      (value, ctx) => {
        // Бюджет файлов формы сужает личный предел: обещать «до 10 МБ» при
        // бюджете 7 МБ — обещать то, что всё равно не доедет.
        const budget = ctx.limits?.filesBytes ?? Number.POSITIVE_INFINITY
        const cap = Math.min(max, budget)
        // предел на каждый файл отдельно — как `Limits.maxFileSize` приёма.
        // Сумму по форме считает не правило, а вес тела (`weight.ts`): валидатор
        // видит одно значение и не обязан знать про соседей.
        const big = filesOf(value).find((f) => f.size > cap)
        return big ? issue('maxSize', { bytes: cap, name: big.name }) : null
      },
      [{ kind: 'maxSize', bytes: max }])
  },

  /**
   * Сложность пароля.
   *
   * Шаблоном это не выражается: он проверяет наличие символов, а не стойкость,
   * и заодно мешает ставить знаки. Поэтому оценка — и честный `opaque`.
   *
   * В разметку уходит только нижняя граница длины для выбранного уровня:
   * она МЯГЧЕ настоящей проверки, а значит безопасна — браузер отсеет совсем
   * короткое, остальное скажет ядро и сервер.
   */
  strength: (
    need: StrengthLevel = 'good',
    o: { minLength?: number; score?: (value: string) => Strength } = {},
  ) => {
    const score = o.score ?? strengthOf
    const floor = o.minLength ?? LEVEL_MIN_LENGTH[need]
    return describe<string>((x) => {
      if (!filled(x)) return null
      const got = score(x)
      return meetsLevel(got.level, need)
        ? null
        : issue('strength', { need, got: got.level, bits: got.bits, notes: got.notes })
    }, [
      { kind: 'minLength', value: floor },
      opaque('сложность оценивается, а не сверяется с шаблоном'),
    ])
  },

  /** Межполевое сравнение: вида ограничения для него нет, и быть не может. */
  sameAs: (field: FieldPath) => describe<unknown>(
    (x, ctx) => (x === ctx.values[field] ? null : issue('sameAs', { field })),
    [opaque('браузер не умеет сравнивать поля между собой')]),

  /**
   * Не больше значения другого поля: нижняя граница диапазона («Год от» ≤ «Год до»).
   * Пустое с любой стороны — не ошибка: диапазон может быть открытым. Числа
   * сравниваются как числа, строки — как строки (ISO-даты и время упорядочены так же).
   */
  notAbove: (field: FieldPath) => describe<unknown>(
    (x, ctx) => {
      const other = ctx.values[field]
      return ordered(x, other) === 1 ? issue('notAbove', { field, other }) : null
    },
    [opaque('браузер не умеет сравнивать поля между собой')]),

  /** Не меньше значения другого поля: верхняя граница диапазона. Пустое — не ошибка. */
  notBelow: (field: FieldPath) => describe<unknown>(
    (x, ctx) => {
      const other = ctx.values[field]
      return ordered(x, other) === -1 ? issue('notBelow', { field, other }) : null
    },
    [opaque('браузер не умеет сравнивать поля между собой')]),

  /**
   * Нет общих значений с другим полем-списком: одно значение не может быть сразу
   * «обязательным» и «исключённым». `values` — общие значения (для своего текста).
   */
  noOverlap: (field: FieldPath) => describe<unknown>(
    (x, ctx) => {
      const other = ctx.values[field]
      if (!Array.isArray(x) || !Array.isArray(other) || !x.length || !other.length) return null
      const theirs = new Set(other.map(String))
      const values = [...new Set(x.map(String))].filter((item) => theirs.has(item))
      return values.length ? issue('noOverlap', { field, values, count: values.length }) : null
    },
    [opaque('браузер не умеет сравнивать поля между собой')]),
}

/**
 * Порядок двух значений для межполевых границ: 1 — первое больше, -1 — меньше,
 * 0 — равны, несравнимы или одно из них пустое. Сравниваются только значения
 * одного вида: число с числом, непустая строка со строкой.
 */
function ordered(a: unknown, b: unknown): -1 | 0 | 1 {
  if (typeof a === 'number' && typeof b === 'number' && Number.isFinite(a) && Number.isFinite(b))
    return a > b ? 1 : a < b ? -1 : 0
  if (typeof a === 'string' && typeof b === 'string' && a !== '' && b !== '')
    return a > b ? 1 : a < b ? -1 : 0
  return 0
}

/** Встроенные правила — такой же набор, как любой другой. */
export const BUILTIN_VALIDATORS: Record<string, (arg: any) => Validator<any>> = {
  required: () => v.required(),
  email: (a: any) => v.email(a ?? 'html5'),
  url: () => v.url(),
  pattern: (a: any) => v.pattern(a),
  minLength: (a: any) => v.minLength(a),
  maxLength: (a: any) => v.maxLength(a),
  minValue: (a: any) => Array.isArray(a) ? v.minValue(a[0], Boolean(a[1])) : v.minValue(a),
  maxValue: (a: any) => Array.isArray(a) ? v.maxValue(a[0], Boolean(a[1])) : v.maxValue(a),
  minDate: (a: any) => v.minDate(a),
  maxDate: (a: any) => v.maxDate(a),
  minCount: (a: any) => v.minCount(a),
  maxCount: (a: any) => v.maxCount(a),
  integer: () => v.integer(),
  step: (a: any) => Array.isArray(a) ? v.step(Number(a[0]), a[1] === undefined ? undefined : String(a[1])) : v.step(a),
  oneOf: (a: any) => v.oneOf(a),
  accept: (a: any) => v.accept(Array.isArray(a) ? a : [String(a)]),
  maxSize: (a: any) => v.maxSize(a),
  strength: (a: any) => v.strength(a ?? 'good'),
  sameAs: (a: any) => v.sameAs(String(a)),
  notAbove: (a: any) => v.notAbove(String(a)),
  notBelow: (a: any) => v.notBelow(String(a)),
  noOverlap: (a: any) => v.noOverlap(String(a)),
}
