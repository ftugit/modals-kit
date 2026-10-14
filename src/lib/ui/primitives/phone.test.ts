import { describe, expect, it } from 'vitest'
import {
  PHONE_COUNTRIES, cleanNational, formatNational, joinPhone, nationalMax, placeholderFor, splitPhone,
} from './phone'

const by = (code: string) => PHONE_COUNTRIES.find((c) => c.code === code)!
const ru = by('+7')
const fi = by('+358')

describe('phone', () => {
  it('маска: группы и предел', () => {
    expect(nationalMax(ru)).toBe(10)
    expect(formatNational('9991234567', ru)).toBe('999 123-45-67')
    expect(formatNational('9991', ru)).toBe('999 1')
    expect(placeholderFor(ru)).toBe('000 000-00-00')
  })

  it('без маски: тройки до остатка E.164', () => {
    expect(nationalMax(fi)).toBe(12)
    expect(formatNational('401234567', fi)).toBe('401 234 567')
  })

  it('национальная часть: только цифры, предел, префикс страны на пределе', () => {
    expect(cleanNational('(999) 123-45-67', ru)).toBe('9991234567')
    expect(cleanNational('8 999 123-45-67', ru)).toBe('9991234567')
    expect(cleanNational('79991234567', ru)).toBe('9991234567')  // автозаполнение без плюса
    expect(cleanNational('812', ru)).toBe('812')               // код города, не префикс
    expect(cleanNational('99912345678', ru)).toBe('9991234567') // лишнее обрезано
  })

  it('«другая страна»: весь номер после плюса, до 15 цифр', () => {
    expect(nationalMax(by('+'))).toBe(15)
    expect(joinPhone('+', '8613800138000')).toBe('+8613800138000')
    expect(formatNational('8613800138000', by('+'))).toBe('861 380 013 800 0')
  })

  it('склейка: пустая национальная часть — пустое значение', () => {
    expect(joinPhone('+7', '9991234567')).toBe('+79991234567')
    expect(joinPhone('+7', '')).toBe('')
  })

  it('разбор номера целиком: самый длинный код, 00 как +, национальный без кода', () => {
    expect(splitPhone('+7 (999) 123-45-67', PHONE_COUNTRIES, ru)).toEqual({ country: ru, national: '9991234567' })
    expect(splitPhone('+375291234567', PHONE_COUNTRIES, ru)).toEqual({ country: by('+375'), national: '291234567' })
    expect(splitPhone('00358401234567', PHONE_COUNTRIES, ru)).toEqual({ country: fi, national: '401234567' })
    expect(splitPhone('8 999 123 45 67', PHONE_COUNTRIES, ru)).toEqual({ country: ru, national: '9991234567' })
    expect(splitPhone('+86 138 0013 8000', PHONE_COUNTRIES, ru)).toEqual({ country: by('+'), national: '8613800138000' })
    expect(splitPhone('+86 1', [ru], ru)).toEqual({ country: ru, national: '' })
    expect(splitPhone('', PHONE_COUNTRIES, ru)).toEqual({ country: ru, national: '' })
  })
})
