/**
 * Сортировка и курсор среза «Диска» (`plan-drive.md` §4.3).
 *
 * Курсор — base64url от JSON `{ v, s, d, l, i }`: версия, ключ сортировки,
 * направление, последнее значение и id последней строки. Id в курсоре нужен
 * всегда: без него две строки с одинаковым размером/временем терялись бы на
 * границе порции. Подпись не ставится — это не секрет и не право доступа,
 * а позиция в списке; мусор и чужие версии просто отклоняются.
 */
import { driveNameKey } from './names.js'
import type { DriveEntry, DriveSort, DriveSortDirection } from './types.js'

/** Разрешённые ключи сортировки. */
export const DRIVE_SORTS: readonly DriveSort[] = ['name', 'updated', 'size']

/** Верхний предел токена: длиннее — уже не наш курсор. */
export const DRIVE_CURSOR_MAX = 4096

export interface DriveCursor {
  readonly sort: DriveSort
  readonly direction: DriveSortDirection
  /** Значение ключа последней выданной строки. */
  readonly last: string | number
  /** Id последней выданной строки — разрешает ничьи на границе. */
  readonly id: string
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function fromBase64Url(token: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (token.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

/** Значение ключа сортировки строки: имя — регистронезависимый ключ. */
export function driveSortValue(entry: DriveEntry, sort: DriveSort): string | number {
  if (sort === 'name') return driveNameKey(entry.node.name)
  if (sort === 'updated') return entry.node.updatedAt.getTime()
  return entry.node.size
}

function isSort(value: unknown): value is DriveSort {
  return typeof value === 'string' && (DRIVE_SORTS as readonly string[]).includes(value)
}

function isDirection(value: unknown): value is DriveSortDirection {
  return value === 'asc' || value === 'desc'
}

/** Курсор следующей порции по последней строке текущей. */
export function driveCursorFor(
  entry: DriveEntry,
  sort: DriveSort,
  direction: DriveSortDirection,
): DriveCursor {
  return {
    sort,
    direction,
    last: driveSortValue(entry, sort),
    id: entry.node.id,
  }
}

export function encodeDriveCursor(cursor: DriveCursor): string {
  return toBase64Url(
    JSON.stringify({
      v: 1,
      s: cursor.sort,
      d: cursor.direction,
      l: cursor.last,
      i: cursor.id,
    }),
  )
}

/** Разобрать курсор. Любое расхождение (версия, тип значения, мусор) — `null`. */
export function decodeDriveCursor(raw: string | null | undefined): DriveCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > DRIVE_CURSOR_MAX) return null
  const json = fromBase64Url(raw)
  if (json === null) return null
  let payload: unknown
  try {
    payload = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null
  const { v, s, d, l, i } = payload as Record<string, unknown>
  if (v !== 1 || !isSort(s) || !isDirection(d)) return null
  if (typeof i !== 'string' || i.length === 0) return null
  const lastOk =
    s === 'name' ? typeof l === 'string' : typeof l === 'number' && Number.isFinite(l)
  if (!lastOk) return null
  return { sort: s, direction: d, last: l as string | number, id: i }
}

function compareRaw(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0
  const left = String(a)
  const right = String(b)
  return left < right ? -1 : left > right ? 1 : 0
}

/**
 * Компаратор строк среза. Ключ направления действует только на основное
 * значение; ничьи всегда разрешаются по id по возрастанию — иначе страницы
 * могли бы повторять и пропускать строки.
 */
export function compareDriveEntries(
  a: DriveEntry,
  b: DriveEntry,
  sort: DriveSort,
  direction: DriveSortDirection,
): number {
  const cmp = compareRaw(driveSortValue(a, sort), driveSortValue(b, sort))
  const primary = direction === 'desc' ? -cmp : cmp
  if (primary !== 0) return primary
  return a.node.id < b.node.id ? -1 : a.node.id > b.node.id ? 1 : 0
}

/** Строка идёт строго после позиции курсора — она попадёт в следующую порцию. */
export function isAfterDriveCursor(entry: DriveEntry, cursor: DriveCursor): boolean {
  const cmp = compareRaw(driveSortValue(entry, cursor.sort), cursor.last)
  const primary = cursor.direction === 'desc' ? -cmp : cmp
  if (primary !== 0) return primary > 0
  return entry.node.id > cursor.id
}
