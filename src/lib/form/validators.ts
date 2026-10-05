// Валидатор — обычная функция. Описание себя — необязательная добавка.
//
// Есть `describe` — правило относит себя к виду ограничения, и тип может
// спроецировать его в разметку. Нет `describe` — правило работает в браузере
// и на сервере, но атрибута не даёт. Честно, без догадок.
import { opaque, type Constraint } from './constraints'
import { keep } from './keep'
import {
  LEVEL_MIN_LENGTH, meetsLevel, strengthOf, type Strength, type StrengthLevel,
} from './strength'
import type { FieldPath } from './types'

export interface Issue { code: string; params?: Record<string, unknown>; path?: FieldPath }
export const issue = (code: string, params?: Record<string, unknown>): Issue => ({ code, params })

export interface FieldContext { path: FieldPath; values: Record<string, unknown> }

export interface Validator<V = unknown> {
  (value: V, ctx: FieldContext): Issue | null
  describe?(): readonly Constraint[]
}

/** Ссылка: функция (код) либо имя из реестра (сериализуемое описание). */
export type ValidatorRef = Validator<any> | { name: string; arg?: unknown }

/**
 * Собрать валидатор с описанием себя.
 * @param fn Проверка: значение и контекст → проблема или `null`.
 * @param constraints Виды ограничений, к которым правило себя относит.
 * @returns Валидатор с `describe` — тип значения сможет спроецировать их в разметку.
 */
export function describe<V>(fn: (v: V, ctx: FieldContext) => Issue | null,
                            constraints: readonly Constraint[]): Validator<V> {
  return Object.assign(fn, { describe: () => constraints }) as Validator<V>
}

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
    return f(ref.arg)
  }
}

/** Ограничения, о которых рассказали валидаторы поля. Молчуны дают `opaque`. */
/**
 * Ограничения, о которых рассказали валидаторы поля. Молчуны дают `opaque`.
 * @param refs Ссылки правил поля.
 * @param registry Реестр для разрешения имён.
 */
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

const filled = (x: unknown) =>
  x !== null && x !== undefined && x !== '' && x !== false && !(Array.isArray(x) && !x.length)
const len = (x: unknown) => (typeof x === 'string' ? x.length : Array.isArray(x) ? x.length : 0)
const EMAIL_HTML5 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const EMAIL_STRICT = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i

/**
 * Каталог встроенных правил. Каждое — функция с необязательным `describe`:
 * описанное правило проецируется в разметку через словарь видов ограничений,
 * неописанное работает, но атрибута не даёт.
 */
