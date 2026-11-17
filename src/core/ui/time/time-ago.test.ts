import { describe, expect, test } from 'vitest'
import { formatTimeAgo } from './time-ago.js'

const NOW = Date.parse('2026-10-27T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

describe('formatTimeAgo', () => {
  test('секунды и первая минута — «только что»', () => {
    expect(formatTimeAgo(NOW - 30_000, { now: NOW })).toBe('только что')
    expect(formatTimeAgo(NOW - 59_000, { now: NOW })).toBe('только что')
    expect(formatTimeAgo(NOW + 30_000, { now: NOW })).toBe('только что')
  })

  test('минуты со склонением', () => {
    expect(formatTimeAgo(NOW - MIN, { now: NOW })).toBe('1 минуту назад')
    expect(formatTimeAgo(NOW - 5 * MIN, { now: NOW })).toBe('5 минут назад')
    expect(formatTimeAgo(NOW - 11 * MIN, { now: NOW })).toBe('11 минут назад')
    expect(formatTimeAgo(NOW - 22 * MIN, { now: NOW })).toBe('22 минуты назад')
  })

  test('часы со склонением', () => {
    expect(formatTimeAgo(NOW - HOUR, { now: NOW })).toBe('1 час назад')
    expect(formatTimeAgo(NOW - 3 * HOUR, { now: NOW })).toBe('3 часа назад')
    expect(formatTimeAgo(NOW - 23 * HOUR, { now: NOW })).toBe('23 часа назад')
  })

  test('дни со склонением, относительный предел — месяц', () => {
    expect(formatTimeAgo(NOW - DAY, { now: NOW })).toBe('1 день назад')
    expect(formatTimeAgo(NOW - 4 * DAY, { now: NOW })).toBe('4 дня назад')
    expect(formatTimeAgo(NOW - 29 * DAY, { now: NOW })).toBe('29 дней назад')
  })

  test('старше месяца — абсолютная дата, без «назад»', () => {
    const text = formatTimeAgo(NOW - 31 * DAY, { now: NOW, timeZone: 'UTC' })
    expect(text).not.toContain('назад')
    expect(text).toContain('2026')
    expect(text).toContain('сентября')
  })

  test('часовый пояс меняет абсолютную дату', () => {
    const t = Date.parse('2026-09-26T23:30:00Z')
    const utc = formatTimeAgo(t, { now: NOW, timeZone: 'UTC' })
    const kiritimati = formatTimeAgo(t, { now: NOW, timeZone: 'Pacific/Kiritimati' })
    expect(utc).toContain('26 сентября')
    expect(kiritimati).toContain('27 сентября')
  })
})
