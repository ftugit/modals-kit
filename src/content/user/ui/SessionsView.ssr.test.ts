import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import SessionsView from './SessionsView.svelte'
import type { SessionsPage } from '../types.js'
import { vi } from 'vitest'

vi.mock('#hooks/links/index.js', () => ({ asLink: (href: string) => ({ href }) }))

const page: SessionsPage = {
  items: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      authId: '22222222-2222-4222-8222-222222222222',
      deviceName: 'Ноутбук',
      subnetHash: 'abcdef0123456789',
      country: 'RU',
      history: [{ hash: 'abcdef0123456789', country: 'RU', at: 1 }],
      createdAt: 1_700_000_000_000,
      expiresAt: 4_000_000_000_000,
      lastSeenAt: 1_700_000_100_000,
      deletedAt: null,
      current: true,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 30,
  authId: '22222222-2222-4222-8222-222222222222',
  journal: false,
  state: 'active',
  canSeeDeleted: false,
  canRename: true,
  canRevoke: true,
  canHardDelete: false,
}

describe('SessionsView', () => {
  test('ссылка на следующую страницу доступна в SSR', () => {
    const { body } = render(SessionsView, { props: { page: { ...page, total: 31 } } })
    expect(body).toContain('href="/user/sessions?page=2"')
    expect(body).toContain('Страница 1 из 2')
  })

  test('на последней странице доступна ссылка назад без JavaScript', () => {
    const { body } = render(SessionsView, { props: { page: { ...page, page: 2, total: 31 } } })
    expect(body).toContain('href="/user/sessions?page=1"')
    expect(body).toContain('Страница 2 из 2')
    expect(body).not.toContain('href="/user/sessions?page=3"')
  })

  test('пустая страница за пределами списка не объявляет все сессии отсутствующими', () => {
    const { body } = render(SessionsView, { props: { page: { ...page, items: [], page: 999, total: 1 } } })
    expect(body).toContain('На этой странице сессий нет.')
    expect(body).not.toContain('Активных сессий нет.')
    expect(body).toContain('href="/user/sessions?page=1"')
    expect(body).not.toContain('data-testid="sessions-revoke-others"')
  })

  test('просроченная сессия в SSR помечена как истёкшая, отозванная — как завершённая', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    try {
      const expired = { ...page.items[0], expiresAt: Date.now() - 1 }
      const revoked = { ...expired, id: '33333333-3333-4333-8333-333333333333', deletedAt: Date.now() - 1 }
      const { body } = render(SessionsView, { props: { page: { ...page, items: [expired, revoked], total: 2 } } })
      expect(body).toContain('Истекла')
      expect(body).toContain('Завершена')
    } finally {
      vi.useRealTimers()
    }
  })

  test('показывает устройство и не печатает полный хеш подсети', () => {
    const { body } = render(SessionsView, { props: { page, variant: 'card' } })
    expect(body).toContain('Сессии')
    expect(body).toContain('Ноутбук')
    expect(body).toContain('Это устройство')
    expect(body).toContain('abcdef01')
    expect(body).not.toContain('abcdef0123456789')
    expect(body).toContain('action="/user/sessions?/revoke"')
    expect(body).toContain('Заблокировать это устройство')
    expect(body).not.toContain('jti')
  })
})
