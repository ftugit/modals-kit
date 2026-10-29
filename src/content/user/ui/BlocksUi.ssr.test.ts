/**
 * SSR-проверка новых UI-компонентов блокировок:
 *  - компактная кнопка «Блокировки» в `Profile.svelte` (обе ветки: `profile` и `notCreated`);
 *  - `BlocksFiltersForm.svelte`: кнопка выбора пользователей отключена при переданном `uid`
 *    и активна в глобальном режиме с `canPickUsers`;
 *  - `BlockForm.svelte`: в глобальном `edit` показывается disabled-поле с переданным `id`
 *    (без `name`, не в `FormData`) и кнопка профиля; в персональном `edit` (`uid` задан) — скрыты;
 *    у read-only зрителя (`canSubmit = false`) нет кнопок отправки;
 *  - `BlockDelete.svelte`: чекбокс `hard` рендерится только при `canHardDelete === true`.
 */
import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import Profile from './Profile.svelte'
import BlocksFiltersForm from './BlocksFiltersForm.svelte'
import BlockForm from './block-form/BlockForm.svelte'
import BlockDelete from './block-delete/BlockDelete.svelte'
import type { BlockDetailView, ProfileView } from '../types.js'

vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href, 'data-link': '' }),
  useModalLink: () => (
    name: string,
    params: Record<string, string | undefined> = {},
    opts: { href?: string } = {},
  ) => {
    let href = opts.href ?? '/'
    if (!opts.href) {
      if (name === 'user.profile') href = `/user/${params.id}`
      else if (name === 'user.profile.edit') href = `/user/${params.id}/edit`
      else if (name === 'user.blocks') href = params.id ? `/user/${params.id}/blocks` : '/blocks'
      else if (name === 'user.blocks.delete') {
        href = params.uid
          ? `/user/${params.uid}/blocks/${params.blockId}/delete`
          : `/blocks/${params.blockId}/delete`
      }
    }
    return { href, 'data-modal-link': '' }
  },
}))

const TARGET_UID = '22222222-2222-4222-8222-222222222222'
const BLOCK_ID = '33333333-3333-4333-8333-333333333333'

const sampleProfile: ProfileView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: TARGET_UID,
  nickname: 'Тест',
  avatarUrl: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
}

const baseDetail: BlockDetailView = {
  block: {
    id: BLOCK_ID,
    authId: TARGET_UID,
    scope: 'auth',
    reason: 'спам-рассылка',
    at: 1_700_000_000_000,
    until: null,
    by: '44444444-4444-4444-8444-444444444444',
    deletedAt: null,
  },
  canSubmit: true,
  canEditReason: true,
  canEditUntil: true,
  canDelete: true,
  canHardDelete: false,
  assignableScopes: ['auth', 'profile.delete', 'account.delete'],
}

describe('Profile.svelte — компактная кнопка «Блокировки»', () => {
  test('кнопка есть и при заполненном профиле, и при notCreated, если canReadBlocks = true', () => {
    const withProfile = render(Profile, {
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
          canReadBlocks: true,
          canBlock: false,
        },
      },
    })
    expect(withProfile.body).toContain('data-testid="profile-blocks-open"')
    expect(withProfile.body).toContain(`href="/user/${TARGET_UID}/blocks"`)

    const notCreated = render(Profile, {
      props: {
        uid: TARGET_UID,
        initial: {
          profile: null,
          isOwn: false,
          visibility: 'nobody',
          notCreated: true,
          canEdit: false,
          canDeleteProfile: false,
          canDeleteSeed: false,
          fullBlock: null,
          blocks: [],
          canReadBlocks: true,
          canBlock: false,
        },
      },
    })
    expect(notCreated.body).toContain('data-testid="profile-not-created"')
    expect(notCreated.body).toContain('data-testid="profile-blocks-open"')
    expect(notCreated.body).toContain(`href="/user/${TARGET_UID}/blocks"`)
  })
})

describe('BlocksFiltersForm.svelte — пикер пользователей', () => {
  test('при переданном uid кнопка выбора пользователей заблокирована; без uid и с правом — активна', () => {
    const locked = render(BlocksFiltersForm, {
      props: {
        uid: TARGET_UID,
        canSeeDeleted: true,
        canSeeLive: true,
        canPickUsers: true,
        initial: { ord: 'created-desc', state: 'all', scopes: [], uids: [], size: 30 },
      },
    })
    expect(locked.body).toContain('data-testid="blocks-filters-uid-locked-hint"')
    expect(locked.body).toMatch(/disabled[^>]*data-testid="blocks-filters-pick-users"|data-testid="blocks-filters-pick-users"[^>]*disabled/)

    const globalUnlocked = render(BlocksFiltersForm, {
      props: {
        uid: null,
        canSeeDeleted: true,
        canSeeLive: true,
        canPickUsers: true,
        initial: { ord: 'created-desc', state: 'all', scopes: ['auth'], uids: [], size: 30 },
      },
    })
    expect(globalUnlocked.body).not.toContain('data-testid="blocks-filters-uid-locked-hint"')
    expect(globalUnlocked.body).toContain('/users/pick?')
  })
})

