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
  expect(codes.length).toBe(37)
})

test('у каждого доменного кода есть текст', () => {
  expect(codes.filter((code) => !(code in USER_MESSAGES)).sort()).toEqual([])
})

test('общий текст ключа описывает длину и не обещает печатность Unicode', () => {
  // Уточнение про управляющие символы — у формы пула (см. src/content/storage-servers/messages.test.ts):
  // общий словарь читает и куки-сейф, где такой проверки нет.
  expect(USER_MESSAGES['storage.key-invalid']).toBe('Ключ шифрования файлов должен содержать от 8 до 256 символов')
  expect(USER_MESSAGES['storage.key-invalid']).not.toContain('печатных')
  expect(USER_MESSAGES['storage.key-invalid']).not.toContain('ASCII')
})

test('формы модуля кладут словарь в свои `messages`', () => {
  expect(codes.filter((code) => !profileForm.messages?.[code]).sort()).toEqual([])
  // у сид-формы свои только `pattern`; остальное — общий словарь
  expect(Object.keys(seedForm.messages ?? {})).toEqual(
    expect.arrayContaining(['auth.session-unknown', 'auth.kid-unknown']),
  )
})
