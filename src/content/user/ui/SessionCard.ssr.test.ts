import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import SessionCard from './SessionCard.svelte'
import SessionRow from './SessionRow.svelte'
import type { SessionDetail, SessionDeviceView } from '../types.js'

// Строка и карточка живут на механиках ссылок и форм: в SSR-тесте без
// ModalHost модальную ссылку заменяет заглушка, `asLink` строит `href`.
vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href }),
  useModalLink: () => () => ({ href: '/', 'data-modal-link': '' }),
}))

const device: SessionDeviceView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: '22222222-2222-4222-8222-222222222222',
  deviceName: 'Ноутбук',
  subnetHash: 'abcdef0123456789',
  country: 'RU',
  history: [{ hash: 'fedcba9876543210', country: 'SG', at: 1 }],
  createdAt: 1_700_000_000_000,
  expiresAt: 4_000_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  deletedAt: null,
  current: true,
}

const detail: SessionDetail = { session: device, canRename: true, canRevoke: true, canHardDelete: false }

describe('SessionRow', () => {
  test('показывает устройство, бейдж текущего и короткий префикс сети', () => {
    const { body } = render(SessionRow, { props: { item: device } })
    expect(body).toContain('Ноутбук')
    expect(body).toContain('Это устройство')
    expect(body).toContain('Активна')
    expect(body).toContain('abcdef01')
    expect(body).not.toContain('abcdef0123456789')
    expect(body).toContain('сеть менялась')
  })

  test('истёкшая и отозванная строка называются по-разному', () => {
    const expired = render(SessionRow, {
      props: { item: { ...device, expiresAt: 1 }, now: 2 },
    })
    expect(expired.body).toContain('Истекла')
    const revoked = render(SessionRow, { props: { item: { ...device, deletedAt: 5 } } })
    expect(revoked.body).toContain('Завершена')
  })

  test('секретов строки в разметке нет', () => {
    const { body } = render(SessionRow, { props: { item: device } })
    expect(body).not.toContain('jti')
    expect(body).not.toContain('version')
  })
})

describe('SessionCard', () => {
  test('переименование и отзыв — те же формы, что у списка, без jti', () => {
    const { body } = render(SessionCard, { props: { detail } })
    expect(body).toContain('Название устройства')
    expect(body).toContain(`action="/user/sessions/${device.id}?/rename"`)
    expect(body).toContain('action="/user/sessions?/revoke"')
    expect(body).toContain('Заблокировать это устройство')
    expect(body).toContain('Прежние сети')
    expect(body).not.toContain('jti')
  })

  test('без прав нет ни переименования, ни отзыва', () => {
    const { body } = render(SessionCard, {
      props: { detail: { ...detail, canRename: false, canRevoke: false } },
    })
    expect(body).not.toContain('Название устройства')
    expect(body).not.toContain('action="/user/sessions?/revoke"')
    expect(body).toContain('Ноутбук')
  })

  test('ошибка переименования показывается текстом, а не молчанием', () => {
    const { body } = render(SessionCard, { props: { detail, notice: 'rename-failed' } })
    expect(body).toContain('Не удалось переименовать устройство')
  })
})
