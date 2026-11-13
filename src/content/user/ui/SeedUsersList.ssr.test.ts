import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import SeedUsersList from './SeedUsersList.svelte'
import type { SeedUserView } from '../types.js'
import { seedUsersSnapshot, type SeedUsersRouteData } from './seed-users/source.js'

// P0-6: вход в журнал из списка аккаунтов рождается в SSR по флагу `load`,
// а не только после гидратации `useGrants`. Носители модалок/адреса в SSR
// заменяются заглушками с тем же видимым итогом (`href` пары).
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
  preloadData: async () => ({ type: 'not_found' }),
}))
vi.mock('$app/env', () => ({ browser: false }))
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/users'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('#hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/links/index.js')>()
  const routes = await import('../routes.js')
  return {
    ...actual,
    useModalLink: () => (name: string, params: { id?: string } = {}) => {
      if (name === 'user.sessions.journal') {
        return { href: routes.sessionsJournalRoute.href(), 'data-modal-link': '' }
      }
      if (name === 'user.profile') {
        return { href: `/user/${params.id ?? ''}`, 'data-modal-link': '' }
      }
      return { href: '/', 'data-modal-link': '' }
    },
  }
})
vi.mock('#lib/paginate/sveltekit/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/paginate/sveltekit/router.js')>()
  return {
    ...actual,
    currentPathname: () => '/users',
    currentSearch: () => ({}),
  }
})

const user: SeedUserView = {
  id: '11111111-1111-4111-8111-111111111111',
  seed: 'seed-demo-0000000000000000000000000000000000000',
  permissions: [],
  blocked: [],
  createdAt: 1_700_000_000_000,
  deletedAt: null,
}

function routeData(canReadSessions: boolean): SeedUsersRouteData {
  return {
    snapshot: seedUsersSnapshot({
      items: [user],
      total: 1,
      page: 1,
      pageSize: 30,
      canSeeDeleted: false,
      canSeeNickname: false,
      canReadSessions,
    }),
    fact: null,
    enabled: true,
    canSeeDeleted: false,
    canSeeNickname: false,
    canReadSessions,
  }
}

describe('SeedUsersList: вход в журнал из SSR-флага load', () => {
  test('canReadSessions=true — ссылка на журнал есть в HTML без JS', () => {
    const { body } = render(SeedUsersList, { props: { initial: routeData(true), url: false } })
    // Список действительно отрисован: отсутствие кнопки не должно быть пустым экраном.
    expect(body).toContain('data-testid="seed-user-row"')
    expect(body).toContain('data-testid="seed-users-sessions-open"')
    expect(body).toContain('href="/sessions"')
    expect(body).toContain('data-modal-link')
  })

  test('canReadSessions=false — входа в журнал нет, строки списка на месте', () => {
    const { body } = render(SeedUsersList, { props: { initial: routeData(false), url: false } })
    expect(body).toContain('data-testid="seed-user-row"')
    expect(body).not.toContain('data-testid="seed-users-sessions-open"')
  })
})
