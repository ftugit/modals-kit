import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { DriveDavTokensData } from '../types.js'
import DriveDavTokens from './DriveDavTokens.svelte'

const data = (patch: Partial<DriveDavTokensData> = {}): DriveDavTokensData => ({
  enabled: true,
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
  issued: null,
  fact: null,
  notice: null,
  ...patch,
})

describe('DriveDavTokens SSR', () => {
  it('показывает список, префиксы и отзыв только у активного пароля', () => {
    const { body } = render(DriveDavTokens, {
      props: { initial: data(), actionBase: '/user/config/dav', returnTo: '/user/config' },
    })
    expect(body).toContain('Ноутбук')
    expect(body).toContain('dv1_abcdef0123456789_…')
    expect(body).toContain('Старый диск')
    expect(body).toContain('отозван')
    expect(body.match(/Отозвать/g)).toHaveLength(1)
    expect(body).toContain('?/revoke')
    // Скрытые поля обязаны быть в DOM: без JS сервер иначе отвергнет форму.
    expect(body).toContain('name="return_to"')
    expect(body).toContain('name="token_id"')
    expect(body).toContain('11111111-1111-4111-8111-111111111111')
  })

  it('секрет показывается один раз и копируется', () => {
    const { body } = render(DriveDavTokens, {
      props: {
        initial: data({ issued: 'dv1_abcdef0123456789_secretsecretsecretsecretsecret' }),
        actionBase: '/user/config/dav',
        returnTo: '/user/config',
      },
    })
    expect(body).toContain('Пароль создан')
    expect(body).toContain('повторно пароль не покажется')
    expect(body).toContain('dv1_abcdef0123456789_secretsecretsecretsecretsecret')
  })

  it('без ключа подписи выдача выключена, список остаётся', () => {
    const { body } = render(DriveDavTokens, {
      props: { initial: data({ enabled: false }), actionBase: '/user/config/dav', returnTo: '/user/config' },
    })
    expect(body).toContain('drive-dav-disabled')
    expect(body).not.toContain('Создать пароль')
    expect(body).toContain('Ноутбук')
  })
})
