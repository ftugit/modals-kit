/**
 * SSR-проверка `UserConfig` и кнопки «Настройки» в `Profile.svelte`:
 *  - замена `ProfilePrivacy` кнопкой «Настройки» (`user.config.edit` → `/user/config` / `/user/[id]/config`);
 *  - редактируемые поля vs `read-only` строки (`session.ipLock` для владельца, все строки для `config.read`);
 *  - переключение групп через `Steps` и кнопка сброса к умолчанию.
 */
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'

vi.mock('$app/state', () => ({
  page: {
    url: new URL('http://localhost/user/config'),
    state: {},
    data: {},
  },
  navigating: { to: null, from: null, type: null },
}))

import Profile from './Profile.svelte'
import { UserConfig } from './user-config/index.js'
import type { ProfileView, UserConfigRouteData } from '../types.js'

vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href, 'data-link': '' }),
  useModalLink: () => (
    name: string,
    params: Record<string, string | undefined> = {},
    opts: { href?: string } = {},
  ) => {
    let href = opts.href ?? '/'
    if (!opts.href) {
      if (name === 'user.profile.edit') href = `/user/${params.id}/edit`
      else if (name === 'user.blocks') href = params.id ? `/user/${params.id}/blocks` : '/blocks'
      else if (name === 'user.config.edit') {
        href = params.id ? `/user/${params.id}/config` : '/user/config'
      }
    }
    return { href, 'data-modal-link': '' }
  },
}))

const TARGET_UID = '22222222-2222-4222-8222-222222222222'

const sampleProfile: ProfileView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: TARGET_UID,
  nickname: 'Анна',
  avatarUrl: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

describe('Profile: кнопка «Настройки» вместо ProfilePrivacy', () => {
  test('в своём профиле рендерит кнопку «Настройки» на /user/config', () => {
    const { body } = render(Profile, {
      props: {
        uid: TARGET_UID,
        initial: {
          profile: sampleProfile,
          isOwn: true,
          visibility: 'nobody',
          notCreated: false,
          canEdit: true,
          canDeleteProfile: true,
          canDeleteSeed: true,
          fullBlock: null,
          blocks: [],
          canReadBlocks: false,
          canBlock: false,
          canOpenConfig: true,
        },
      },
    })
    expect(body).toContain('data-testid="profile-config-open"')
    expect(body).toContain('href="/user/config"')
    expect(body).not.toContain('user-profile-privacy')
  })

  test('на чужом профиле рендерит /user/[id]/config только при canOpenConfig', () => {
    const allowed = render(Profile, {
      props: {
        uid: TARGET_UID,
        initial: {
          profile: sampleProfile,
          isOwn: false,
          visibility: 'all',
          notCreated: false,
          canEdit: false,
          canDeleteProfile: false,
          canDeleteSeed: false,
          fullBlock: null,
          blocks: [],
          canReadBlocks: false,
          canBlock: false,
          canOpenConfig: true,
        },
      },
    })
    expect(allowed.body).toContain(`href="/user/${TARGET_UID}/config"`)

    const denied = render(Profile, {
      props: {
        uid: TARGET_UID,
        initial: {
          profile: sampleProfile,
          isOwn: false,
          visibility: 'all',
          notCreated: false,
          canEdit: false,
          canDeleteProfile: false,
          canDeleteSeed: false,
          fullBlock: null,
          blocks: [],
          canReadBlocks: false,
          canBlock: false,
          canOpenConfig: false,
        },
      },
    })
    expect(denied.body).not.toContain('data-testid="profile-config-open"')
  })
})

describe('UserConfig: редактируемые поля и read-only строки', () => {
  test('рендерит редактируемый profile.visibility со сбросом, read-only session.ipLock и навигацию разделов', () => {
    const initial: UserConfigRouteData = {
      uid: TARGET_UID,
      enabled: true,
      fact: null,
      slice: {
        uid: TARGET_UID,
        isOwn: true,
        canSave: true,
        items: [
          {
            key: 'profile.visibility',
            fieldName: 'profile_visibility',
            group: 'profile',
            kind: 'select',
            title: 'Кто видит профиль',
            description: 'Публичная видимость карточки профиля.',
            value: 'users',
            defaultValue: 'nobody',
            overridden: true,
            editable: true,
            deletable: true,
          },
          {
            key: 'session.ipLock',
            fieldName: 'session_ip_lock',
            group: 'security',
            kind: 'checkbox',
            title: 'Автовыход при смене IP',
            description: 'Сессия завершается при смене IP.',
            value: true,
            defaultValue: false,
            overridden: true,
            editable: false,
            deletable: false,
          },
        ],
      },
    }

    const { body } = render(UserConfig, {
      props: {
        initial,
        authorized: true,
        enabled: true,
      },
    })

    expect(body).toContain('aria-label="Разделы настроек"')
    expect(body).toContain('data-testid="config-item-profile.visibility"')
    expect(body).toContain('data-testid="config-reset-profile.visibility"')
    expect(body).toContain('data-testid="config-readonly-session.ipLock"')
    expect(body).toContain('Только чтение')
    expect(body).toContain('Задано администратором')
    expect(body).toContain('Включено')
    expect(body).not.toContain('name="session_ip_lock"')
    expect(body).toContain('data-testid="config-save-submit"')
  })

  test('при canSave = false скрывает кнопку «Сохранить», оставляя read-only просмотр', () => {
    const initial: UserConfigRouteData = {
      uid: TARGET_UID,
      enabled: true,
      fact: null,
      slice: {
        uid: TARGET_UID,
        isOwn: false,
        canSave: false,
        items: [
          {
            key: 'profile.visibility',
            fieldName: 'profile_visibility',
            group: 'profile',
            kind: 'select',
            title: 'Кто видит профиль',
            description: 'Публичная видимость.',
            value: 'nobody',
            defaultValue: 'nobody',
            overridden: false,
            editable: false,
            deletable: false,
          },
        ],
      },
    }

    const { body } = render(UserConfig, {
      props: {
        uid: TARGET_UID,
        initial,
        authorized: true,
        enabled: true,
      },
    })

    expect(body).toContain(TARGET_UID)
    expect(body).toContain('data-testid="config-readonly-profile.visibility"')
    expect(body).not.toContain('data-testid="config-save-submit"')
  })
})
