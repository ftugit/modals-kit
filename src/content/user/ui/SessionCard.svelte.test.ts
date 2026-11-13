// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import SessionCard from './SessionCard.svelte'
import type { SessionDetail, SessionDeviceView } from '../types.js'

const addr = vi.hoisted(() => ({ url: new URL('http://localhost/users?modal=user.session') }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({ goto: async () => {}, preloadData: async () => ({ type: 'not_found' }) }))
vi.mock('#hooks/links/index.js', () => ({ asLink: (href: string) => ({ href }) }))
vi.mock('../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { get principal() { return device.authId }, clear: () => {} },
}))
// В модалке компонент не имеет права читать/писать адрес носителя ради шага.
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
  deletedAt: null, current: false,
}
const detail: SessionDetail = { session: device, canRename: true, canRevoke: true, canHardDelete: false }

function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

describe('SessionCard: локальный шаг модалки', () => {
  it('подтверждение и возврат не пишут адрес носителя; новый слой стартует со сводки', async () => {
    const before = addr.url.href
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(SessionCard, { target, props: { detail, mode: 'modal' } })
    try {
      await tick()
      const revoke = target.querySelector('[data-testid="session-card-revoke"]')!
      expect(revoke).toBeTruthy()
      click(revoke)
      await tick()
      expect(target.querySelector('[data-testid="session-card-exit-submit"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
      const back = target.querySelector('[data-testid="session-card-exit-back"]')!
      click(back)
      await tick()
      expect(target.querySelector('[data-testid="session-card-revoke"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app)
      target.remove()
    }
    // Закрытие слоя = размонтирование; следующий экземпляр не наследует шаг.
    const target2 = document.createElement('div')
    document.body.append(target2)
    const app2 = mount(SessionCard, { target: target2, props: { detail, mode: 'modal' } })
    try {
      await tick()
      expect(target2.querySelector('[data-testid="session-card-revoke"]')).toBeTruthy()
      expect(target2.querySelector('[data-testid="session-card-exit-submit"]')).toBeNull()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app2)
      target2.remove()
    }
  })
})
