import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import ProfileCard from './ProfileCard.svelte'
import Profile from './Profile.svelte'
import { specProfile } from '../spec-profile.js'
import type { ProfileView } from '../types.js'

/**
 * Чтение профиля (этапы 3+4): карточка показывает всё, что вернул
 * `ProfileView`; пустые значения называются текстами единой спеки
 * (`specProfile`), а экран «не создан» строится из той же спеки.
 */
const base: ProfileView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: '22222222-2222-4222-8222-222222222222',
  nickname: 'Вася',
  avatarUrl: 'https://example.com/a.png',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_100_000_000,
}

describe('ProfileCard', () => {
  test('показывает все поля вернувшегося профиля', () => {
    const { body } = render(ProfileCard, { props: { profile: base } })
    expect(body).toContain('data-testid="profile-card"')
    expect(body).toContain('Вася')
    expect(body).toContain('https://example.com/a.png')
    expect(body).toContain(base.id)
    expect(body).toContain(base.authId)
    expect(body).toContain('<time')
  })

  test('пустые никнейм и аватар — тексты спеки, а не пустота', () => {
    const { body } = render(ProfileCard, {
      props: { profile: { ...base, nickname: null, avatarUrl: null } },
    })
    expect(body).toContain(specProfile.nicknameMissing)
    expect(body).toContain(specProfile.avatarMissing)
  })
})

describe('Profile: заглушка «не создан» рисует сам компонент', () => {
  test('notCreated — тексты спеки, а не экран отказа', () => {
    const { body } = render(Profile, {
      props: { uid: base.authId, initial: { profile: null, notCreated: true } },
    })
    expect(body).toContain('data-testid="profile-not-created"')
    expect(body).toContain(specProfile.notCreatedTitle)
    expect(body).toContain(specProfile.notCreatedText)
    expect(body).not.toContain('data-acl-code')
  })
})
