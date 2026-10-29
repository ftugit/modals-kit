import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appHtmlScriptHashes, cspDirectives, sameOriginFetch, trustedOrigins } from './trusted-origins'

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

describe('sameOriginFetch — только страницы этого сайта', () => {
  const req = (site?: string) =>
    new Request('https://app.test/api/x', site ? { headers: { 'sec-fetch-site': site } } : {})
  it('same-origin — да; cross-site, same-site, none — нет', () => {
    expect(sameOriginFetch(req('same-origin'))).toBe(true)
    for (const s of ['cross-site', 'same-site', 'none']) expect(sameOriginFetch(req(s))).toBe(false)
  })
  it('без заголовка: отказ, а с allowMissing (dev по http) — да; чужой сайт и в dev — нет', () => {
    expect(sameOriginFetch(req())).toBe(false)
    expect(sameOriginFetch(req(), true)).toBe(true)
    expect(sameOriginFetch(req('cross-site'), true)).toBe(false)
  })
})

describe('cspDirectives и удаление Google Fonts', () => {
  const sha256Base64 = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64')
  const appHtml = readFileSync(new URL('../app.html', import.meta.url), 'utf8')
  const unocssConfig = readFileSync(new URL('../../unocss.config.ts', import.meta.url), 'utf8')

  it('src/app.html и unocss.config.ts не ссылаются на Google Fonts и Manrope', () => {
    expect(appHtml).not.toContain('fonts.googleapis.com')
    expect(appHtml).not.toContain('fonts.gstatic.com')
    expect(appHtml).not.toContain('Manrope')
    expect(unocssConfig).not.toContain('Manrope')
  })

  it('appHtmlScriptHashes считает точный sha256 инлайнового скрипта темы в app.html и пропускает внешние src=', () => {
    const hashes = appHtmlScriptHashes(appHtml, sha256Base64)
    expect(hashes).toHaveLength(1)
    expect(hashes[0]).toMatch(/^sha256-[A-Za-z0-9+/=]+$/)
    expect(appHtmlScriptHashes('<script src="/ext.js"></script>', sha256Base64)).toEqual([])
  })

  it('чистый прод включает frame-ancestors none, wasm-unsafe-eval и не содержит кавычек внутри токенов SvelteKit', () => {
    const hashes = appHtmlScriptHashes(appHtml, sha256Base64)
    const prod = cspDirectives({ get: () => undefined, dev: false, inlineScriptHashes: hashes })
    expect(prod['default-src']).toEqual(['self'])
    expect(prod['script-src']).toEqual(['self', 'wasm-unsafe-eval', ...hashes])
    expect(prod['style-src-elem']).toEqual(['self'])
    expect(prod['style-src-attr']).toEqual(['unsafe-inline'])
    expect(prod['font-src']).toEqual(['self', 'data:'])
    expect(prod['connect-src']).toEqual(['self'])
    expect(prod['object-src']).toEqual(['none'])
    expect(prod['frame-ancestors']).toEqual(['none'])

    // SvelteKit сам оборачивает ключевые слова в одинарные кавычки — в массивах их быть не должно
    for (const values of Object.values(prod)) {
      for (const token of values) {
        expect(token.startsWith("'")).toBe(false)
        expect(token).not.toContain('googleapis')
        expect(token).not.toContain('gstatic')
      }
    }
  })

  it('в dev и в песочнице превью frame-ancestors опускается, а dev открывает ws:/wss: для HMR', () => {
    const devPolicy = cspDirectives({ get: () => undefined, dev: true })
    expect('frame-ancestors' in devPolicy).toBe(false)
    expect(devPolicy['connect-src']).toEqual(['self', 'ws:', 'wss:'])

    const sandboxPolicy = cspDirectives({
      get: (k) => (k === 'E2B_SANDBOX_ID' ? 'sbx-1' : undefined),
      dev: false,
    })
    expect('frame-ancestors' in sandboxPolicy).toBe(false)
    expect(sandboxPolicy['connect-src']).toEqual(['self'])
  })
})
