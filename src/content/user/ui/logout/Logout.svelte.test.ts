// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import Logout from './Logout.svelte'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/user/menu?modal=user.logout'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({ goto: async () => {}, preloadData: async () => ({ type: 'not_found' }) }))
vi.mock('../../vault.svelte.js', () => ({
  userSession: { ensureFresh: async () => true, onAuthExpired: () => {} },
  vault: { clear: () => {} },
}))

const SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

describe('Logout: монтирование', () => {
  it('рендерится без ошибок', async () => {
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Logout, { target, props: { mode: 'modal', sessionId: SESSION, total: 3 } })
    try {
      await tick()
      expect(target.querySelector('[data-testid="session-delete-form"]')).toBeTruthy()
    } finally {
      await unmount(app)
      target.remove()
    }
  })
})
