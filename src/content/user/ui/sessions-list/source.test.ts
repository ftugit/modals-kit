// Разбор адреса среза: чистые функции без SvelteKit и базы.
import { describe, expect, test } from 'vitest'
import { sessionsCountryCodes, sessionsFiltersTarget } from './source.js'

const UID = '11111111-1111-4111-8111-111111111111'

describe('sessionsFiltersTarget: цель среза из адреса носителя', () => {
  test('журнал — срез без цели, чужой аккаунт — по uuid из пути', () => {
    expect(sessionsFiltersTarget('/sessions')).toEqual({ journal: true, uid: null })
    expect(sessionsFiltersTarget('/sessions?page=2')).toEqual({ journal: true, uid: null })
    expect(sessionsFiltersTarget(`/user/${UID}/sessions`)).toEqual({ journal: false, uid: UID })
    expect(sessionsFiltersTarget('/user/sessions')).toEqual({ journal: false, uid: null })
  })

  test('чужой домен и мусор не превращаются в журнал', () => {
    // Негативный контроль: без этого `from=https://evil.example/sessions`
    // открыл бы срез по всем сессиям.
    expect(sessionsFiltersTarget('https://evil.example/sessions').journal).toBe(false)
    expect(sessionsFiltersTarget('/sessions-extra').journal).toBe(false)
    expect(sessionsFiltersTarget('/user/not-a-uuid/sessions')).toEqual({ journal: false, uid: null })
  })

  test('uuid в пути приводится к нижнему регистру', () => {
    expect(sessionsFiltersTarget(`/user/${UID.toUpperCase()}/sessions`).uid).toBe(UID)
  })
})

describe('sessionsCountryCodes: формат и кламп', () => {
  test('мусор отброшен, регистр поднят, лишнее обрезано', () => {
    expect(sessionsCountryCodes('ru,sg, none ,')).toEqual(['RU', 'SG', 'none'])
    expect(sessionsCountryCodes(Array.from({ length: 30 }, (_, i) => `C${i}`).join(','))).toHaveLength(20)
    expect(sessionsCountryCodes(null)).toEqual([])
  })
})
