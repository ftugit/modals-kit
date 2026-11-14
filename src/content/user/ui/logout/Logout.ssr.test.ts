import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import Logout from './Logout.svelte'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/user/logout'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
  preloadData: async () => ({ type: 'not_found' }),
}))
vi.mock('$app/env', () => ({ browser: false }))
vi.mock('../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { clear: () => {} },
}))

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Logout: выход через вариант удаления', () => {
  test('рендерит SessionDelete с вариантом logout', () => {
    const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })
    expect(body).toContain('data-testid="session-delete-form"')
    expect(body).toContain('session-delete-submit')
    expect(body).toContain('Выйти')
  })

  test('чекбокс «закрыть все сессии» на одном экране', () => {
    const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })
    expect(body).toContain('Закрыть все сессии')
  })

  test('адрес экшена абсолютный', () => {
    const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })
    expect(body).toContain('action="/user/logout?/exit"')
  })

  test('без актора — локальный выход остаётся', () => {
    const { body } = render(Logout, { props: { sessionId: null, total: 0, canRevoke: false } })
    expect(body).toContain('data-testid="session-delete-local"')
  })
})
