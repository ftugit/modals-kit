import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import ProfileCard from './ProfileCard.svelte'
import Profile from './Profile.svelte'
import { specProfile } from '../spec-profile.js'
import type { ProfileView } from '../types.js'

// Кнопка редактирования — механика модальной ссылки: в SSR-тесте без
// ModalHost её заменяет заглушка с тем же видимым итогом (`href` пары).
vi.mock('#hooks/links/index.js', () => ({
  useModalLink: () => (name: string, params: { id?: string }) => ({
    href: name === 'user.profile.edit' ? `/user/${params.id}/edit` : '/',
    'data-modal-link': '',
  }),
}))

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
      props: { uid: base.authId, initial: { profile: null, notCreated: true, canEdit: false } },
    })
    expect(body).toContain('data-testid="profile-not-created"')
    expect(body).toContain(specProfile.notCreatedTitle)
    expect(body).toContain(specProfile.notCreatedText)
    expect(body).not.toContain('data-acl-code')
    // Без флага правки кнопки редактирования нет.
    expect(body).not.toContain('Редактировать')
  })

  test('canEdit — кнопка справа сверху ведёт на роут редактирования и у заглушки', () => {
    const { body } = render(Profile, {
      props: { uid: base.authId, initial: { profile: null, notCreated: true, canEdit: true } },
    })
    expect(body).toContain('Редактировать')
    expect(body).toContain(`href="/user/${base.authId}/edit"`)
  })
})
