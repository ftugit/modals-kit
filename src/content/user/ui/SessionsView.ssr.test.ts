import { render } from 'svelte/server'
import { describe, expect, test } from 'vitest'
import SessionsView from './SessionsView.svelte'
import type { SessionsPage } from '../types.js'

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
