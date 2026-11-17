// Одна формула паузы на опрос, транспорт и форму (ход 269).
import { describe as suite, expect, test } from 'vitest'
import { backoffDelay } from './backoff'

suite('backoffDelay', () => {
  test('шаг удваивается с каждой попыткой', () => {
    expect([1, 2, 3, 4].map((n) => backoffDelay(n, 2_000, 60_000))).toEqual([2_000, 4_000, 8_000, 16_000])
  })

  test('потолок важнее степени', () => {
    expect(backoffDelay(10, 2_000, 60_000)).toBe(60_000)
    expect(backoffDelay(40, 2_000, 60_000)).toBe(60_000)
  })

  test('нулевая и отрицательная попытка считается первой', () => {
    expect(backoffDelay(0, 20, 500)).toBe(20)
    expect(backoffDelay(-3, 20, 500)).toBe(20)
  })

  test('джиттер — доля шага, а не потолка', () => {
    // потолок шага (80), а не общий потолок (500)
    expect(backoffDelay(3, 20, 500, () => 0.5)).toBe(40)
    expect(backoffDelay(3, 20, 500, () => 0)).toBe(0)
  })

  test('по умолчанию джиттера нет: формулу проверяют точными числами', () => {
    expect(backoffDelay(5, 3_000, 60_000)).toBe(48_000)
  })
})
