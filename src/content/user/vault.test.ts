/** Чистая логика автопродления: лид, джиттер, парсинг ответа. */
import { describe, expect, test } from 'vitest'
import { fireAt, leadFor, overdue, parseRenewResponse } from './vault.js'

describe('автопродление: сроки', () => {
  test('лид: 5% от срока, но не меньше минуты', () => {
    expect(leadFor(60 * 60 * 1000)).toBe(3 * 60 * 1000) // час → 3 мин
    expect(leadFor(10 * 60 * 1000)).toBe(60_000) // 10 мин → 1 мин (пол)
    expect(leadFor(1000)).toBe(60_000) // секунда → всё равно пол
  })

  test('выстрел внутри лид-окна, детерминирован при фиксированном rand', () => {
    const exp = 10_000_000
    expect(fireAt(exp, 60 * 60 * 1000, () => 0)).toBe(exp - 180_000) // начало окна
    expect(fireAt(exp, 60 * 60 * 1000, () => 1)).toBe(exp) // граница: конец окна
    expect(fireAt(exp, 60 * 60 * 1000, () => 0.5)).toBe(exp - 90_000)
  })

  test('overdue: за минуту до конца уже пора', () => {
    expect(overdue(100_000, 100_000 - 61_000)).toBe(false)
    expect(overdue(100_000, 100_000 - 60_000)).toBe(true)
    expect(overdue(100_000, 100_001)).toBe(true)
  })
})

describe('парсинг ответа продления', () => {
  const data = {
    access: 'a.b.c',
    expiresAt: 123,
    ttlMs: 3_600_000,
    sub: 'id1',
    prof: { nickname: 'Вася', avatarUrl: null },
  }

  test('успешный ActionResult', () => {
    expect(parseRenewResponse({ type: 'success', data: { result: { ok: true, outcome: 'committed', data } } }))
      .toEqual(data)
  })

  test('отказ экшена, мусор, пусто — undefined', () => {
    expect(parseRenewResponse({ type: 'failure', data: { result: { ok: false, outcome: 'unknown' } } })).toBeUndefined()
    expect(parseRenewResponse({ type: 'success', data: { result: { ok: true, data: { access: 1 } } } })).toBeUndefined()
    expect(parseRenewResponse(null)).toBeUndefined()
    expect(parseRenewResponse(undefined)).toBeUndefined()
  })
})
