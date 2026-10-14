// Разбор и показ телефонного номера для `PhoneInput`. Чистые функции без фреймворка.
//
// Значение поля — ОДНА строка в международном виде (как E.164): `+79991234567`.
// Код страны и национальная часть — только способ ввода: на сервер уходит склейка.
// Проверку «номер существует» здесь не делаем (это libphonenumber и его метаданные,
// сотни килобайт). Проверяем длину: у страны из списка — длина национальной части
// обычного и мобильного номера (сверено с метаданными libphonenumber, типы fixed_line и
// mobile; служебные номера вроде 8-800 с 14 цифрами сюда не входят), у остальных — E.164.

export interface PhoneCountry {
  /** Код страны с плюсом: `+7`. */
  readonly code: string
  /** Подпись в списке: `Россия, Казахстан`. */
  readonly label: string
  /** Группы национальной части (`[3, 3, 2, 2]` → `999 123-45-67`); без маски — тройки до предела. */
  readonly mask?: readonly number[]
  /** Наименьшая длина национальной части; по умолчанию — сумма маски (длина ровно одна). */
  readonly min?: number
  /** Наибольшая; по умолчанию — сумма маски, без неё — остаток до 15 цифр E.164. */
  readonly max?: number
  /** Префикс внутри страны (`8` у +7, `0` у многих): отбрасывается, если с ним цифр на одну больше предела. */
  readonly trunk?: string
}

/** Список по умолчанию; у поля его можно заменить своим (`countries`). */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: '+7', label: 'Россия, Казахстан', mask: [3, 3, 2, 2], trunk: '8' },
  { code: '+375', label: 'Беларусь', mask: [2, 3, 2, 2] },
  { code: '+374', label: 'Армения', mask: [2, 3, 3], trunk: '0' },
  { code: '+994', label: 'Азербайджан', mask: [2, 3, 2, 2], trunk: '0' },
  { code: '+995', label: 'Грузия', mask: [3, 2, 2, 2], trunk: '0' },
  { code: '+996', label: 'Киргизия', mask: [3, 3, 3], trunk: '0' },
  { code: '+998', label: 'Узбекистан', mask: [2, 3, 2, 2] },
  { code: '+358', label: 'Финляндия', min: 5, max: 10, trunk: '0' },
  // по метаданным до 15, но E.164 — не больше 15 цифр вместе с кодом: 13
  { code: '+49', label: 'Германия', min: 5, trunk: '0' },
  { code: '+90', label: 'Турция', mask: [3, 3, 2, 2], trunk: '0' },
  { code: '+1', label: 'США, Канада', mask: [3, 3, 4], trunk: '1' },
  // Код не из списка: плюс уже в поле, код страны набирается в начале номера.
  // Без этой строки номер с незнакомым кодом (из ответа сервера, из вставки) пропал бы.
  { code: '+', label: 'Другая страна: код в начале номера' },
]

/** Всего цифр в номере по E.164 — с кодом страны. */
const E164_MAX = 15
/** Меньше восьми цифр вместе с кодом — не номер ни в одной стране (для кода не из списка). */
const E164_MIN = 8

const digitsOf = (s: string) => s.replace(/\D/g, '')

const maskSum = (country: PhoneCountry) => country.mask?.reduce((a, b) => a + b, 0)

/** Предел цифр национальной части: `max`, сумма маски или остаток до 15. */
export function nationalMax(country: PhoneCountry): number {
  return Math.min(country.max ?? maskSum(country) ?? E164_MAX, E164_MAX - digitsOf(country.code).length)
}

/** Наименьшая длина национальной части: `min`, сумма маски или 1. */
export const nationalMin = (country: PhoneCountry): number => country.min ?? maskSum(country) ?? 1

/** Страна по номеру — самое длинное совпадение кода; строку «+» не выбирает. */
const countryOf = (digits: string, countries: readonly PhoneCountry[]) =>
  [...countries]
    .filter((c) => digitsOf(c.code))
    .sort((a, b) => b.code.length - a.code.length)
    .find((c) => digits.startsWith(digitsOf(c.code)))

/**
 * Длина номера в значении поля (`+79991234567`) подходит стране: `+7 999 123` — нет,
 * `+7 999 123-45-67` — да. Код не из списка — только рамка E.164 (8–15 цифр с кодом).
 */
export function phoneLengthOk(value: string, countries: readonly PhoneCountry[] = PHONE_COUNTRIES): boolean {
  const all = digitsOf(value)
  const country = countryOf(all, countries)
  if (!country) return all.length >= E164_MIN && all.length <= E164_MAX
  const national = all.length - digitsOf(country.code).length
  return national >= nationalMin(country) && national <= nationalMax(country)
}

/** Группы для показа: `9991234567` → `999 123-45-67`; без маски — `123 456 789`. */
export function formatNational(digits: string, country: PhoneCountry): string {
  const sizes = country.mask ?? Array.from({ length: Math.ceil(digits.length / 3) }, () => 3)
  const parts: string[] = []
  let rest = digits
  for (const size of sizes) {
    if (!rest) break
    parts.push(rest.slice(0, size))
    rest = rest.slice(size)
  }
  if (rest) parts.push(rest)
  if (!country.mask) return parts.join(' ')
  return parts.length <= 1 ? parts.join('') : `${parts[0]} ${parts.slice(1).join('-')}`
}

/** Заполнитель по маске: `000 000-00-00`. */
export const placeholderFor = (country: PhoneCountry) => formatNational('0'.repeat(nationalMax(country)), country)

/**
 * Набранное в национальной части → только цифры в пределе страны. Лишняя первая
 * цифра, равная префиксу страны, отбрасывается (`8 999 123-45-67` у +7): на пределе
 * это однозначно, а в середине ввода `8` может быть началом кода города (812). Так же на
 * пределе снимается код страны без плюса — его подставляет автозаполнение.
 */
export function cleanNational(typed: string, country: PhoneCountry): string {
  let d = digitsOf(typed)
  const max = nationalMax(country)
  // автозаполнение браузера даёт номер с кодом, но без плюса: 79991234567
  const code = digitsOf(country.code)
  if (code && d.length === max + code.length && d.startsWith(code)) d = d.slice(code.length)
  else if (country.trunk && d.length === max + country.trunk.length && d.startsWith(country.trunk))
    d = d.slice(country.trunk.length)
  return d.slice(0, max)
}

/** Склейка в значение поля; пустая национальная часть — пустое значение. */
export const joinPhone = (code: string, national: string) => (national ? `${code}${national}` : '')

/**
 * Номер целиком (`+7 (999) 123-45-67`, `0049…`, `+79991234567`) → код из списка и
 * национальная часть. Код ищется самым длинным совпадением. Номер без `+` и `00`
 * считается национальным для `fallback`.
 */
export function splitPhone(
  raw: string,
  countries: readonly PhoneCountry[],
  fallback: PhoneCountry,
): { country: PhoneCountry; national: string } {
  const s = raw.trim()
  const international = s.startsWith('+') || s.startsWith('00')
  if (!international) return { country: fallback, national: cleanNational(s, fallback) }
  const all = digitsOf(s.startsWith('00') ? s.slice(2) : s)
  const match = countryOf(all, countries) ?? countries.find((c) => !digitsOf(c.code))
  // без строки «+» в своём списке незнакомый код не на что положить
  if (!match) return { country: fallback, national: '' }
  return { country: match, national: all.slice(digitsOf(match.code).length).slice(0, nationalMax(match)) }
}
