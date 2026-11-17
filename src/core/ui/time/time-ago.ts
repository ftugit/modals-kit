/**
 * Читаемое время: относительное («5 минут назад»), но не старше месяца —
 * дальше абсолютная дата. Чистая функция: тестируется без браузера и без
 * реактивности; компонент `TimeAgo` только подставляет «сейчас» и пояс.
 */

export interface TimeAgoOptions {
  /** Момент «сейчас», мс epoch. По умолчанию — текущее время. */
  now?: number
  /** IANA-пояс для абсолютной даты (`Europe/Moscow`). Не задан — системный. */
  timeZone?: string
  /** Локаль формата. По умолчанию `ru-RU` — язык интерфейса кита. */
  locale?: string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
/** Относительный предел: 30 дней. Старше — абсолютная дата. */
const RELATIVE_LIMIT = 30 * DAY

type PluralForms = readonly [one: string, few: string, many: string]

/** Русское склонение: 1 минуту, 3 минуты, 5 минут (11–14 — всегда «минут»). */
function plural(n: number, forms: PluralForms): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return forms[0]
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1]
  return forms[2]
}

function toMs(value: number | string | Date): number {
  if (value instanceof Date) return value.getTime()
  return typeof value === 'string' ? Date.parse(value) : value
}

/** Абсолютная дата с временем — формат старше месяца и подсказка `title`. */
export function formatAbsoluteTime(
  value: number | string | Date,
  opts: { timeZone?: string; locale?: string } = {},
): string {
  const t = toMs(value)
  if (!Number.isFinite(t)) return '—'
  return new Intl.DateTimeFormat(opts.locale ?? 'ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.timeZone ? { timeZone: opts.timeZone } : {}),
  }).format(t)
}

/**
 * «только что» / «N минут назад» / «N часов назад» / «N дней назад» —
 * до 30 дней; старше или заметно в будущем — абсолютная дата.
 */
export function formatTimeAgo(value: number | string | Date, opts: TimeAgoOptions = {}): string {
  const t = toMs(value)
  if (!Number.isFinite(t)) return '—'
  const now = opts.now ?? Date.now()
  const diff = now - t
  if (diff < 0 && -diff >= MIN) return formatAbsoluteTime(t, opts)
  if (diff < MIN) return 'только что'
  if (diff < HOUR) {
    const n = Math.floor(diff / MIN)
    return `${n} ${plural(n, ['минуту', 'минуты', 'минут'])} назад`
  }
  if (diff < DAY) {
    const n = Math.floor(diff / HOUR)
    return `${n} ${plural(n, ['час', 'часа', 'часов'])} назад`
  }
  if (diff < RELATIVE_LIMIT) {
    const n = Math.floor(diff / DAY)
    return `${n} ${plural(n, ['день', 'дня', 'дней'])} назад`
  }
  return formatAbsoluteTime(t, opts)
}
