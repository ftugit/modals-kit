// Проверка полноты базового словаря `en`: у каждого кода ошибки из исходников
// `lib/form` и `lib/db` есть английский текст по умолчанию (контракт `EN + code`).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { en, makeRenderer } from './messages'
import { formRenderer } from './messages-order'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(ts|svelte)$/.test(e.name) && !e.name.includes('.test.') ? [p] : []
  })
}

test('у каждого кода ошибки lib/form есть текст в en', () => {
  const codes = new Set<string>()
  for (const f of sources(join(__dirname))) {
    const s = readFileSync(f, 'utf8')
    for (const re of [/reject\(\d+,\s*'([^']+)'/g, /code:\s*'([a-z][\w-]*\.[\w.-]+)'/g, /issue\('([^']+)'/g])
      for (const m of s.matchAll(re)) codes.add(m[1]!)
  }
  expect(codes.size).toBeGreaterThan(20)
  expect([...codes].filter((c) => !(c in en)).sort()).toEqual([])
})

test('у кодов ошибок полей lib/db есть текст в en', () => {
  const doc = readFileSync(join(__dirname, '../db/errors.ts'), 'utf8')
  const block = doc.slice(doc.indexOf('Коды совпадают'), doc.indexOf('export interface FieldError'))
  const codes = [...block.matchAll(/`([\w.]+)`/g)].map((m) => m[1]!).filter((c) => c !== 'custom')
  expect(codes).toEqual(expect.arrayContaining(['unique', 'check', 'invalid', 'required']))
  expect(codes.filter((c) => !(c in en)).sort()).toEqual([])
})

test('параметры подставляются в en', () => {
  const r = makeRenderer([en])
  expect(r('rate.limited', { retryAfterMs: 2500 })).toBe('Too many attempts. Try again in 3s')
  expect(r('rate.limited', {})).toBe('Too many attempts. Try again later')
  expect(r('maxSize', { name: 'a.pdf', bytes: 2048 })).toBe('File a.pdf exceeds 2 KB')
})

test('порядок словарей: форма → приложение → пакет (en)', () => {
  const r = formRenderer(
    { required: 'форма' },
    { required: 'приложение', minLength: 'приложение {min}' },
  )
  expect(r('required')).toBe('форма')
  expect(r('minLength', { min: 3 })).toBe('приложение 3')
  expect(r('rate.limited', {})).toBe('Too many attempts. Try again later')
})
