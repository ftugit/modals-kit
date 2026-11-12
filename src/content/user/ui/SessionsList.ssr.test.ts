import { render } from 'svelte/server'
import { describe, expect, test, vi } from 'vitest'
import SessionsList from './SessionsList.svelte'
import type { SessionDeviceView, SessionsRouteData } from '../types.js'
import { sessionsSnapshot } from './sessions-list/source.js'

// Носители и механики, которые в SSR-тесте заменяются заглушками: страница
// пагинатора, модальные ссылки и адрес. Список от них только берёт `href`.
vi.mock('$app/navigation', () => ({
  afterNavigate: () => {},
  beforeNavigate: () => {},
  goto: async () => {},
  preloadData: async () => ({ type: 'not_found' }),
}))
vi.mock('$app/env', () => ({ browser: false }))
// Адрес — тот, что видит страница: шаг подтверждения компонент читает из
// query, поэтому тест подменяет его до рендера.
const addr = vi.hoisted(() => ({ url: new URL('http://localhost/user/sessions') }))
// Параметры, с которыми список просит модалку: цель аккаунта обязана доезжать
// и до карточки строки, и до фильтров.
const links = vi.hoisted(() => ({ calls: [] as { name: string; params: Record<string, unknown> }[] }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('#hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/links/index.js')>()
  // Адреса — из реестра, как их собирает `modals.ts`: тест проверяет не строку
  // заглушки, а те же `href()` реестра.
  const routes = await import('../routes.js')
  return {
    ...actual,
    // В SSR-тесте хост модалок не смонтирован: ссылки получают адрес страницы.
    useModalLink: () => (name: string, params: { id?: string; uid?: string } = {}) => {
      links.calls.push({ name, params })
      if (name === 'user.session') {
        return {
          href: params.uid
            ? routes.userAccountSessionRoute.href({ id: params.uid, sessionId: params.id ?? '' })
            : routes.userSessionRoute.href({ id: params.id ?? '' }),
          'data-modal-link': '',
        }
      }
      return {
        href: params.uid
          ? `${routes.userSessionsFiltersRoute.href()}?uid=${encodeURIComponent(params.uid)}`
          : routes.userSessionsFiltersRoute.href(),
        'data-modal-link': '',
      }
    },
  }
})

vi.mock('#lib/paginate/sveltekit/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#lib/paginate/sveltekit/router.js')>()
  return {
    ...actual,
    currentPathname: () => '/user/sessions',
    currentSearch: () => ({}),
  }
})

const device: SessionDeviceView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: '22222222-2222-4222-8222-222222222222',
  deviceName: 'Ноутбук',
  subnetHash: 'abcdef0123456789',
  country: 'RU',
  history: [],
  createdAt: 1_700_000_000_000,
  expiresAt: 4_000_000_000_000,
  lastSeenAt: 1_700_000_100_000,
  deletedAt: null,
  current: true,
}

const other: SessionDeviceView = {
  ...device,
  id: '33333333-3333-4333-8333-333333333333',
  deviceName: 'Планшет',
  current: false,
}

function routeData(items: SessionDeviceView[], overrides: Partial<SessionsRouteData> = {}): SessionsRouteData {
  return {
    snapshot: sessionsSnapshot({
      items,
      total: items.length,
      page: 1,
      pageSize: 30,
      authId: device.authId,
      journal: false,
      canReadOthers: false,
      state: 'active',
      countries: ['RU'],
      canSeeDeleted: false,
      canRename: true,
      canRevoke: true,
      canHardDelete: false,
    }),
    fact: null,
    enabled: true,
    uid: null,
    journal: false,
    canReadOthers: false,
    countries: ['RU'],
    notice: null,
    canSeeDeleted: false,
    canRename: true,
    canRevoke: true,
    canHardDelete: false,
    ...overrides,
  }
}

