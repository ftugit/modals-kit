/**
 * Эмуляция ошибок (ход 251): голый факт API → инструкция → ошибки формы.
 * Проверяется ЦЕПОЧКА: API не знает путей формы, инструкцию переваривает
 * `lib/form` (`ctx.fail` принимает FormError[]). Тела API пустые.
 */
import { describe, expect, test } from 'vitest'
import type { FormError } from '#lib/form/result.js'
import { demoFacts, instruction, toFormErrors } from './error.js'

describe('цепочка: факт API → инструкция → ошибки формы', () => {
  test('API не кладёт путь в факт — инструкция знает, где поле', () => {
    const [e] = instruction({ code: 'auth.identity-unknown' })
    expect(e.path).toBe('seed') // имя поля формы — знание инструкции
    expect(e.origin).toBe('external')
    expect(e.code).toBe('auth.identity-unknown')
  })

  test('подпись — ошибка у поля signature, nonce — повторяемая', () => {
    const [sig] = instruction({ code: 'auth.signature' })
    expect(sig.path).toBe('signature')
    const [nonce] = instruction({ code: 'auth.nonce-unknown' })
    expect(nonce.retryable).toBe(true)
  })

  test('общие ошибки без пути — баннер над формой', () => {
    for (const code of ['auth.anomaly', 'auth.revoked', 'auth.version'] as const) {
      const [e] = instruction({ code })
      expect(e.path).toBeUndefined()
      expect(e.code).toBe(code)
    }
  })

  test('факт с путём сильнее умолчания инструкции', () => {
    const [e] = instruction({ code: 'auth.confirm', path: 'ack' })
    expect(e.path).toBe('ack')
  })

  test('toFormErrors — список фактов в список ошибок формы (ctx.fail примет)', () => {
    const errors = toFormErrors(demoFacts())
    expect(errors).toHaveLength(3)
    const paths = errors.map((e) => e.path)
    expect(paths).toEqual(['seed', 'signature', undefined])
    expect(errors.every((e) => typeof e.code === 'string' && e.origin === 'external')).toBe(true)
  })

  test('форма примет ошибки как свои: форма FormError (id пустой — посчитает форма)', () => {
    const errors: readonly FormError[] = toFormErrors(demoFacts())
    expect(errors.every((e) => e.id === '' && e.source === undefined)).toBe(true)
  })
})
