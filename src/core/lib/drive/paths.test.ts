import { describe, expect, it } from 'vitest'
import { DriveNameError } from './names.js'
import { driveBreadcrumbs, driveJoin, driveStoragePath } from './paths.js'

describe('пути «Диска»', () => {
  it('строит логический путь байтов', () => {
    expect(driveStoragePath('owner-1', 'node-1')).toBe('drive/owner-1/node-1')
    expect(
      driveStoragePath('3f1c2d4e-0000-4000-8000-000000000000', '9a8b7c6d-0000-4000-8000-000000000000'),
    ).toBe('drive/3f1c2d4e-0000-4000-8000-000000000000/9a8b7c6d-0000-4000-8000-000000000000')
  })

  it('не пропускает сегменты с точками и слэшами', () => {
    expect(() => driveStoragePath('../x', 'node')).toThrow(RangeError)
    expect(() => driveStoragePath('owner', 'a/b')).toThrow(RangeError)
    expect(() => driveStoragePath('', 'node')).toThrow(RangeError)
    expect(() => driveStoragePath('owner', 'node\n')).toThrow(RangeError)
  })

  it('собирает путь отображения без двойных слэшей', () => {
    expect(driveJoin(null, ' a ')).toBe('a')
    expect(driveJoin('/a/', 'b')).toBe('/a/b')
    expect(driveJoin('/a', 'Отчёт.pdf')).toBe('/a/Отчёт.pdf')
  })

  it('не даёт собрать путь с недопустимым именем', () => {
    expect(() => driveJoin('/a', 'x/y')).toThrow(DriveNameError)
    expect(() => driveJoin('/a', '..')).toThrow(DriveNameError)
  })

  it('сохраняет порядок крошек и отбрасывает дубли', () => {
    expect(
      driveBreadcrumbs([
        { id: 'root', name: 'Диск' },
        { id: 'a', name: 'Отчёты' },
        { id: 'a', name: 'Отчёты' },
        { id: 'b', name: '2026' },
      ]),
    ).toEqual([
      { id: 'root', name: 'Диск' },
      { id: 'a', name: 'Отчёты' },
      { id: 'b', name: '2026' },
    ])
  })
})
