import { describe, expect, test } from 'vitest'
import { defaults } from './config.js'
import { specAvatar } from './spec-avatar.js'

describe('specAvatar', () => {
  test('описывает только результат: размеры, вес, расширение', () => {
    expect(specAvatar).toEqual({ width: 200, height: 200, maxBytes: 20_480, format: 'jpeg' })
  })

  test('конфиг параметров картинки не дублирует: таких ключей в нём нет', () => {
    expect(Object.keys(defaults).filter((k) => k.startsWith('avatar'))).toEqual([])
  })
})
