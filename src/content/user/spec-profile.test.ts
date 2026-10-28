import { describe, expect, test } from 'vitest'
import { specProfile } from './spec-profile.js'

describe('specProfile', () => {
  test('все тексты-заглушки заданы одним объектом и не пусты', () => {
    expect(Object.keys(specProfile).sort()).toEqual([
      'avatarMissing',
      'nicknameMissing',
      'notCreatedText',
      'notCreatedTitle',
      'privacyLevels',
      'privacyTitle',
    ])
    for (const value of Object.values(specProfile)) {
      if (typeof value === 'string') expect(value.trim().length).toBeGreaterThan(0)
    }
    expect(Object.keys(specProfile.privacyLevels).sort()).toEqual(['all', 'nobody', 'users'])
  })
})
