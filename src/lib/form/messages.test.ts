import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { makeRenderer, ru } from './messages'

// F23: код без текста рендерится как есть — пользователь видел «rate.limited».
// Страж собирает коды из исходников lib/form: новый код без текста — красный тест.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(ts|svelte)$/.test(e.name) && !e.name.includes('.test.') ? [p] : []
  })
}

test('у каждого кода ошибки lib/form есть текст в ru', () => {
  const codes = new Set<string>()
  for (const f of sources(join(__dirname))) {
    const s = readFileSync(f, 'utf8')
    for (const re of [/reject\(\d+,\s*'([^']+)'/g, /code:\s*'([a-z][\w-]*\.[\w.-]+)'/g, /issue\('([^']+)'/g])
      for (const m of s.matchAll(re)) codes.add(m[1]!)
  }
  expect(codes.size).toBeGreaterThan(20)
  expect([...codes].filter((c) => !(c in ru)).sort()).toEqual([])
})

test('параметры подставляются', () => {
  const r = makeRenderer([ru])
  expect(r('rate.limited', { retryAfterMs: 2500 })).toBe('Слишком много попыток. Повторите через 3 с')
  expect(r('rate.limited', {})).toBe('Слишком много попыток. Повторите позже')
  expect(r('file.too-large', { name: 'a.pdf' })).toBe('Файл a.pdf слишком большой')
  expect(r('maxSize', { name: 'a.pdf', bytes: 2048 })).toBe('Файл a.pdf больше 2 КБ')
})

// F55: клиент (bind) и сервер (createFormHandler) собирают тексты одним помощником.
test('порядок словарей: форма → приложение → пакет', async () => {
  const { formRenderer } = await import('./messages-order')
  const r = formRenderer({ required: 'форма' }, { required: 'приложение', minLength: 'приложение {min}' })
  expect(r('required')).toBe('форма')
  expect(r('minLength', { min: 3 })).toBe('приложение 3')
  expect(r('rate.limited', {})).toBe('Слишком много попыток. Повторите позже')
})
