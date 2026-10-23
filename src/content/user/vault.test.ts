/** Чистая математика автопродления и ключей снимка (`0` внешних зависимостей). */
import { describe, expect, test } from 'vitest'
import { fireAt, leadFor, overdue, snapshotKeyOf, type VaultSessionMeta } from './vault.js'

describe('автопродление: сроки и метаданные', () => {
  test('лид: 5% от срока, но не меньше минуты', () => {
    expect(leadFor(60 * 60 * 1000)).toBe(3 * 60 * 1000)
    expect(leadFor(10 * 60 * 1000)).toBe(60_000)
    expect(leadFor(1000)).toBe(60_000)
  })

  test('выстрел внутри лид-окна, детерминирован при фиксированном rand', () => {
    const exp = 10_000_000
    expect(fireAt(exp, 60 * 60 * 1000, () => 0)).toBe(exp - 180_000)
    expect(fireAt(exp, 60 * 60 * 1000, () => 1)).toBe(exp)
    expect(fireAt(exp, 60 * 60 * 1000, () => 0.5)).toBe(exp - 90_000)
  })

  test('overdue: за минуту до конца уже пора', () => {
    expect(overdue(100_000, 100_000 - 61_000)).toBe(false)
    expect(overdue(100_000, 100_000 - 60_000)).toBe(true)
    expect(overdue(100_000, 100_001)).toBe(true)
  })

  test('snapshotKeyOf: метаданные не содержат сырого токена и реагируют на смену профиля/iat', () => {
    const base: VaultSessionMeta = {
      sub: 'id1',
      iat: 100,
      expiresAt: 3_600_100,
      ttlMs: 3_600_000,
      prof: { nickname: 'Вася', avatarUrl: null },
    }
    expect('access' in (base as Record<string, unknown>)).toBe(false)
    expect(snapshotKeyOf(null)).toBe('guest')
    expect(snapshotKeyOf(base)).not.toBe(snapshotKeyOf({ ...base, iat: 200 }))
    expect(snapshotKeyOf(base)).not.toBe(
      snapshotKeyOf({ ...base, prof: { nickname: 'Петя', avatarUrl: null } }),
    )
  })
})
