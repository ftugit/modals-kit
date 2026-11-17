/**
 * Имена узлов «Диска» (`plan-drive.md` §4.2, инвариант 3).
 *
 * Одно правило для UI, WebDAV и БД: имя — NFC-нормализованная строка без
 * ведущих/хвостовых пробелов, длиной 1…255 кодовых точек. Внутри нет `/`,
 * `\` и управляющих символов, нет `.`/`..` и имён устройств Windows.
 *
 * `driveNameKey` — то, по чему сравнивается уникальность в папке. В БД это
 * `lower(name)` поверх уже нормализованного имени; нормализацию выполняет
 * домен, иначе `NFC`/`NFD`-двойники проходили бы мимо уникального индекса.
 */

/** Предел имени в кодовых точках (не в байтах: кириллица занимает 2 байта). */
export const DRIVE_NAME_MAX = 255

/** Почему имя не принято. Тексты — в `modules/drive/messages.ts`, не здесь. */
export type DriveNameProblem = 'empty' | 'too-long' | 'forbidden-char' | 'dot' | 'reserved'

export class DriveNameError extends Error {
  readonly code: DriveNameProblem

  constructor(code: DriveNameProblem) {
    super(`[drive] недопустимое имя: ${code}`)
    this.name = 'DriveNameError'
    this.code = code
  }
}

const CONTROL_RE = /[\u0000-\u001f\u007f]/

/** Имена устройств DOS/Windows: `CON`, `con.txt`, `LPT9.tar.gz` и т. п. */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
])

/** Привести имя к канонической форме. Не проверяет допустимость. */
export function normalizeDriveName(raw: string): string {
  return raw.normalize('NFC').trim()
}

/** Проверить имя. `null` — допустимо; иначе причина отказа. */
export function checkDriveName(raw: string): DriveNameProblem | null {
  if (typeof raw !== 'string') return 'empty'
  const name = normalizeDriveName(raw)
  if (!name) return 'empty'
  if ([...name].length > DRIVE_NAME_MAX) return 'too-long'
  if (name === '.' || name === '..') return 'dot'
  if (CONTROL_RE.test(name) || name.includes('/') || name.includes('\\')) return 'forbidden-char'
  const base = name.split('.')[0]!.toUpperCase()
  if (RESERVED_NAMES.has(base)) return 'reserved'
  return null
}

/** Каноническое имя или `DriveNameError` с кодом причины. */
export function assertDriveName(raw: string): string {
  const problem = checkDriveName(raw)
  if (problem) throw new DriveNameError(problem)
  return normalizeDriveName(raw)
}

/**
 * Ключ уникальности имени в папке: регистронезависимый (`Report.PDF` и
 * `report.pdf` — один ключ). Сравнение по коду единиц, не `localeCompare`:
 * иначе выдача зависела бы от локали инстанса.
 */
export function driveNameKey(name: string): string {
  return normalizeDriveName(name).toLowerCase()
}
