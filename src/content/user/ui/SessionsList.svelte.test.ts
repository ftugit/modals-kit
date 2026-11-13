// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SessionsList from './SessionsList.svelte'
import type { SessionDeviceView, SessionsRouteData } from '../types.js'
import { sessionsSnapshot } from './sessions-list/source.js'
import { resetClientStore } from '#lib/paginate/index.js'

const addr = vi.hoisted(() => ({ url: new URL('http://localhost/users?modal=user.sessions') }))
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
vi.mock('$app/env', () => ({ browser: true }))
vi.mock('#hooks/links/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#hooks/links/index.js')>()),
  useModalLink: () => (name: string, params: { id?: string; uid?: string } = {}) => ({
    href: name === 'user.session' ? `/user/sessions/${params.id ?? ''}` : '/user/sessions',
    'data-modal-link': '',
  }),
}))
vi.mock('../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { get principal() { return device.authId }, clear: () => {} },
}))
vi.mock('#lib/paginate/sveltekit/router.js', () => ({
  currentPathname: () => '/users',
  currentSearch: () => ({}),
}))
// В модалке шаг не читает и не пишет адрес носителя.
vi.mock('#lib/address/sveltekit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/address/sveltekit.js')>()),
  visibleAddress: () => { throw new Error('modal step must not read carrier address') },
  writeAddress: () => { throw new Error('modal step must not write carrier address') },
}))

const device: SessionDeviceView = {
  id: '11111111-1111-4111-8111-111111111111',
  authId: '22222222-2222-4222-8222-222222222222',
  deviceName: 'Ноутбук', subnetHash: 'abcdef0123456789', country: 'RU', history: [],
  createdAt: 1_700_000_000_000, expiresAt: 4_000_000_000_000, lastSeenAt: 1_700_000_100_000,
  deletedAt: null, current: true,
}
const other: SessionDeviceView = { ...device, id: '33333333-3333-4333-8333-333333333333', deviceName: 'Планшет', current: false }

function routeData(items: SessionDeviceView[]): SessionsRouteData {
  return {
    snapshot: sessionsSnapshot({
      items, total: items.length, page: 1, pageSize: 30, authId: device.authId, journal: false,
      canReadOthers: false, state: 'active', countries: ['RU'], canSeeDeleted: false,
      canRename: true, canRevoke: true, canHardDelete: false,
    }),
    fact: null, enabled: true, target: { kind: 'own' }, canReadOthers: false, countries: ['RU'],
    notice: null, canSeeDeleted: false, canRename: true, canRevoke: true, canHardDelete: false,
  }
}
function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

beforeEach(() => {
  resetClientStore()
  addr.url = new URL('http://localhost/users?modal=user.sessions')
})

describe('SessionsList: локальный шаг модалки', () => {
  it('подтверждение и возврат не пишут адрес носителя; новый слой стартует со сводки', async () => {
    const before = addr.url.href
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(SessionsList, { target, props: { mode: 'modal', url: false, initial: routeData([device, other]) } })
    try {
      await tick()
      const toggle = target.querySelector('[data-testid="sessions-revoke-others"]')!
      expect(toggle).toBeTruthy()
      click(toggle)
      await tick()
      expect(target.querySelector('[data-testid="bulk-exit"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
      const back = target.querySelector('[data-testid="bulk-exit-back"]')!
      click(back)
      await tick()
      expect(target.querySelector('[data-testid="bulk-exit"]')).toBeNull()
      expect(target.querySelector('[data-testid="sessions-revoke-others"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app)
      target.remove()
    }
    const target2 = document.createElement('div')
    document.body.append(target2)
    const app2 = mount(SessionsList, { target: target2, props: { mode: 'modal', url: false, initial: routeData([device, other]) } })
    try {
      await tick()
      expect(target2.querySelector('[data-testid="bulk-exit"]')).toBeNull()
      expect(target2.querySelector('[data-testid="sessions-revoke-others"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app2)
      target2.remove()
    }
  })
})
