import { describe, expect, test } from 'vitest'
import { sessionsCountryCodes, sessionsFiltersTarget, sessionsTargetFrom } from './source.js'

const UID = '11111111-1111-4111-8111-111111111111'

describe('sessionsFiltersTarget: цель среза из явных параметров пары', () => {
  test('журнал, аккаунт и свои устройства различаются без адреса носителя', () => {
    expect(sessionsFiltersTarget(null, true)).toEqual({ kind: 'journal' })
    expect(sessionsFiltersTarget(UID, false)).toEqual({ kind: 'account', uid: UID })
    expect(sessionsFiltersTarget(null, false)).toEqual({ kind: 'own' })
    // Журнал сильнее uid: невозможно получить «журнал аккаунта».
    expect(sessionsFiltersTarget(UID, true)).toEqual({ kind: 'journal' })
  })

  test('uid нормализуется, пустой и невалидный не становятся аккаунтом', () => {
    expect(sessionsFiltersTarget(`  ${UID.toUpperCase()}  `, false)).toEqual({ kind: 'account', uid: UID })
    expect(sessionsFiltersTarget('   ', false)).toEqual({ kind: 'own' })
    expect(sessionsTargetFrom(null, false)).toEqual({ kind: 'own' })
  })
})

describe('sessionsCountryCodes', () => {
  test('коды стран нормализуются и ограничиваются', () => {
    expect(sessionsCountryCodes('ru, sg ,none')).toEqual(['RU', 'SG', 'none'])
    expect(sessionsCountryCodes(null)).toEqual([])
  })
})
