/** Шаги одной формы: маркер в адресе экшена, шаг в Result.data. */
import { describe, expect, test } from 'vitest'
import { stepAction, stepOf, stepOfResult, withStep } from './steps.js'
import type { Result } from './result.js'

const ok = (data?: unknown): Result => ({ ok: true, outcome: 'committed', data }) as unknown as Result

describe('шаги формы', () => {
  test('шаг из адреса: есть, пустой, нет', () => {
    expect(stepOf(new Request('https://x/user/auth?step=restore'), 'entry')).toBe('restore')
    expect(stepOf(new Request('https://x/user/auth?step='), 'entry')).toBe('entry')
    expect(stepOf(new Request('https://x/user/auth'), 'entry')).toBe('entry')
  })

  test('адрес экшена: правит свой ключ, чужие не трогает, относительный остаётся относительным', () => {
    expect(stepAction('/user/auth', 'profile')).toBe('/user/auth?step=profile')
    expect(stepAction('/user/auth?modal=user.auth&next=/a?b=1', 'restore'))
      .toBe('/user/auth?modal=user.auth&next=%2Fa%3Fb%3D1&step=restore')
    expect(stepAction('/user/auth?step=entry', 'restore')).toBe('/user/auth?step=restore')
  })

  test('шаг в результате: положить и прочитать', () => {
    expect(stepOfResult(ok(withStep({ done: 1 }, 'profile')))).toBe('profile')
    expect(stepOfResult(ok(withStep(undefined, 'restore')))).toBe('restore')
    expect(stepOfResult(ok({ other: 1 }))).toBeUndefined()
    expect(stepOfResult(ok(undefined))).toBeUndefined()
    expect(stepOfResult(ok(withStep({ step: '' }, '')))).toBeUndefined()
  })
})
