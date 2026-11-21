// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import type {
  HostFloatingApi,
  HostFloatingCloseReason,
  HostFloatingOptions,
} from '#core/lib/modals/svelte/index.js'
import type { OverflowMenuItem } from './OverflowMenu.svelte'
import Harness from './OverflowMenu.test.svelte'

interface FloatingDouble {
  floating: HostFloatingApi
  calls: string[]
  options: Map<string, HostFloatingOptions>
}

function floatingDouble(): FloatingDouble {
  const nodes = new Map<string, HTMLElement>()
  const options = new Map<string, HostFloatingOptions>()
  const calls: string[] = []
  let seq = 0

  const floating: HostFloatingApi = {
    open(opts) {
      calls.push('open')
      const id = `f${++seq}`
      const node = document.createElement('div')
      node.id = `modals-host-floating-${id}`
      node.dataset.hostFloating = ''
      document.body.appendChild(node)
      nodes.set(id, node)
      options.set(id, opts)
      return id
    },
    openFlow(opts) {
      calls.push('openFlow')
      const id = `f${++seq}`
      const node = document.createElement('div')
      node.id = `modals-host-floating-${id}`
      node.dataset.hostFloating = ''
      document.body.appendChild(node)
      nodes.set(id, node)
      options.set(id, opts)
      return id
    },
    update(id, opts) {
      calls.push('update')
      options.set(id, opts)
    },
    close(id, reason: HostFloatingCloseReason = 'programmatic') {
      calls.push(`close:${reason}`)
      nodes.get(id)?.remove()
      nodes.delete(id)
      const opts = options.get(id)
      options.delete(id)
      opts?.onClose?.(reason)
    },
    container(id) {
      return nodes.get(id)
    },
  }
  return { floating, calls, options }
}

async function mountHarness(floating: HostFloatingApi, items: OverflowMenuItem[]) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const app = mount(Harness, { target, props: { floating, items } })
  flushSync()
  await tick()
  flushSync()
  return app
}

const items: OverflowMenuItem[] = [
  { id: 'plain', label: 'Обычная', href: '/plain' },
  { id: 'modal', label: 'Модалка', href: '/?modal=probe', attrs: { 'data-modal-link': '' } },
  { id: 'action', label: 'Действие', onClick: () => {} },
  { id: 'plain2', label: 'Вторая ссылка', href: '/plain2' },
]

describe('OverflowMenu: пункт модальной ссылки', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('не закрывает меню до завершения загрузки вложения', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating, items)
    try {
      document.querySelector<HTMLElement>('[data-testid="probe-more"]')?.click()
      flushSync()
      await tick()
      flushSync()

      const link = document.querySelector<HTMLAnchorElement>('[data-testid="probe-modal"]')
      expect(link).not.toBeNull()
      expect(link?.hasAttribute('data-modal-link')).toBe(true)

      link?.click()
      flushSync()
      // Вложение ещё не сообщило исход: снимать ссылку с DOM нельзя.
      expect(document.querySelector('[role="menu"]')).not.toBeNull()
      expect(host.calls.filter((call) => call.startsWith('close:'))).toHaveLength(0)

      // Так вложение asModalLink помечает открытие (data-state="open").
      link?.setAttribute('data-state', 'open')
      flushSync()
      await tick()
      flushSync()
      expect(host.calls.filter((call) => call.startsWith('close:'))).toHaveLength(1)
      expect(document.querySelector('[role="menu"]')).toBeNull()
    } finally {
      await unmount(app)
    }
  })

  it('обычная ссылка по-прежнему закрывает меню сразу', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating, items)
    try {
      document.querySelector<HTMLElement>('[data-testid="probe-more"]')?.click()
      flushSync()
      await tick()
      flushSync()

      document.querySelector<HTMLAnchorElement>('[data-testid="probe-plain2"]')?.click()
      flushSync()
      expect(host.calls.filter((call) => call.startsWith('close:'))).toHaveLength(1)
    } finally {
      await unmount(app)
    }
  })
})
