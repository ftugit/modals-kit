import { describe, expect, it } from 'vitest'
import { normalizePhone, phoneType } from './extend'

describe('тип phone (расширение приложения)', () => {
  it('номер, как его пишут люди, → одна строка', () => {
    expect(normalizePhone('+7 (999) 123-45-67')).toBe('+79991234567')
    expect(normalizePhone(' +79991234567 ')).toBe('+79991234567')
    expect(normalizePhone('0049 30 1234567')).toBe('+49301234567')
    expect(normalizePhone('+1.213.373.4253')).toBe('+12133734253')
  })

  it('без кода страны, с буквами, короче 8 и длиннее 15 цифр — не номер', () => {
    expect(normalizePhone('8 999 123-45-67')).toBeNull()
    expect(normalizePhone('+7 999 ABC-45-67')).toBeNull()
    expect(normalizePhone('+7 999 12')).toBeNull()
    expect(normalizePhone('+1234567890123456')).toBeNull()
    expect(normalizePhone('+7 999+123')).toBeNull()
    expect(normalizePhone('+7 999 123-45-6')).toBeNull() // девять цифр у +7: длина по стране
    expect(normalizePhone('+374 91 234 567')).toBe('+37491234567')
  })

  it('decode: пусто — пустое значение, ошибка — код type.phone', () => {
    const ctx = {} as never
    expect(phoneType.decode([''], ctx)).toEqual({ ok: true, value: '' })
    expect(phoneType.decode(['+7 (999) 123-45-67'], ctx)).toEqual({ ok: true, value: '+79991234567' })
    expect(phoneType.decode(['8 999'], ctx)).toEqual({ ok: false, code: 'type.phone', params: { raw: '8 999' } })
  })
})
