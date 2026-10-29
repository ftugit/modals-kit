// Проверка русского UI-словаря `messages.ru.ts` и клиентского перевода `Result.errors`
// в `bind(forms, desc)` (как по `fetch`/`wss://`, так и при SSR `continuation` без JS).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { defineForm, field, makeRenderer, type Result } from '#lib/form/index.js'
import { bind } from '#lib/form/svelte/index.js'
import { forms, ru } from './forms.config'

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return sources(p)
    return /\.(ts|svelte)$/.test(e.name) && !e.name.includes('.test.') ? [p] : []
  })
}

const formDir = new URL('../../lib/form/', import.meta.url).pathname
const dbDir = new URL('../../lib/db/', import.meta.url).pathname

describe('messages.ru.ts', () => {
  test('у каждого кода ошибки lib/form есть текст в ru', () => {
    const codes = new Set<string>()
    for (const f of sources(formDir)) {
      const s = readFileSync(f, 'utf8')
      for (const re of [/reject\(\d+,\s*'([^']+)'/g, /code:\s*'([a-z][\w-]*\.[\w.-]+)'/g, /issue\('([^']+)'/g])
        for (const m of s.matchAll(re)) codes.add(m[1]!)
    }
    expect(codes.size).toBeGreaterThan(20)
    expect([...codes].filter((c) => !(c in ru)).sort()).toEqual([])
  })

  test('у кодов ошибок полей lib/db есть текст в ru', () => {
    const doc = readFileSync(join(dbDir, 'errors.ts'), 'utf8')
    const block = doc.slice(doc.indexOf('Коды совпадают'), doc.indexOf('export interface FieldError'))
    const codes = [...block.matchAll(/`([\w.]+)`/g)].map((m) => m[1]!).filter((c) => c !== 'custom')
    expect(codes).toEqual(expect.arrayContaining(['unique', 'check', 'invalid', 'required']))
    expect(codes.filter((c) => !(c in ru)).sort()).toEqual([])
  })

  test('параметры подставляются в ru', () => {
    const r = makeRenderer([ru])
    expect(r('rate.limited', { retryAfterMs: 2500 })).toBe('Слишком много попыток. Повторите через 3 с')
    expect(r('rate.limited', {})).toBe('Слишком много попыток. Повторите позже')
    expect(r('maxSize', { name: 'a.pdf', bytes: 2048 })).toBe('Файл a.pdf больше 2 КБ')
    expect(r('notAbove', { other: 2001 })).toBe('Не больше верхней границы (2001)')
    expect(r('noOverlap', { count: 1 })).toBe('Это значение выбрано и здесь, и в соседнем поле')
    expect(r('noOverlap', { count: 2 })).toBe('Эти значения выбраны и здесь, и в соседнем поле')
  })

  test('bind(forms, desc) переводит серверные EN-коды в русский словарь на продолжении и сохраняет чужие коды', () => {
    const desc = defineForm({
      id: 'i18n-probe',
      messages: { 'storage.quota': 'Квота хранилища исчерпана ({used} МБ)' },
      fields: {
        email: field.email({ label: 'Почта' }),
      },
    })

    const serverResult: Result = {
      v: 1,
      formId: 'i18n-probe',
      revision: 1,
      from: 'action',
      ok: false,
      status: 422,
      outcome: 'not-applied',
      submissionId: '0192f3c1-4b8e-7c2a-9d1f-6e5a4b3c2d10',
      instance: 'i18n-probe:new',
      values: { email: 'taken@example.com' },
      errors: [
        { id: '1', path: 'email', code: 'unique', message: 'This value is already taken', origin: 'server' },
        { id: '2', code: 'rate.limited', params: { retryAfterMs: 4000 }, message: 'Too many attempts. Try again in 4s', origin: 'server' },
        { id: '3', code: 'storage.quota', params: { used: 50 }, message: 'Storage quota exceeded', origin: 'server' },
        { id: '4', code: 'vendor.custom', message: 'Upstream gateway rejected payload', origin: 'server' },
      ],
    }

    const bound = bind(forms, desc, { continuation: serverResult })
    expect(bound.field('email')?.errors[0]?.message).toBe('Это значение уже занято')
    expect(bound.common.map((e) => [e.code, e.message])).toEqual([
      ['rate.limited', 'Слишком много попыток. Повторите через 4 с'],
      ['storage.quota', 'Квота хранилища исчерпана (50 МБ)'],
      ['vendor.custom', 'Upstream gateway rejected payload'],
    ])
  })
})