describe('BlockForm.svelte — глобальный vs персональный и read-only без отправки', () => {
  test('глобальный edit показывает переданный id пользователя (disabled, без name) и кнопку профиля; при переданном uid блок скрыт', () => {
    const globalEdit = render(BlockForm, {
      props: {
        mode: 'edit',
        uid: null,
        blockId: BLOCK_ID,
        initialEdit: {
          contextUid: null,
          blockId: BLOCK_ID,
          enabled: true,
          detail: baseDetail,
          fact: null,
        },
      },
    })
    expect(globalEdit.body).toContain('data-testid="block-form-target-user"')
    expect(globalEdit.body).toContain(`value="${TARGET_UID}"`)
    expect(globalEdit.body).toContain(`href="/user/${TARGET_UID}"`)
    expect(globalEdit.body).toContain('data-testid="block-save-submit"')
    expect(globalEdit.body).toContain('name="__form_id" value="user-block-form"')

    // Извлекаем тег визуального поля целевого пользователя и убеждаемся, что у него нет атрибута name=
    const targetInputTag = globalEdit.body.match(/<input[^>]*data-testid="block-target-id-input"[^>]*>/)?.[0] ?? ''
    expect(targetInputTag).toBeTruthy()
    expect(targetInputTag).toContain('disabled')
    expect(targetInputTag).not.toContain('name=')

    const scopedEdit = render(BlockForm, {
      props: {
        mode: 'edit',
        uid: TARGET_UID,
        blockId: BLOCK_ID,
        initialEdit: {
          contextUid: TARGET_UID,
          blockId: BLOCK_ID,
          enabled: true,
          detail: baseDetail,
          fact: null,
        },
      },
    })
    expect(scopedEdit.body).not.toContain('data-testid="block-form-target-user"')
  })

  test('read-only зритель (canSubmit = false) видит карточку без кнопок отправки и снятия', () => {
    const readOnly = render(BlockForm, {
      props: {
        mode: 'edit',
        uid: null,
        blockId: BLOCK_ID,
        initialEdit: {
          contextUid: null,
          blockId: BLOCK_ID,
          enabled: true,
          detail: {
            ...baseDetail,
            canSubmit: false,
            canEditReason: false,
            canEditUntil: false,
            canDelete: false,
          },
          fact: null,
        },
      },
    })
    expect(readOnly.body).toContain('Просмотр блокировки')
    expect(readOnly.body).toContain('data-readonly')
    expect(readOnly.body).toContain('data-testid="block-until-readonly"')
    expect(readOnly.body).toContain('data-testid="block-reason-readonly"')
    expect(readOnly.body).not.toContain('data-testid="block-save-submit"')
    expect(readOnly.body).not.toContain('data-testid="block-lift-submit"')
    expect(readOnly.body).not.toContain('data-testid="block-delete-open"')
  })
})

describe('BlockDelete.svelte — условный чекбокс hard', () => {
  test('чекбокс hard отсутствует без canHardDelete и рендерится при canHardDelete = true', () => {
    const softOnly = render(BlockDelete, {
      props: {
        blockId: BLOCK_ID,
        uid: TARGET_UID,
        initial: {
          contextUid: TARGET_UID,
          blockId: BLOCK_ID,
          enabled: true,
          detail: { ...baseDetail, canHardDelete: false },
          holdSeconds: 2,
          fact: null,
        },
      },
    })
    expect(softOnly.body).toContain('data-testid="block-delete-submit"')
    expect(softOnly.body).not.toContain('data-testid="block-delete-hard-option"')

    const withHard = render(BlockDelete, {
      props: {
        blockId: BLOCK_ID,
        uid: TARGET_UID,
        initial: {
          contextUid: TARGET_UID,
          blockId: BLOCK_ID,
          enabled: true,
          detail: { ...baseDetail, canHardDelete: true },
          holdSeconds: 2,
          fact: null,
        },
      },
    })
    expect(withHard.body).toContain('data-testid="block-delete-hard-option"')
    expect(withHard.body).toContain('name="hard"')
  })
})

describe('BlockForm.svelte (create 1 + 3) — multiselect предзаполнения, гейт пикера и HoldButton при N > 1', () => {
  const TARGET_UID_2 = '55555555-5555-4555-8555-555555555555'

  test('при N = 1 рендерится обычная кнопка отправки и multiselect с выбранным UUID, а при N > 1 — HoldButton (data-mass-hold="true")', () => {
    const singleTarget = render(BlockForm, {
      props: {
        mode: 'create',
        uid: null,
        initialSubjects: [TARGET_UID],
        initialCreate: {
          uid: null,
          enabled: true,
          canCreate: true,
          canPickUsers: true,
          assignableScopes: ['auth', 'profile.delete'],
          holdSeconds: 2,
          fact: null,
        },
      },
    })
    expect(singleTarget.body).toContain('name="subjects"')
    expect(singleTarget.body).toContain(`value="${TARGET_UID}"`)
    expect(singleTarget.body).toContain('data-testid="block-create-pick-user"')
    expect(singleTarget.body).toContain('data-testid="block-create-submit"')
    expect(singleTarget.body).not.toContain('data-mass-hold="true"')

    const multiTarget = render(BlockForm, {
      props: {
        mode: 'create',
        uid: null,
        initialSubjects: [TARGET_UID, TARGET_UID_2],
        initialCreate: {
          uid: null,
          enabled: true,
          canCreate: true,
          canPickUsers: false,
          assignableScopes: ['auth', 'profile.delete'],
          holdSeconds: 2,
          fact: null,
        },
      },
    })
    expect(multiTarget.body).toContain(`value="${TARGET_UID}"`)
    expect(multiTarget.body).toContain(`value="${TARGET_UID_2}"`)
    expect(multiTarget.body).not.toContain('data-testid="block-create-pick-user"')
    expect(multiTarget.body).toContain('data-mass-hold="true"')
    expect(multiTarget.body).toContain('(2)')
  })
})

