// Сложность пароля.
//
// Шаблон тут не работает принципиально: он проверяет НАЛИЧИЕ символов, а не
// стойкость. `testtest1` шаблон «хотя бы одна цифра» проходит, хотя это
// повторённое словарное слово с цифрой на конце. И наоборот — шаблон легко
// запрещает знаки, которые пароль только усиливают.
//
// Поэтому здесь оценка: сколько примерно битов энтропии в строке с поправкой
// на повторы, последовательности и словарные основы.
//
// Оценка — ЭВРИСТИКА и заменяема: `v.strength(level, { score })`. Ядро не
// притворяется, что знает единственно верную меру стойкости.

export type StrengthLevel = 'weak' | 'fair' | 'good' | 'strong'

/** Почему оценка просела. Приложение может показать это подсказкой. */
export type StrengthNote =
  | 'short'      // слишком коротко
  | 'one-class'  // один набор символов
  | 'repeat'     // строка — повторение куска
  | 'sequence'   // подряд идущие символы: abcdef, 123456
  | 'common'     // известный пароль или словарная основа

export interface Strength {
  readonly bits: number
  readonly level: StrengthLevel
  readonly notes: readonly StrengthNote[]
}

export const LEVEL_ORDER: readonly StrengthLevel[] = ['weak', 'fair', 'good', 'strong']

/** Нижняя граница длины для уровня. Единственное, что выражается в разметке. */
export const LEVEL_MIN_LENGTH: Readonly<Record<StrengthLevel, number>> = {
  weak: 6, fair: 8, good: 10, strong: 12,
}

const COMMON = new Set([
  'password', 'qwerty', 'qwertyui', 'iloveyou', 'admin', 'welcome', 'letmein',
  'dragon', 'monkey', 'master', 'sunshine', 'princess', 'football', 'baseball',
  'пароль', 'йцукен', 'test', 'testtest', 'demo', 'secret', 'changeme',
])

const CLASSES: readonly [RegExp, number][] = [
  [/[a-z]/, 26], [/[A-Z]/, 26], [/[а-яё]/, 33], [/[А-ЯЁ]/, 33],
  [/\d/, 10], [/[^\p{L}\d]/u, 32],
]

function poolSize(value: string): number {
  let pool = 0
  let classes = 0
  for (const [re, size] of CLASSES) if (re.test(value)) { pool += size; classes++ }
  return pool === 0 ? 0 : pool + (classes === 1 ? 0 : 0)
}

function classCount(value: string): number {
  return CLASSES.filter(([re]) => re.test(value)).length
}

/** Наименьший кусок, повторением которого является строка: `testtest` → `test`. */
function period(value: string): number {
  for (let size = 1; size <= value.length >> 1; size++) {
    if (value.length % size !== 0) continue
    const unit = value.slice(0, size)
    if (unit.repeat(value.length / size) === value) return size
  }
  return value.length
}

/** Длина самого длинного подряд идущего отрезка: `abcd`, `4321`, `aaaa`. */
function longestRun(value: string): number {
  let best = 1
  let run = 1
  let step: number | null = null
  for (let i = 1; i < value.length; i++) {
    const delta = value.charCodeAt(i) - value.charCodeAt(i - 1)
    if (Math.abs(delta) <= 1 && (step === null || delta === step)) {
      step = delta
      run++
      best = Math.max(best, run)
    } else {
      step = Math.abs(delta) <= 1 ? delta : null
      run = step === null ? 1 : 2
      best = Math.max(best, run)
    }
  }
  return best
}

/** Основа без цифр и знаков по краям: `testtest1` → `testtest`. */
const baseOf = (value: string) => value.toLowerCase().replace(/^[\d\W_]+|[\d\W_]+$/gu, '')

export function strengthOf(value: string): Strength {
  if (!value) return { bits: 0, level: 'weak', notes: ['short'] }

  const notes: StrengthNote[] = []
  const pool = poolSize(value)
  if (pool === 0) return { bits: 0, level: 'weak', notes: ['short'] }
  if (classCount(value) === 1) notes.push('one-class')

  // Повтор куска: `testtest` стоит немногим больше, чем `test`.
  const unit = period(value)
  const repeats = value.length / unit
  const byPeriod = repeats > 1 ? unit + Math.log2(repeats) : value.length
  if (repeats > 1) notes.push('repeat')

  // Разнообразие: девять символов из четырёх разных — это не девять символов.
  const distinct = new Set(value).size
  const byDistinct = distinct + (value.length - distinct) * 0.5

  // Подряд идущие символы перебираются первыми.
  const run = longestRun(value)
  if (run >= 4) notes.push('sequence')

  const effective = Math.max(1, Math.min(byPeriod, byDistinct) - Math.max(0, run - 3))
  let bits = effective * Math.log2(pool)

  const base = baseOf(value)
  if (COMMON.has(base) || COMMON.has(value.toLowerCase())) {
    notes.push('common')
    bits = Math.min(bits, 12)
  }
  if (value.length < 8) notes.push('short')

  const level: StrengthLevel =
    bits < 28 ? 'weak' : bits < 40 ? 'fair' : bits < 60 ? 'good' : 'strong'

  return { bits: Math.round(bits), level, notes }
}

export const meetsLevel = (got: StrengthLevel, need: StrengthLevel) =>
  LEVEL_ORDER.indexOf(got) >= LEVEL_ORDER.indexOf(need)
