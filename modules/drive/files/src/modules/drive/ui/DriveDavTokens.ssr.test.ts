import { describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { DriveOperationData } from '../types.js'
import DriveDavTokens from './DriveDavTokens.svelte'

// `asLink` читает адрес приложения; без хоста модалок этого контекста нет.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/user/config/dav'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))

const data = (patch: Partial<DriveOperationData> = {}): DriveOperationData => ({
  enabled: true,
  fact: null,
  returnTo: '/user/config/dav',
  action: '/user/config/dav/issue',
  parentId: null,
  parent: null,
  node: null,
  caps: { canRead: true, canWrite: true, canShare: true },
  shares: [],
  subjectOptions: [],
  storageError: null,
  davEnabled: true,
  tokens: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      label: 'Ноутбук',
      prefix: 'abcdef0123456789',
      createdAt: new Date('2026-01-01T10:00:00Z'),
      lastUsedAt: new Date('2026-01-02T10:00:00Z'),
      revokedAt: null,
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      label: 'Старый диск',
      prefix: '0011223344556677',
      createdAt: new Date('2025-12-01T10:00:00Z'),
      lastUsedAt: null,
      revokedAt: new Date('2025-12-02T10:00:00Z'),
    },
  ],
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
  ...patch,
})

describe('DriveDavTokens SSR', () => {
  it('список, префиксы и отзыв только у активного пароля — ссылками', () => {
    const { body } = render(DriveDavTokens, { props: { initial: data() } })
    expect(body).toContain('Ноутбук')
    expect(body).toContain('dv1_abcdef0123456789_…')
    expect(body).toContain('Старый диск')
    expect(body).toContain('отозван')
    expect(body.match(/Отозвать/g)).toHaveLength(1)
    // Операции живут на своих маршрутах, а не на `?/revoke` этой страницы.
    expect(body).toContain('/user/config/dav/revoke')
    expect(body).toContain('/user/config/dav/issue')
    expect(body).not.toContain('?/revoke')
    expect(body).toContain('11111111-1111-4111-8111-111111111111')
    expect(body).toContain('/api/dav/')
    expect(body).toContain('любой')
  })

  it('GET не выдаёт и не показывает секрет', () => {
    const { body } = render(DriveDavTokens, { props: { initial: data() } })
    expect(body).toContain('Создать пароль')
    expect(body).not.toContain('Пароль создан')
    expect(body).not.toContain('dv1_abcdef0123456789_secret')
  })

  it('пустой список — подсказка, выдача всё равно доступна', () => {
    const { body } = render(DriveDavTokens, { props: { initial: data({ tokens: [] }) } })
    expect(body).toContain('Паролей ещё нет')
    expect(body).toContain('Создать пароль')
  })

  it('выключенный WebDAV показывает сообщение вместо выдачи', () => {
    const { body } = render(DriveDavTokens, {
      props: { initial: data({ davEnabled: false, tokens: [] }) },
    })
    expect(body).toContain('Пароли WebDAV выключены')
    expect(body).not.toContain('Создать пароль')
  })
})
