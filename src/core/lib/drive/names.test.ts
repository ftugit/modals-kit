import { describe, expect, it } from 'vitest'
import {
  DRIVE_NAME_MAX,
  DriveNameError,
  assertDriveName,
  checkDriveName,
  driveNameKey,
  normalizeDriveName,
} from './names.js'

describe('имена «Диска»', () => {
  it('нормализует Unicode и обрезает пробелы', () => {
    expect(normalizeDriveName('  Отчёт.pdf ')).toBe('Отчёт.pdf')
    expect(normalizeDriveName('e\u0301')).toBe('\u00e9')
  })

  it('принимает обычные имена', () => {
    expect(checkDriveName('Документ 2026.docx')).toBeNull()
    expect(checkDriveName('a')).toBeNull()
    expect(checkDriveName('archive.tar.gz')).toBeNull()
    expect(checkDriveName('console.txt')).toBeNull()
  })

  it('считает длину в кодовых точках, а не в UTF-16', () => {
    expect(checkDriveName('a'.repeat(DRIVE_NAME_MAX))).toBeNull()
    expect(checkDriveName('a'.repeat(DRIVE_NAME_MAX + 1))).toBe('too-long')
    expect(checkDriveName('😀'.repeat(DRIVE_NAME_MAX))).toBeNull()
  })

  it('отклоняет пустое имя и точки', () => {
    expect(checkDriveName('')).toBe('empty')
    expect(checkDriveName('   ')).toBe('empty')
    expect(checkDriveName('.')).toBe('dot')
    expect(checkDriveName('..')).toBe('dot')
  })

  it('отклоняет разделители и управляющие символы', () => {
    expect(checkDriveName('a/b')).toBe('forbidden-char')
    expect(checkDriveName('a\\b')).toBe('forbidden-char')
    expect(checkDriveName('a\u0000b')).toBe('forbidden-char')
    expect(checkDriveName('a\nb')).toBe('forbidden-char')
    expect(checkDriveName('a\u007fb')).toBe('forbidden-char')
  })

  it('отклоняет имена устройств Windows с любым расширением', () => {
    expect(checkDriveName('CON')).toBe('reserved')
    expect(checkDriveName('con.txt')).toBe('reserved')
    expect(checkDriveName('LPT9.tar.gz')).toBe('reserved')
  })

  it('assert возвращает нормализованное имя', () => {
    expect(assertDriveName('  report.pdf  ')).toBe('report.pdf')
  })

  it('assert бросает DriveNameError с кодом причины', () => {
    try {
      assertDriveName('nul')
      throw new Error('ожидался DriveNameError')
    } catch (error) {
      expect(error).toBeInstanceOf(DriveNameError)
      expect((error as DriveNameError).code).toBe('reserved')
    }
  })

  it('ключ не зависит от регистра и формы Unicode', () => {
    expect(driveNameKey('Report.PDF')).toBe('report.pdf')
    expect(driveNameKey('e\u0301')).toBe(driveNameKey('\u00e9'))
  })
})
