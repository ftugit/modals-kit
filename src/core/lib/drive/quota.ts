/**
 * Квота «Диска» (`plan-drive.md` §4.2, инвариант 4).
 *
 * Считается по логическому размеру живых файлов: дедупликация экономит байты
 * на сервере, но не лимит пользователя. Квота — предел домена, а не ledger
 * хранилища: `storage.put` резервирует ёмкость сервера, и это другой лимит.
 */
import type { DriveQuotaView } from './types.js'

/** Умолчание, если приложение не передало своё (`DRIVE_QUOTA_BYTES`). */
export const DEFAULT_DRIVE_QUOTA_BYTES = 5 * 1024 ** 3

/** Почему загрузка не проходит квоту. */
export type DriveQuotaProblem = 'invalid' | 'over'

export class DriveQuotaError extends Error {
  readonly code: DriveQuotaProblem
  readonly used: number
  readonly limit: number
  readonly needed: number

  constructor(problem: DriveQuotaProblem, used: number, limit: number, needed: number) {
    super(`[drive] квота: ${problem}`)
    this.name = 'DriveQuotaError'
    this.code = problem
    this.used = used
    this.limit = limit
    this.needed = needed
  }
}

const validAmount = (value: number): boolean =>
  Number.isFinite(value) && value >= 0

/** Остаток квоты; отрицательным не бывает (уже занятое не «возвращается»). */
export function remainingQuota(used: number, limit: number): number {
  if (!validAmount(used) || !validAmount(limit)) return 0
  return Math.max(0, limit - used)
}

/** Представление квоты для UI (`DriveQuota`/`Stat`). */
export function driveQuota(used: number, limit: number): DriveQuotaView {
  const safeUsed = validAmount(used) ? used : 0
  const safeLimit = validAmount(limit) ? limit : 0
  return { used: safeUsed, limit: safeLimit, remaining: remainingQuota(safeUsed, safeLimit) }
}

/** Проверка «ещё влезает один файл размера `size`». */
export function checkQuota(used: number, size: number, limit: number): DriveQuotaProblem | null {
  if (!validAmount(used) || !validAmount(size) || !validAmount(limit)) return 'invalid'
  return used + size > limit ? 'over' : null
}

/** Бросить `DriveQuotaError`, если файл не влезает. */
export function assertQuota(used: number, size: number, limit: number): void {
  const problem = checkQuota(used, size, limit)
  if (problem) throw new DriveQuotaError(problem, used, limit, size)
}

const UNITS = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ', 'ПБ'] as const

/**
 * Размер для человека: `1536` → `1,5 КБ`, `1024 ** 3` → `1 ГБ`.
 * Один десятичный знак, запятая как в русском интерфейсе. Отрицательное и
 * `NaN` показываются как `0 Б`, а не как `NaN Б`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 Б'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10
  const text = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(1).replace('.', ',')
  return `${text} ${UNITS[unit]}`
}
