import { describe, expect, test } from 'vitest'
import { defaults } from './config.js'
import { SpecAvatar } from './spec-avatar.js'

describe('SpecAvatar', () => {
  test('описывает только результат: размеры, вес, расширение', () => {
    expect(SpecAvatar).toEqual({ width: 200, height: 200, maxBytes: 20_480, format: 'jpeg' })
  })

  test('умолчания конфига берутся из спеки — один источник', () => {
    expect(defaults.avatarEdge).toBe(SpecAvatar.width)
    expect(defaults.avatarMaxBytes).toBe(SpecAvatar.maxBytes)
  })
})
