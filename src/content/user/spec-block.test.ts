// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { activeBlock, longestFullBlock } from './spec-block.js'
import type { Blocked } from './types.js'

const b = (scope: string, until?: number, reason = 'r'): Blocked => ({ scope, reason, at: 0, until })

describe('spec-block: сферы, сроки, самая длинная полная', () => {
  test('истёкшая блокировка не действует, действующая той же сферы — действует', () => {
    const now = 1_000
    const list = [b('profile.delete', 500), b('account.delete', 2_000)]
    expect(activeBlock(list, 'profile.delete', now)).toBeUndefined()
    expect(activeBlock(list, 'account.delete', now)?.until).toBe(2_000)
  })

  test('блокировки накладываются: из нескольких полных — самая длинная', () => {
    const now = 1_000
    const list = [b('auth', 2_000, 'короткая'), b('auth', 5_000, 'длинная'), b('profile.delete')]
    expect(longestFullBlock(list, now)?.reason).toBe('длинная')
    // Бессрочная длиннее любой срочной.
    expect(longestFullBlock([...list, b('auth', undefined, 'вечная')], now)?.reason).toBe('вечная')
    // Истёкшие в выборку не попадают, сфера чужая — тоже.
    expect(longestFullBlock([b('auth', 10), b('profile.delete')], now)).toBeUndefined()
  })
})
