import { describe, expect, test } from 'vitest'
import { specProfile } from './spec-profile.js'

describe('specProfile', () => {
  test('все тексты-заглушки заданы одним объектом и не пусты', () => {
    expect(Object.keys(specProfile).sort()).toEqual([
      'avatarMissing',
      'nicknameMissing',
      'notCreatedText',
      'notCreatedTitle',
    ])
    for (const value of Object.values(specProfile)) {
      expect(typeof value).toBe('string')
      expect(value.trim().length).toBeGreaterThan(0)
    }
  })
})
