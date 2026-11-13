// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import Logout from './Logout.svelte'

const addr = vi.hoisted(() => ({ url: new URL('http://localhost/user/menu?modal=user.logout') }))
vi.mock('$app/state', () => ({
  page: { get url() { return addr.url }, state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({ goto: async () => {}, preloadData: async () => ({ type: 'not_found' }) }))
vi.mock('../../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { clear: () => {} },
}))
vi.mock('#lib/address/sveltekit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#lib/address/sveltekit.js')>()),
  visibleAddress: () => { throw new Error('modal step must not read carrier address') },
  writeAddress: () => { throw new Error('modal step must not write carrier address') },
}))

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function click(el: Element) {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
}

describe('Logout: локальный шаг модалки', () => {
  it('подтверждение и возврат не пишут адрес носителя; новый слой стартует со сводки', async () => {
    const before = addr.url.href
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Logout, { target, props: { mode: 'modal', sessionId: SESSION, total: 3 } })
    try {
      await tick()
      const next = target.querySelector('[data-testid="logout-exit-next"]')!
      expect(next).toBeTruthy()
      click(next)
      await tick()
      expect(target.querySelector('[data-testid="logout-exit-submit"]')).toBeTruthy()
      expect(target.querySelector('[data-testid="logout-local"]')).toBeNull()
      expect(addr.url.href).toBe(before)
      const back = target.querySelector('[data-testid="logout-exit-back"]')!
      click(back)
      await tick()
      expect(target.querySelector('[data-testid="logout-exit-next"]')).toBeTruthy()
      expect(target.querySelector('[data-testid="logout-local"]')).toBeTruthy()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app)
      target.remove()
    }
    const target2 = document.createElement('div')
    document.body.append(target2)
    const app2 = mount(Logout, { target: target2, props: { mode: 'modal', sessionId: SESSION, total: 3 } })
    try {
      await tick()
      expect(target2.querySelector('[data-testid="logout-exit-next"]')).toBeTruthy()
      expect(target2.querySelector('[data-testid="logout-exit-submit"]')).toBeNull()
      expect(addr.url.href).toBe(before)
    } finally {
      await unmount(app2)
      target2.remove()
    }
  })
})
