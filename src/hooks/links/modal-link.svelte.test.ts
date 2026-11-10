// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import Harness from './ModalLink.test.svelte'

const mock = vi.hoisted(() => ({ preload: vi.fn(), open: vi.fn() }))
vi.mock('#lib/modals/svelte/index.js', () => ({
  useModals: () => ({
    scope: { resolve: () => ({ definition: {} }), lookup: () => undefined },
    view: { chain: [] },
    modals: { core: {}, open: mock.open },
    loader: { preloadModal: mock.preload },
  }),
}))
vi.mock('#lib/modals/index.js', () => ({
  routeHref: () => null,
  nextChain: (_chain: unknown, entry: unknown) => [entry],
  chainToSearch: () => '?modal=probe',
}))
vi.mock('#hooks/js-only.svelte.js', () => ({ useJsOnly: () => () => false }))
vi.mock('../loader.svelte.js', () => ({ TASK_DELAY_MS: 150, trackTask: () => {} }))

describe('modal link retry', () => {
  it('повторно загружает после временной ошибки', async () => {
    mock.preload.mockReset().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })
    mock.open.mockReset()
    const target = document.createElement('div')
    document.body.append(target)
    const app = mount(Harness, { target })
    flushSync()
    const link = target.querySelector('a')!
    link.click()
    await tick()
    flushSync()
    expect(link.getAttribute('data-state')).toBe('error')
    expect(link.getAttribute('aria-disabled')).not.toBe('true')
    link.click()
    await tick()
    flushSync()
    expect(mock.preload).toHaveBeenCalledTimes(2)
    expect(mock.open).toHaveBeenCalledTimes(1)
    await unmount(app)
    target.remove()
  })
})
