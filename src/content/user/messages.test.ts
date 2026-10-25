// Страж сообщений модуля пользователя: без текста `makeRenderer` вернёт код,
// и пользователь увидит `auth.session-unknown` вместо человеческой строки.
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { USER_MESSAGES } from './messages.js'
import { profileForm } from './ui/profile-form/form.js'
import { seedForm } from './ui/seed-form/form.js'

const source = readFileSync(new URL('./error.ts', import.meta.url), 'utf8')
const block = source.slice(
  source.indexOf('export type AuthErrorCode ='),
  source.indexOf('/** Голый факт'),
)
const codes = [...block.matchAll(/'([a-z][\w.-]+)'/g)].map((m) => m[1]!)

test('тип кодов разобран: страж не проходит на пустом списке', () => {
  expect(codes.length).toBe(17)
})

test('у каждого доменного кода есть текст', () => {
  expect(codes.filter((code) => !(code in USER_MESSAGES)).sort()).toEqual([])
})

test('формы модуля кладут словарь в свои `messages`', () => {
  expect(codes.filter((code) => !profileForm.messages?.[code]).sort()).toEqual([])
  // у сид-формы свои только `pattern`; остальное — общий словарь
  expect(Object.keys(seedForm.messages ?? {})).toEqual(
    expect.arrayContaining(['auth.session-unknown', 'auth.kid-unknown']),
  )
})
