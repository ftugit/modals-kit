// РАСШИРЕНИЕ БИБЛИОТЕКИ КОДОМ ПРИЛОЖЕНИЯ.
// Ни один файл в src/lib/form при этом не меняется.

import { CheckRegistry, check, defaultRegistry, describe, issue, opaque, v } from '#lib/form/index.js'
import type { Constraint, FieldType } from '#lib/form/index.js'
import { phoneLengthOk } from '#components/ui/phone-input/phone.ts'

// Открытые ключи: подсказки среды возвращаются расширением интерфейсов.
declare module '#lib/form/index.js' {
  interface FieldValues { rating: number | null; phone: string }
  interface InputModes { rating: true; phone: true }
}

/** Свой тип значения: оценка от одной до пяти звёзд. */
export const ratingType: FieldType<number | null> = {
  kind: 'rating',
  inputs: ['rating'],
  multiple: false,
  empty: null,
  decode: (entries) => {
    const raw = typeof entries[0] === 'string' ? entries[0].trim() : ''
    if (raw === '') return { ok: true, value: null }
    const n = Number(raw)
    return Number.isInteger(n) ? { ok: true, value: n } : { ok: false, code: 'type.rating', params: { raw } }
  },
  encode: (value, name, out) => { if (value !== null) out.push([name, String(value)]) },
  // применимость и проекция — одной записью, у владельца знания
  constraints: {
    required: () => ({ required: true }),
    minMagnitude: (c) => ({ min: (c as { value: number }).value }),
    maxMagnitude: (c) => ({ max: (c as { value: number }).value }),
    step: (c) => ({ step: (c as { value: number }).value }),
    opaque: true,
  },
  attrs: () => ({ type: 'range', inputmode: 'numeric' }),
  degradation: { withoutJs: 'ползунок от одной до пяти звёзд' },
}

defaultRegistry.registerType(ratingType)

/**
 * Номер как его записывают люди (`+7 (999) 123-45-67`, `0049 30 1234567`) → одна
 * строка `+79991234567`: плюс и цифры. Без кода страны номер не восстановить — `null`.
 * Проверка — длина по стране (`phoneLengthOk`: у +7 ровно 10 цифр после кода, у кода не
 * из списка — 8–15 всего, E.164); существование номера здесь не проверяется. Та же
 * функция работает в живой проверке до отправки и на сервере: недобранный номер — ошибка поля.
 */
export function normalizePhone(raw: string): string | null {
  let s = raw.trim()
  if (s.startsWith('00')) s = `+${s.slice(2)}`
  if (!s.startsWith('+') || /[^\d\s().+-]/.test(s.slice(1)) || s.indexOf('+', 1) !== -1) return null
  const n = `+${s.replace(/\D/g, '')}`
  return /^\+\d{8,15}$/.test(n) && phoneLengthOk(n) ? n : null
}

/**
 * Свой тип: телефон. Значение — одна строка; как его набирать (код отдельно, маска),
 * решает компонент. Без скрипта это обычное `type="tel"` для номера целиком, и сервер
 * приводит его к той же строке.
 */
export const phoneType: FieldType<string> = {
  kind: 'phone',
  inputs: ['phone'],
  multiple: false,
  empty: '',
  decode: (entries) => {
    const raw = typeof entries[0] === 'string' ? entries[0].trim() : ''
    if (raw === '') return { ok: true, value: '' }
    const n = normalizePhone(raw)
    return n ? { ok: true, value: n } : { ok: false, code: 'type.phone', params: { raw } }
  },
  encode: (value, name, out) => { if (value) out.push([name, value]) },
  constraints: {
    required: () => ({ required: true }),
    opaque: true,
  },
  // Шаблон — подсказка браузеру на пути без JS: плюс, цифры, пробелы, скобки, дефисы.
  attrs: () => ({ type: 'tel', inputmode: 'tel', autocomplete: 'tel', pattern: '\\+[0-9 \\(\\)\\-]{8,24}' }),
  degradation: { withoutJs: 'одно поле type="tel": номер целиком с кодом страны' },
}

defaultRegistry.registerType(phoneType)

/* ── свои правила ──────────────────────────────────────────────────── */

/**
 * Правило С ОПИСАНИЕМ: относит себя к виду «формат строки», поэтому тип
 * проецирует его в атрибут и браузер проверит без скрипта.
 */
export const inn = () => describe<string>(
  (x) => (!x || /^(\d{10}|\d{12})$/.test(x) ? null : issue('inn')),
  [{ kind: 'pattern', source: '\\d{10}|\\d{12}' } satisfies Constraint],
)

/**
 * Правило БЕЗ ОПИСАНИЯ: работает в браузере и на сервере, но атрибута
 * не даёт — честно, без догадок. В отчёте видно причину.
 */
export const luhn = () => {
  const fn = (x: string) => {
    if (!x) return null
    const digits = [...x.replace(/\D/g, '')].reverse().map(Number)
    const sum = digits.reduce((acc, dgt, i) => {
      if (i % 2 === 0) return acc + dgt
      const d = dgt * 2
      return acc + (d > 9 ? d - 9 : d)
    }, 0)
    return sum % 10 === 0 ? null : issue('luhn')
  }
  return fn
}

/** То же правило, но объявившее себя непроецируемым явно. */
export const luhnDescribed = () => describe<string>(
  luhn(),
  [opaque('контрольная сумма не выражается ограничением разметки')],
)

defaultRegistry.registerValidator('inn', () => inn())
defaultRegistry.registerValidator('luhn', () => luhn())

/* ── песочница: то же правило в двух вариантах ─────────────────────── */

/** Шестизначный код БЕЗ описания: проверяется, атрибута не даёт. */
export const code6Plain = () => {
  const fn = (x: string) => (!x || /^\d{6}$/.test(x) ? null : issue('code6'))
  return fn
}

/** Он же С ОПИСАНИЕМ: относит себя к виду «формат строки». */
export const code6Described = () => describe<string>(
  code6Plain(),
  [{ kind: 'pattern', source: '\\d{6}' }],
)

/* ── асинхронная проверка ──────────────────────────────────────────── */

/**
 * Реестр асинхронных проверок. На сервере они выполняются ВСЕГДА, в браузере —
 * раньше и с подавлением частых вызовов. Это оптимизация, а не возможность,
 * существующая только при скрипте.
 */
export const checks = new CheckRegistry()

const TAKEN = new Set(['taken@example.com', 'admin@example.com'])

/**
 * Код — `unique`, как у отказа базы по уникальности: у пакета для него есть
 * текст, а свой текст поля задаётся в `messages` поля (`signup.ts`), так что
 * отдельный словарь приложения не нужен (F57).
 */
checks.register('email-taken', async (value) => {
  await new Promise((r) => setTimeout(r, 200))      // как будто обращение к хранилищу
  return TAKEN.has(String(value ?? '').toLowerCase())
    ? issue('unique', { email: value })
    : null
})

/** Валидатор-обёртка: синхронно пропускает, вида ограничения у него нет. */
export const emailTaken = () => check('email-taken', { debounceMs: 250 })

export { v }