export const v = {
  /** Значение обязано быть. Пустая строка, `null`, `false`, пустой массив — пустота. */
  required: () => describe<unknown>(
    (x) => (filled(x) ? null : issue('required')),
    [{ kind: 'required' }]),

  /**
   * Формат почты.
   * @param mode `'html5'` — как проверяет браузер (проектируется в атрибут),
   *   `'strict'` — строже браузера, атрибута не даёт: разметка не может
   *   обещать мягче сервера.
   */
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

  /** Ссылка. Разбор `new URL` точнее любого шаблона — атрибута не даёт. */
  url: () => describe<string>(
    (x) => {
      if (!filled(x)) return null
      try { new URL(x); return null } catch { return issue('url') }
    },
    [{ kind: 'opaque', why: 'разбор ссылки точнее любого шаблона', safeAsAttr: false }]),

  /** Шаблон задаётся исходником: именованные живут в реестре приложения. */
  pattern: (name: { source: string }) => {
    const source = name.source
    const re = new RegExp(`^(?:${source})$`, 'u')
    return describe<string>(
      (x) => (!filled(x) || re.test(x) ? null : issue('pattern')),
      [{ kind: 'pattern', source }])
  },

  /** @param n Нижняя граница длины строки, включительно. */
  minLength: (n: number) => describe<string>(
    (x) => (!filled(x) || len(x) >= n ? null : issue('minLength', { min: n, actual: len(x) })),
    [{ kind: 'minLength', value: n }]),

  /** @param n Верхняя граница длины строки, включительно. */
  maxLength: (n: number) => describe<string>(
    (x) => (len(x) <= n ? null : issue('maxLength', { max: n, actual: len(x) })),
    [{ kind: 'maxLength', value: n }]),

  /**
   * @param n Нижняя граница величины (число, дата, время).
   * @param exclusive Исключающая граница не проецируется: браузер принял бы
   *   само пограничное значение.
   */
  minValue: (n: number, exclusive = false) => describe<number | null>(
    (x) => {
      if (x === null || x === undefined) return null
      return (exclusive ? x > n : x >= n) ? null : issue('minValue', { min: n })
    },
    // исключающая граница: браузер принял бы само пограничное значение
    [{ kind: 'minMagnitude', value: n, exclusive,
       safeAsAttr: !exclusive, why: exclusive ? 'граница исключающая' : undefined }]),

  /**
   * @param n Верхняя граница величины (число, дата, время).
   * @param exclusive Исключающая граница не проецируется.
   */
  maxValue: (n: number, exclusive = false) => describe<number | null>(
    (x) => {
      if (x === null || x === undefined) return null
      return (exclusive ? x < n : x <= n) ? null : issue('maxValue', { max: n })
    },
    [{ kind: 'maxMagnitude', value: n, exclusive,
       safeAsAttr: !exclusive, why: exclusive ? 'граница исключающая' : undefined }]),

  /** @param value Граница датой ISO `ГГГГ-ММ-ДД`, включительно. */
  minDate: (value: string) => describe<string | null>(
    (x) => (!x || x >= value ? null : issue('minDate', { min: value })),
    [{ kind: 'minMagnitude', value }]),

  /** @param value Граница датой ISO `ГГГГ-ММ-ДД`, включительно. */
  maxDate: (value: string) => describe<string | null>(
    (x) => (!x || x <= value ? null : issue('maxDate', { max: value })),
    [{ kind: 'maxMagnitude', value }]),

  /** @param n Минимум выбранных элементов в много value-поле. */
  minCount: (n: number) => describe<readonly unknown[]>(
    (x) => (x.length >= n ? null : issue('minCount', { min: n, actual: x.length })),
    [{ kind: 'minCount', value: n }]),

  /** @param n Максимум выбранных элементов. */
  maxCount: (n: number) => describe<readonly unknown[]>(
    (x) => (x.length <= n ? null : issue('maxCount', { max: n, actual: x.length })),
    [{ kind: 'maxCount', value: n }]),

  /** Целое число: проецируется как `step=1`. */
  integer: () => describe<number | null>(
    (x) => (x === null || Number.isInteger(x) ? null : issue('integer')),
    [{ kind: 'step', value: 1, unit: 'number' }]),

  /**
   * @param n Шаг величины.
   * @param unit Единица шага: у даты — день, у времени — секунда.
   *   Чужая единица опаснее отсутствия, поэтому не проецируется.
   */
  step: (n: number, unit?: string) => describe<number | null>(
    (x) => (x === null || x % n === 0 ? null : issue('step', { step: n })),
    [{ kind: 'step', value: n, unit }]),

  /** @param values Допустимые значения. Сам список и есть ограничение. */
  oneOf: (values: readonly string[]) => describe<string | null>(
    (x) => (x === null || values.includes(x) ? null : issue('oneOf')),
    [{ kind: 'oneOf', values }]),

  /**
   * Подсказка выбора файлов: MIME с `*` или расширение с точкой.
   * Сервер всё равно смотрит содержимое.
   */
  accept: (types: readonly string[]) => describe<File | null>(
    (f) => {
      if (!f) return null
      const good = types.some((t) => t.startsWith('.')
        ? f.name.toLowerCase().endsWith(t.toLowerCase())
        : new RegExp(`^${t.replace('*', '.*')}$`).test(f.type))
      return good ? null : issue('accept', { types })
    },
    [{ kind: 'accept', types }]),

  /** @param bytes Предел размера файла. Нативного атрибута не существует. */
  maxSize: (bytes: number) => describe<File | null>(
    (f) => (!f || f.size <= bytes ? null : issue('maxSize', { bytes })),
    [{ kind: 'maxSize', bytes }]),

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
  /**
   * Межполевое сравнение: вида ограничения для него нет и быть не может —
   * браузер не умеет сравнивать поля между собой, проверяет сервер.
   * @param field Путь поля-образца.
   */
  sameAs: (field: FieldPath) => describe<unknown>(
    (x, ctx) => (x === ctx.values[field] ? null : issue('sameAs', { field })),
    [opaque('браузер не умеет сравнивать поля между собой')]),
}

/** Встроенные правила — такой же набор, как любой другой. */
export const BUILTIN_VALIDATORS: Record<string, (arg: any) => Validator<any>> = {
  required: () => v.required(),
  email: (a: any) => v.email(a ?? 'html5'),
  url: () => v.url(),
  pattern: (a: any) => v.pattern(a),
  minLength: (a: any) => v.minLength(a),
  maxLength: (a: any) => v.maxLength(a),
  minValue: (a: any) => v.minValue(a),
  maxValue: (a: any) => v.maxValue(a),
  minDate: (a: any) => v.minDate(a),
  maxDate: (a: any) => v.maxDate(a),
  minCount: (a: any) => v.minCount(a),
  maxCount: (a: any) => v.maxCount(a),
  integer: () => v.integer(),
  step: (a: any) => v.step(a),
  oneOf: (a: any) => v.oneOf(a),
  strength: (a: any) => v.strength(a ?? 'good'),
}
