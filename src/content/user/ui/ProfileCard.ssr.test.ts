import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import ProfileCard from './ProfileCard.svelte'
import Profile from './Profile.svelte'
import { specProfile } from '../spec-profile.js'
import type { ProfileView } from '../types.js'

// Кнопка редактирования — механика модальной ссылки: в SSR-тесте без
// ModalHost её заменяет заглушка с тем же видимым итогом (`href` пары).
// Заглушка повторяет видимый итог механики: `href` — страница пары, а
// присутствие `data-modal-link` и есть отличие модалки от обычной ссылки.
vi.mock('#hooks/links/index.js', () => ({
  useModalLink: () => (name: string, params: { id?: string } = {}) => ({
    href:
      name === 'user.profile.edit'
        ? `/user/${params.id}/edit`
        : name === 'user.sessions'
          ? params.id
            ? `/user/${params.id}/sessions`
            : '/user/sessions'
          : '/',
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

describe('Profile: устройства аккаунта — одна кнопка на своих и чужих', () => {
  const foreign = '22222222-2222-4222-8222-222222222222'
  const props = (isOwn: boolean) => ({
    uid: foreign,
    initial: {
      profile: base,
      isOwn,
      visibility: 'nobody' as const,
      notCreated: false,
      canEdit: false,
      canDeleteProfile: false,
      canDeleteSeed: false,
      fullBlock: null,
      blocks: [],
      canReadSessions: true,
      canReadBlocks: false,
      canBlock: false,
    },
  })

  test('чужой аккаунт открывается модалкой со своей страницей-fallback', () => {
    const { body } = render(Profile, { props: props(false) })
    expect(body).toContain(`href="/user/${foreign}/sessions"`)
    // Модалка, а не переход: иначе тот же смысл получал другой носитель.
    expect(body).toContain('data-modal-link')
    expect(body).toContain('data-testid="profile-sessions-open"')
  })

  test('свой аккаунт — та же модалка без id', () => {
    const { body } = render(Profile, { props: props(true) })
    expect(body).toContain('href="/user/sessions"')
    expect(body).not.toContain(`href="/user/${foreign}/sessions"`)
    expect(body).toContain('data-testid="profile-sessions-open"')
  })

  test('без права читать чужие устройства кнопки нет', () => {
    const { body } = render(Profile, {
      props: { uid: foreign, initial: { ...props(false).initial, canReadSessions: false } },
    })
    expect(body).not.toContain('data-testid="profile-sessions-open"')
  })
})

describe('Profile: заглушка «не создан» рисует сам компонент', () => {
  test('notCreated — тексты спеки, а не экран отказа', () => {
    const { body } = render(Profile, {
      props: { uid: base.authId, initial: { profile: null, isOwn: false, visibility: 'nobody', notCreated: true, canEdit: false, canDeleteProfile: false, canDeleteSeed: false, fullBlock: null, blocks: [], canReadBlocks: false, canBlock: false } },
    })
    expect(body).toContain('data-testid="profile-not-created"')
    expect(body).toContain(specProfile.notCreatedTitle)
    expect(body).toContain(specProfile.notCreatedText)
    expect(body).not.toContain('data-acl-code')
    // Без флага правки кнопки редактирования нет. Чужой профиль сессий не показывает.
    expect(body).not.toContain('Редактировать')
    expect(body).not.toContain('data-testid="profile-sessions-open"')
  })

  test('canEdit — кнопка справа сверху ведёт на роут редактирования и у заглушки', () => {
    const { body } = render(Profile, {
      props: { uid: base.authId, initial: { profile: null, isOwn: true, visibility: 'nobody', notCreated: true, canEdit: true, canDeleteProfile: false, canDeleteSeed: false, fullBlock: null, blocks: [], canReadBlocks: false, canBlock: false } },
    })
    expect(body).toContain('Редактировать')
    expect(body).toContain(`href="/user/${base.authId}/edit"`)
    expect(body).toContain('data-testid="profile-sessions-open"')
    expect(body).toContain('href="/user/sessions"')
  })
})
