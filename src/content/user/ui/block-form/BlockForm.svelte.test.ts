// @vitest-environment happy-dom
import { mount, tick, unmount } from 'svelte'
import { SvelteMap } from 'svelte/reactivity'
import { expect, it, vi } from 'vitest'
import BlockForm from './BlockForm.svelte'
import type { BlockCreateRouteData } from '../../types.js'

const mock = vi.hoisted(() => ({ preload: vi.fn() }))
vi.mock('$app/navigation', () => ({ preloadData: mock.preload }))
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/blocks/new'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('#hooks/links/index.js', () => ({
  asLink: (href: string) => ({ href }),
  useModalLink: () => () => ({ href: '/' }),
}))

it('при самозагрузке создаёт форму с реальными сферами и не сбрасывает причину при выборе целей', async () => {
  let resolve!: (value: unknown) => void
  mock.preload.mockImplementation(() => new Promise((r) => { resolve = r }))
  const state = new SvelteMap<string, string[]>([['subjects', ['11111111-1111-4111-8111-111111111111']]])
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(BlockForm, { target, props: { mode: 'create', get initialSubjects() { return state.get('subjects')! } } })
  try {
    await tick()
    expect(target.querySelector('[data-testid=block-form-pending]')).not.toBeNull()
    const response: BlockCreateRouteData = { uid: null, enabled: true, canCreate: true, canPickUsers: true, assignableScopes: ['profile.delete'], fact: null }
    resolve({ type: 'loaded', data: response })
    await tick()
    const select = target.querySelector<HTMLSelectElement>('select[name=scope]')!
    expect([...select.options].map((x) => x.value)).toEqual(['profile.delete'])
    const reason = target.querySelector<HTMLTextAreaElement>('textarea[name=reason]')!
    reason.value = 'сохранить черновик'
    reason.dispatchEvent(new Event('input', { bubbles: true }))
    await tick()
    state.set('subjects', ['22222222-2222-4222-8222-222222222222'])
    await tick()
    expect(target.querySelector<HTMLTextAreaElement>('textarea[name=reason]')?.value).toBe('сохранить черновик')
  } finally {
    await unmount(app)
    target.remove()
    mock.preload.mockReset()
  }
})

it('при новом initial заново связывает форму только при изменении разрешённых сфер', async () => {
  const state = new SvelteMap<string, BlockCreateRouteData>()
  const make = (scopes: string[]): BlockCreateRouteData => ({
    uid: null, enabled: true, canCreate: true, canPickUsers: true, assignableScopes: scopes, fact: null,
  })
  state.set('initial', make(['auth']))
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(BlockForm, { target, props: { mode: 'create', get initialCreate() { return state.get('initial')! } } })
  try {
    await tick()
    expect([...target.querySelector<HTMLSelectElement>('select[name=scope]')!.options].map((x) => x.value)).toEqual(['auth'])
    state.set('initial', make(['account.delete']))
    await tick()
    expect([...target.querySelector<HTMLSelectElement>('select[name=scope]')!.options].map((x) => x.value)).toEqual(['account.delete'])
    expect(mock.preload).not.toHaveBeenCalled()
  } finally {
    await unmount(app)
    target.remove()
    mock.preload.mockReset()
  }
})
