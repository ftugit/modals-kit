import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DRIVE_QUOTA_BYTES,
  DriveQuotaError,
  assertQuota,
  checkQuota,
  driveQuota,
  formatBytes,
  remainingQuota,
} from './quota.js'

describe('квота «Диска»', () => {
  it('считает остаток и не уходит в минус', () => {
    expect(remainingQuota(5, 10)).toBe(5)
    expect(remainingQuota(10, 10)).toBe(0)
    expect(remainingQuota(20, 10)).toBe(0)
    expect(remainingQuota(Number.NaN, 10)).toBe(0)
  })

  it('отдаёт представление для UI', () => {
    expect(driveQuota(3, 10)).toEqual({ used: 3, limit: 10, remaining: 7 })
    expect(driveQuota(-1, 10)).toEqual({ used: 0, limit: 10, remaining: 10 })
  })

  it('проверяет влезает ли файл', () => {
    expect(checkQuota(0, 10, 10)).toBeNull()
    expect(checkQuota(5, 5, 10)).toBeNull()
    expect(checkQuota(5, 6, 10)).toBe('over')
    expect(checkQuota(-1, 6, 10)).toBe('invalid')
    expect(checkQuota(1, 6, Number.POSITIVE_INFINITY)).toBe('invalid')
  })

  it('assert бросает DriveQuotaError с цифрами', () => {
    try {
      assertQuota(9, 2, 10)
      throw new Error('ожидался DriveQuotaError')
    } catch (error) {
      expect(error).toBeInstanceOf(DriveQuotaError)
      const quota = error as DriveQuotaError
      expect(quota.code).toBe('over')
      expect(quota.used).toBe(9)
      expect(quota.limit).toBe(10)
      expect(quota.needed).toBe(2)
    }
    expect(() => assertQuota(8, 2, 10)).not.toThrow()
  })

  it('умолчание — 5 ГиБ', () => {
    expect(DEFAULT_DRIVE_QUOTA_BYTES).toBe(5 * 1024 ** 3)
  })

  it('форматирует размеры по-русски', () => {
    expect(formatBytes(0)).toBe('0 Б')
    expect(formatBytes(512)).toBe('512 Б')
    expect(formatBytes(1023)).toBe('1023 Б')
    expect(formatBytes(1024)).toBe('1 КБ')
    expect(formatBytes(1536)).toBe('1,5 КБ')
    expect(formatBytes(1024 ** 2)).toBe('1 МБ')
    expect(formatBytes(1024 ** 3)).toBe('1 ГБ')
    expect(formatBytes(1024 ** 4)).toBe('1 ТБ')
  })

  it('не показывает NaN и отрицательные значения', () => {
    expect(formatBytes(-5)).toBe('0 Б')
    expect(formatBytes(Number.NaN)).toBe('0 Б')
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('0 Б')
  })
})
