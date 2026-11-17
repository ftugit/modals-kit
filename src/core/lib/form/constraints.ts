// Словарь абстрактных ограничений — посредник между правилом и типом значения.
//
// Правило не говорит «я minLength для строки». Оно говорит, к какому ВИДУ
// ограничения относится: нижняя граница длины, набор допустимых значений,
// формат. Тип значения говорит, какие виды умеет превратить в разметку.
//
// Так исчезает центральная таблица «правило × тип»: ни одна сторона не обязана
// знать другую, а новое правило или новый тип добавляются регистрацией.
//
// Цена: словарь видов — общее место. Технически он открыт, но договариваться
// о смысле нового вида приходится людям. Правила, которым вида нет, честно
// получают `opaque`: они работают, но атрибута не дают.

/** Виды ограничений. Расширяется потребителем так же, как типы значения. */
export interface Constraints {
  /** Значение обязано быть. */
  required: { }
  /** Нижняя и верхняя границы ДЛИНЫ строки. */
  minLength: { value: number }
  maxLength: { value: number }
  /** Границы ВЕЛИЧИНЫ: число, дата, время. */
  minMagnitude: { value: number | string; exclusive?: boolean }
  maxMagnitude: { value: number | string; exclusive?: boolean }
  /** Границы КОЛИЧЕСТВА элементов. */
  minCount: { value: number }
  maxCount: { value: number }
  /** Предел РАЗМЕРА в байтах. */
  maxSize: { bytes: number }
  /** Шаг величины. Единица важна: у даты это дни, у времени секунды. */
  step: { value: number; unit?: string }
  /** Формат строки. */
  pattern: { source: string }
  /** Набор допустимых значений. */
  oneOf: { values: readonly string[] }
  /** Допустимые виды файлов. */
  accept: { types: readonly string[] }
  /**
   * Вида нет. Правило работает, но в разметку не проецируется:
   * межполевые сравнения, асинхронные проверки, внешние схемы.
   */
  opaque: { why: string }
}

/** Ключ вида ограничения. */
export type ConstraintKind = (keyof Constraints & string) | (string & {})

/** Данные ограничения, которые валидатор сообщает типу поля. */
export type Constraint<K extends keyof Constraints = keyof Constraints> = {
  kind: K | (string & {})
  /**
   * Может ли вид стать ограничением разметки. Решает ПРАВИЛО, потому что только
   * оно знает про свои оговорки: строгий формат, исключающая граница, условность.
   */
  safeAsAttr?: boolean
  /** Почему нельзя, если нельзя. Попадает в отчёт. */
  why?: string
} & Constraints[K]

/** Пары границ одной величины — для поиска противоречий в описании. */
export const BOUND_PAIRS: readonly (readonly [ConstraintKind, ConstraintKind])[] = [
  ['minLength', 'maxLength'],
  ['minMagnitude', 'maxMagnitude'],
  ['minCount', 'maxCount'],
]

/** Создаёт ограничение, которое намеренно не проецируется в HTML. */
export const opaque = (why: string): Constraint<'opaque'> =>
  ({ kind: 'opaque', why, safeAsAttr: false })

/** Числовое представление границы — даты сравниваются как строки ISO. */
export function boundValue(c: Constraint): number | undefined {
  const v = (c as { value?: unknown }).value ?? (c as { bytes?: unknown }).bytes
  if (typeof v === 'number') return v
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? undefined : t }
  return undefined
}
