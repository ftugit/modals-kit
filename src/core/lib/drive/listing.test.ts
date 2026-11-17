import { describe, expect, it } from 'vitest'
import type { DriveEntry } from './types.js'
import {
  DRIVE_SORTS,
  compareDriveEntries,
  decodeDriveCursor,
  driveCursorFor,
  driveSortValue,
  encodeDriveCursor,
  isAfterDriveCursor,
} from './listing.js'

function entry(
  id: string,
  name: string,
  options: { size?: number; updated?: Date; kind?: 'file' | 'folder' } = {},
): DriveEntry {
  const kind = options.kind ?? 'file'
  return {
    node: {
      id,
      ownerId: 'o1',
      parentId: null,
      kind,
      name,
      fileId: kind === 'file' ? `drive/o1/${id}` : null,
      size: options.size ?? 0,
      contentType: null,
      hash: null,
      starred: false,
      trashedAt: null,
      trashedFrom: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: options.updated ?? new Date('2026-01-01T00:00:00Z'),
    },
    caps: { canRead: true, canWrite: true, canShare: false },
  }
}

const token = (payload: unknown): string =>
  Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')

describe('сортировка и курсор «Диска»', () => {
  it('объявляет три ключа сортировки', () => {
    expect(DRIVE_SORTS).toEqual(['name', 'updated', 'size'])
  })

  it('значение имени — регистронезависимый ключ', () => {
    expect(driveSortValue(entry('a', 'Report.PDF'), 'name')).toBe('report.pdf')
    expect(driveSortValue(entry('a', 'x', { size: 7 }), 'size')).toBe(7)
    expect(driveSortValue(entry('a', 'x', { updated: new Date(1000) }), 'updated')).toBe(1000)
  })

  it('переживает круг кодирования, включая кириллицу', () => {
    const cursor = { sort: 'name' as const, direction: 'asc' as const, last: 'отчёт', id: 'a' }
    expect(decodeDriveCursor(encodeDriveCursor(cursor))).toEqual(cursor)
    const updated = {
      sort: 'updated' as const,
      direction: 'desc' as const,
      last: 1_700_000_000_000,
      id: 'b',
    }
    expect(decodeDriveCursor(encodeDriveCursor(updated))).toEqual(updated)
  })

  it('строит курсор по последней строке', () => {
    const cursor = driveCursorFor(entry('a', 'Отчёт', { size: 3 }), 'name', 'asc')
    expect(cursor).toEqual({ sort: 'name', direction: 'asc', last: 'отчёт', id: 'a' })
  })

  it('отклоняет мусор и чужие версии', () => {
    expect(decodeDriveCursor(null)).toBeNull()
    expect(decodeDriveCursor('')).toBeNull()
    expect(decodeDriveCursor('%%%')).toBeNull()
    expect(decodeDriveCursor('a'.repeat(5000))).toBeNull()
    expect(decodeDriveCursor(token({ v: 2, s: 'name', d: 'asc', l: 'a', i: 'a' }))).toBeNull()
    expect(decodeDriveCursor(token({ v: 1, s: 'date', d: 'asc', l: 'a', i: 'a' }))).toBeNull()
    expect(decodeDriveCursor(token({ v: 1, s: 'name', d: 'up', l: 'a', i: 'a' }))).toBeNull()
    expect(decodeDriveCursor(token({ v: 1, s: 'name', d: 'asc', l: 3, i: 'a' }))).toBeNull()
    expect(decodeDriveCursor(token({ v: 1, s: 'size', d: 'asc', l: '3', i: 'a' }))).toBeNull()
    expect(decodeDriveCursor(token({ v: 1, s: 'name', d: 'asc', l: 'a', i: '' }))).toBeNull()
    expect(decodeDriveCursor(token([1, 2, 3]))).toBeNull()
  })

  it('сортирует по имени без учёта регистра и разрешает ничьи по id', () => {
    expect(compareDriveEntries(entry('a', 'Alpha'), entry('b', 'beta'), 'name', 'asc')).toBe(-1)
    expect(compareDriveEntries(entry('a', 'Alpha'), entry('b', 'beta'), 'name', 'desc')).toBe(1)
    expect(compareDriveEntries(entry('a', 'same'), entry('b', 'SAME'), 'name', 'asc')).toBe(-1)
    expect(compareDriveEntries(entry('b', 'same'), entry('a', 'SAME'), 'name', 'desc')).toBe(1)
  })

  it('сортирует по размеру и времени', () => {
    expect(compareDriveEntries(entry('a', 'a', { size: 10 }), entry('b', 'b', { size: 2 }), 'size', 'asc')).toBe(1)
    expect(
      compareDriveEntries(
        entry('a', 'a', { updated: new Date(1000) }),
        entry('b', 'b', { updated: new Date(2000) }),
        'updated',
        'desc',
      ),
    ).toBe(1)
  })

  it('продолжает порцию строго после курсора', () => {
    const a = entry('a', 'a', { size: 1 })
    const b = entry('b', 'b', { size: 2 })
    const cursor = driveCursorFor(a, 'size', 'asc')
    expect(isAfterDriveCursor(a, cursor)).toBe(false)
    expect(isAfterDriveCursor(b, cursor)).toBe(true)
  })

  it('не теряет одинаковые значения на границе', () => {
    const a = entry('a', 'one', { size: 5 })
    const b = entry('b', 'two', { size: 5 })
    const cursor = driveCursorFor(a, 'size', 'asc')
    expect(isAfterDriveCursor(b, cursor)).toBe(true)
    expect(isAfterDriveCursor(a, cursor)).toBe(false)
  })

  it('по убыванию следующая порция — меньшие значения', () => {
    const cursor = { sort: 'size' as const, direction: 'desc' as const, last: 3, id: 'c' }
    expect(isAfterDriveCursor(entry('b', 'b', { size: 2 }), cursor)).toBe(true)
    expect(isAfterDriveCursor(entry('d', 'd', { size: 4 }), cursor)).toBe(false)
  })
})
