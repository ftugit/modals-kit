import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { DriveOperationData } from '../../types.js'
import Fixture from './DriveOperationPage.test.svelte'

// `Acl` строит ссылку входа через `useModalLink`; без хоста модалок этого
// контекста нет, как и в других SSR-тестах модуля.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/drive/mkdir'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({ goto: async () => {} }))
vi.mock('#core/hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => () => ({ href: '/user/auth', 'data-modal-link': '' }),
  }
})

const data = (fact: DriveOperationData['fact']): DriveOperationData => ({
  enabled: true,
  fact,
  returnTo: '/drive?drive=2',
  action: '/drive/mkdir',
  parentId: null,
  parent: null,
  node: null,
  caps: { canRead: true, canWrite: true, canShare: true },
  shares: [],
  subjectOptions: [],
  tokens: [],
  storageError: null,
  davEnabled: true,
  values: {
    name: '',
    targetId: null,
    targetLabel: 'Корень диска',
    starred: false,
    subjects: [],
    uid: '',
    role: 'viewer',
    tokenId: '',
    label: '',
  },
  quota: { used: 0, limit: 0, remaining: 0 },
})

describe('DriveOperationPage', () => {
  // `auth.required` не входит в `AuthErrorCode`: гость от загрузчика получает
  // `auth.forbidden` — реальный fact страницы операции.
  it('при fact гостя показывает Acl, а не контрол операции', () => {
    const { body } = render(Fixture, { props: { data: data('auth.forbidden') } })
    expect(body).not.toContain('data-testid="op-field"')
    expect(body).not.toContain('Сохранить')
    expect(body).toContain('data-acl-code="auth_required"')
  })

  it('без fact показывает контрол операции', () => {
    const { body } = render(Fixture, { props: { data: data(null) } })
    expect(body).toContain('data-testid="op-field"')
    expect(body).toContain('Сохранить')
    expect(body).not.toContain('data-acl-code=')
  })
})
