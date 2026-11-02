// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { expect, it, vi } from 'vitest'
import UserConfig from './UserConfig.svelte'
import type { UserConfigRouteData } from '../../types.js'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/user/config'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href }),
  useModalLink: () => () => ({ href: '/' }),
}))

const route = (value: boolean, editable = true): UserConfigRouteData => ({
  uid: '11111111-1111-4111-8111-111111111111', enabled: true, fact: null,
  slice: {
    uid: '11111111-1111-4111-8111-111111111111', isOwn: true, canSave: editable,
    items: [{ key: 'session.ipLock', fieldName: 'session_ip_lock', group: 'security', kind: 'checkbox',
      title: 'Видимость', description: '', value, defaultValue: false, overridden: false, editable, deletable: false }],
  },
})

it('холостой SWR сохраняет ввод, изменённое серверное значение синхронизируется', async () => {
  const state = new SvelteMap<string, UserConfigRouteData>([['initial', route(false)]])
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(UserConfig, { target, props: { get initial() { return state.get('initial')! }, authorized: true, enabled: true } })
  try {
    await tick()
    const checkbox = target.querySelector<HTMLInputElement>('input[name=session_ip_lock]')!
    expect(checkbox.checked).toBe(false)
    checkbox.checked = true
    checkbox.dispatchEvent(new Event('change', { bubbles: true }))
    await tick()
    expect(checkbox.checked).toBe(true)
    state.set('initial', route(false))
    await tick()
    expect(checkbox.checked).toBe(true)
    state.set('initial', route(true))
    await tick()
    expect(checkbox.checked).toBe(true)
    state.set('initial', route(false))
    await tick()
    expect(checkbox.checked).toBe(false)
    state.set('initial', route(true, false))
    await tick()
    expect(target.querySelector('input[name=session_ip_lock]')).toBeNull()
    expect(target.querySelector('[data-testid="config-readonly-session.ipLock"]')).not.toBeNull()
  } finally {
    await unmount(app)
    target.remove()
  }
})
