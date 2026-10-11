import { describe, expect, it } from 'vitest'
import { trustedOrigins } from './trusted-origins'

const from = (env: Record<string, string>) => trustedOrigins((key) => env[key])

describe('trustedOrigins — один список для фреймворка и слоя 02', () => {
  it('без настроек: локальные адреса портов по умолчанию 5173 и 5174', () => {
    expect(from({})).toEqual({
      exact: [
        'http://localhost:5173', 'http://127.0.0.1:5173',
        'http://localhost:5174', 'http://127.0.0.1:5174',
      ],
      patterns: [],
    })
  })

  it('пустое PREVIEW_PORTS = не задано: те же порты по умолчанию, что без переменной', () => {
    expect(from({ PREVIEW_PORTS: '' })).toEqual(from({}))
  })

  it('KIT_TRUSTED_ORIGINS: точные адреса — в exact, wildcard — только в patterns', () => {
    const { exact, patterns } = from({
      KIT_TRUSTED_ORIGINS: ' https://app.example , https://*.e2b.app ,,',
      PREVIEW_PORTS: '4173',
    })
    expect(exact).toEqual(['https://app.example', 'http://localhost:4173', 'http://127.0.0.1:4173'])
    expect(patterns).toHaveLength(1)
    expect(patterns[0].test('https://5173-abc.e2b.app')).toBe(true)
    // `*` не выходит за пределы одного сегмента хоста и не съедает путь
    expect(patterns[0].test('https://evil.example/x.e2b.app')).toBe(false)
    expect(patterns[0].test('https://5173-abc.e2b.app.evil.example')).toBe(false)
  })

  it('песочница: публичный адрес превью для каждого порта, без дублей', () => {
    const { exact } = from({
      PREVIEW_PORTS: '5173,5173',
      E2B_SANDBOX_ID: 'sbx1',
      KIT_TRUSTED_ORIGINS: 'http://localhost:5173',
    })
    expect(exact).toEqual(['http://localhost:5173', 'http://127.0.0.1:5173', 'https://5173-sbx1.e2b.app'])
  })
})
