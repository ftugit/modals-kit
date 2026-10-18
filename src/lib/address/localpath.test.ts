import { describe, expect, test } from 'vitest'
import { localPath } from './core.js'

describe('localPath — параметр next без открытого редиректа', () => {
  test('локальный путь проходит', () => {
    expect(localPath('/form')).toBe('/form')
    expect(localPath('/cards/7?x=1#f')).toBe('/cards/7?x=1#f')
  })
  test('чужие схемы, авторитет и протокольно-относительный — null', () => {
    expect(localPath('https://evil.com')).toBeNull()
    expect(localPath('//evil.com')).toBeNull()
    expect(localPath('javascript:alert(1)')).toBeNull()
    expect(localPath('form')).toBeNull()
  })
  test('пустое и отсутствие — null', () => {
    expect(localPath('')).toBeNull()
    expect(localPath(null)).toBeNull()
    expect(localPath(undefined)).toBeNull()
  })
})