describe('SessionsList', () => {
  test('рисует строку-ссылку в карточку и кнопку фильтров', () => {
    const { body } = render(SessionsList, { props: { initial: routeData([device]) } })
    expect(body).toContain('Ноутбук')
    expect(body).toContain(`href="/user/sessions/${device.id}"`)
    expect(body).toContain('data-testid="sessions-filters-open"')
    expect(body).toContain('Фильтры')
    expect(body).toContain('data-testid="session-row"')
    expect(body).not.toContain('jti')
  })

  test('«Заблокировать остальные» есть только когда есть другие устройства', () => {
    const many = render(SessionsList, { props: { initial: routeData([device, other]) } })
    expect(many.body).toContain('sessions-revoke-others')
    expect(many.body).toContain('Заблокировать остальные')

    const alone = render(SessionsList, { props: { initial: routeData([device]) } })
    expect(alone.body).not.toContain('sessions-revoke-others')
  })

  test('журнал: без «Заблокировать остальные», с входом в свои устройства', () => {
    const journal = render(SessionsList, {
      props: {
        journal: true,
        initial: routeData([device, other], { journal: true, canReadOthers: true }),
      },
    })
    expect(journal.body).toContain('data-testid="session-row"')
    expect(journal.body).toContain('data-testid="sessions-own-open"')
    expect(journal.body).not.toContain('sessions-revoke-others')

    // Свои устройства: право на чужие даёт вход в журнал.
    const own = render(SessionsList, {
      props: { initial: routeData([device, other], { canReadOthers: true }) },
    })
    expect(own.body).toContain('data-testid="sessions-journal-open"')
    expect(own.body).toContain('href="/sessions"')
    expect(own.body).toContain('sessions-revoke-others')
  })

  test('кнопка остальных ведёт на экран подтверждения, набор — строки списка', () => {
    // Шаг живёт в адресе: без JS переход — обычная ссылка, а набор берётся из
    // показанных строк, то есть из-под фильтра.
    addr.url = new URL('http://localhost/user/sessions')
    const start = render(SessionsList, { props: { initial: routeData([device, other]) } })
    expect(start.body).toContain('href="/user/sessions?sessions.exit=confirm"')
    expect(start.body).not.toContain('data-testid="bulk-exit"')

    addr.url = new URL('http://localhost/user/sessions?sessions.exit=confirm')
    const confirm = render(SessionsList, { props: { initial: routeData([device, other]) } })
    expect(confirm.body).toContain('data-testid="bulk-exit"')
    // Набор — все строки списка; текущую из него уберёт сервер по чекбоксу.
    // Чекбокс снят, значит закрывается одна запись и удержание не нужно.
    expect(confirm.body).toContain(`value="${device.id},${other.id}"`)
    expect(confirm.body).not.toContain('data-mass-hold="true"')
    expect(confirm.body).toContain('data-testid="bulk-exit-submit"')
    expect(confirm.body).toContain('Отменить')
    expect(confirm.body).toContain('href="/user/sessions"')
    addr.url = new URL('http://localhost/user/sessions')
  })

  test('свой список: карточка строки и фильтры — без цели', () => {
    links.calls.length = 0
    const { body } = render(SessionsList, { props: { initial: routeData([device]) } })
    const session = links.calls.find((c) => c.name === 'user.session')
    expect(session?.params).toEqual({ id: device.id })
    expect(body).toContain(`href="/user/sessions/${device.id}"`)

    const filters = links.calls.find((c) => c.name === 'user.sessions.filters')
    expect(filters?.params).toEqual({})
    expect(body).toContain('href="/user/sessions/filters"')
    expect(body).not.toContain('uid=')
  })

  test('чужой список: карточка строки и фильтры несут цель аккаунта', () => {
    // Иначе `user.session` дал бы fallback на свой путь, а фильтры в модалке
    // разрезали бы свои устройства: `from` там — адрес страницы-носителя.
    links.calls.length = 0
    const uid = device.authId
    const { body } = render(SessionsList, {
      props: { uid, initial: routeData([device], { uid }) },
    })
    const session = links.calls.find((c) => c.name === 'user.session')
    expect(session?.params).toEqual({ id: device.id, uid })
    expect(body).toContain(`href="/user/${uid}/sessions/${device.id}"`)

    const filters = links.calls.find((c) => c.name === 'user.sessions.filters')
    expect(filters?.params).toEqual({ uid })
    expect(body).toContain(`href="/user/sessions/filters?uid=${uid}"`)
  })

  test('вход в журнал только по праву на чужие устройства', () => {
    // Кнопка журнала ведёт на чужие сессии: без права на них её быть не должно,
    // в противном случае ссылка показывает заведомый отказ.
    const own = render(SessionsList, { props: { initial: routeData([device, other]) } })
    expect(own.body).not.toContain('data-testid="sessions-journal-open"')
    expect(own.body).not.toContain('href="/sessions"')

    const journal = render(SessionsList, {
      props: { journal: true, initial: routeData([device, other], { journal: true }) },
    })
    expect(journal.body).not.toContain('data-testid="sessions-journal-open"')

    // Позитивный контроль: право есть — вход появляется.
    const allowed = render(SessionsList, {
      props: { initial: routeData([device, other], { canReadOthers: true }) },
    })
    expect(allowed.body).toContain('data-testid="sessions-journal-open"')
    expect(allowed.body).toContain('href="/sessions"')
  })

  test('без права отзыва кнопки остальных нет', () => {
    const { body } = render(SessionsList, {
      props: { initial: routeData([device, other], { canRevoke: false }) },
    })
    expect(body).not.toContain('sessions-revoke-others')
  })
})
