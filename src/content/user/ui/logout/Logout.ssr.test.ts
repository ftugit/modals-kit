import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import Logout from './Logout.svelte'

// Адрес — тот, что видит страница: шаг подтверждения компонент читает из
// query, поэтому тест подменяет его до рендера.
const addr = vi.hoisted(() => ({ url: new URL('http://localhost/user/logout') }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
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

const count = (body: string): string => {
  const m = /data-testid="logout-exit-count"[^>]*>.*?<strong>([^<]*)<\/strong>/.exec(body)
  return m ? m[1]! : ''
}

describe('Logout: выход как набор сессий', () => {
  test('сводка: одна текущая сессия, удержания нет, есть локальный выход', () => {
    addr.url = new URL('http://localhost/user/logout')
    const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })

    expect(body).toContain('data-testid="logout"')
    expect(body).toContain('data-testid="logout-exit"')
    // Снятый чекбокс — закрывается одна текущая сессия: подтверждать
    // удержанием нечего.
    expect(count(body)).toBe('1')
    expect(body).not.toContain('data-mass-hold="true"')
    expect(body).toContain('data-testid="logout-exit-next"')
    expect(body).toContain('href="/user/logout?logout.step=confirm"')
    expect(body).toContain('data-testid="logout-local"')
    // Чекбокс — на шаге подтверждения: сводка только называет размер набора.
    expect(body).not.toContain('name="include_current"')
  })

  test('подтверждение: отправка и «назад», локальный выход убран', () => {
    addr.url = new URL('http://localhost/user/logout?logout.step=confirm')
    const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })

    expect(body).toContain('data-testid="logout-exit-submit"')
    expect(body).toContain('Выйти на всех устройствах')
    expect(body).toContain('name="include_current"')
    expect(body).toContain('name="spread"')
    expect(body).toContain('value="1"')
    expect(body).toContain(`value="${SESSION}"`)
    // Локальный выход — другой сценарий, в подтверждении он только мешает.
    expect(body).not.toContain('data-testid="logout-local"')
    addr.url = new URL('http://localhost/user/logout')
  })

  test('адрес экшена абсолютный и не зависит от страницы-носителя', () => {
    // Модалка `user.logout` открывается поверх любого маршрута, поэтому POST
    // уходит на экшен роута выхода, а не на `./` текущей страницы: у носителя
    // своих экшенов нет, и относительный адрес давал бы 405.
    for (const base of [
      'http://localhost/user/logout',
      'http://localhost/user/menu?modal=user.logout',
      'http://localhost/',
    ]) {
      const confirm = new URL(base)
      confirm.searchParams.set('logout.step', 'confirm')
      addr.url = confirm
      const { body } = render(Logout, { props: { sessionId: SESSION, total: 3 } })
      expect(body, `подтверждение на ${base}`).toContain('action="/user/logout?/exit"')

      addr.url = new URL(base)
      const local = render(Logout, { props: { sessionId: SESSION, total: 3 } })
      expect(local.body, `локальный выход на ${base}`).toContain('action="/user/logout?/local"')
    }
    addr.url = new URL('http://localhost/user/logout')
  })

  test('без актора набор не рисуется — остаётся локальный выход', () => {
    addr.url = new URL('http://localhost/user/logout')
    const { body } = render(Logout, { props: { sessionId: null, total: 0, canRevoke: false } })

    expect(body).not.toContain('data-testid="logout-exit"')
    expect(body).toContain('data-testid="logout-local"')
    expect(body).toContain('Сессию прочитать не удалось')
  })

  test('модалка: шаг локальный, fallback ведёт на страницу выхода, а не на носитель', () => {
    addr.url = new URL('http://localhost/user/menu?modal=user.logout&logout.step=confirm')
    const { body } = render(Logout, { props: { mode: 'modal', sessionId: SESSION, total: 3 } })
    expect(body).toContain('data-testid="logout-exit-next"')
    expect(body).toContain('href="/user/logout?logout.step=confirm"')
    expect(body).not.toContain('data-testid="logout-exit-submit"')
    expect(body).toContain('data-testid="logout-local"')
    expect(body).not.toContain('/user/menu?logout.step')
    addr.url = new URL('http://localhost/user/logout')
  })
})
