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
vi.mock('../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { get principal() { return device.authId }, clear: () => {} },
}))
// Шаг подтверждения живёт в адресе: тест подменяет его до рендера.
const addr = vi.hoisted(() => ({ url: new URL('http://localhost/user/sessions/11111111-1111-4111-8111-111111111111') }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
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
/** Значение скрытого поля набора: `ids` в разметке, а не любое совпадение id. */
const idsOf = (body: string): string | undefined =>
  /<input value="([^"]*)"[^>]*name="ids"/.exec(body)?.[1]

const other: SessionDetail = {
  session: { ...device, current: false },
  canRename: true,
  canRevoke: true,
  canHardDelete: false,
}

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
  test('переименование на месте, секретов строки нет', () => {
    const { body } = render(SessionCard, { props: { detail } })
    expect(body).toContain('Название устройства')
    expect(body).toContain(`action="/user/sessions/${device.id}?/rename"`)
    expect(body).toContain('Прежние сети')
    expect(body).not.toContain('jti')
  })

  test('свою текущую сессию в карточке закрыть нельзя — для неё есть выход', () => {
    // Две кнопки с одним смыслом в разных местах расходятся поведением:
    // закрыть текущую сессию можно выходом из аккаунта.
    addr.url = new URL(`http://localhost/user/sessions/${device.id}`)
    const { body } = render(SessionCard, { props: { detail } })
    expect(body).not.toContain('data-testid="session-card-revoke"')
    expect(body).not.toContain('data-testid="session-card-exit"')

    // Позитивный контроль: не текущая строка закрывается.
    const closable = render(SessionCard, { props: { detail: other } })
    expect(closable.body).toContain('data-testid="session-card-revoke"')
    expect(closable.body).toContain(`?session.exit=confirm`)
  })

  test('подтверждение: набор из одной строки, удержания нет', () => {
    addr.url = new URL(`http://localhost/user/sessions/${device.id}?session.exit=confirm`)
    const { body } = render(SessionCard, { props: { detail: other } })

    expect(body).toContain('data-testid="session-card-exit"')
    expect(body).toContain('action="/user/sessions?/others"')
    // Набор — ровно эта строка: скрытое поле `ids`, а не совпадение id где-то
    // в разметке (форма переименования несёт тот же id в своём поле).
    expect(idsOf(body)).toBe(device.id)
    expect(body).toContain('value="only"')
    // Одна запись: подтверждать удержанием нечего.
    expect(body).not.toContain('data-mass-hold="true"')
    expect(body).toContain('data-testid="session-card-exit-submit"')
    expect(body).not.toContain('data-testid="session-card-revoke"')
    addr.url = new URL(`http://localhost/user/sessions/${device.id}`)
  })

  test('чужая сессия закрывается экшеном чужого аккаунта', () => {
    addr.url = new URL(`http://localhost/user/sessions/${device.id}?session.exit=confirm`)
    const foreign = render(SessionCard, {
      props: { detail: { ...other, session: { ...other.session, authId: '99999999-9999-4999-8999-999999999999' } } },
    })
    expect(foreign.body).toContain('action="/user/99999999-9999-4999-8999-999999999999/sessions?/others"')
    addr.url = new URL(`http://localhost/user/sessions/${device.id}`)
  })

  test('без прав нет ни переименования, ни закрытия', () => {
    addr.url = new URL(`http://localhost/user/sessions/${device.id}`)
    const { body } = render(SessionCard, {
      props: { detail: { ...other, canRename: false, canRevoke: false } },
    })
    expect(body).not.toContain('Название устройства')
    expect(body).not.toContain('data-testid="session-card-revoke"')
    expect(body).toContain('Ноутбук')
  })

  test('отозванную строку закрывать нечем', () => {
    const { body } = render(SessionCard, {
      props: { detail: { ...other, session: { ...other.session, deletedAt: 5 } } },
    })
    expect(body).toContain('Завершена')
    expect(body).not.toContain('data-testid="session-card-revoke"')
  })

  test('ошибка переименования показывается текстом, а не молчанием', () => {
    const { body } = render(SessionCard, { props: { detail, notice: 'rename-failed' } })
    expect(body).toContain('Не удалось переименовать устройство')
  })
})
