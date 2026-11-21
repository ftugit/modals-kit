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

describe('OverflowMenu: клавиатура', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  async function openByClick(floating: HostFloatingApi) {
    const app = await mountHarness(floating, items)
    document.querySelector<HTMLElement>('[data-testid="probe-more"]')?.click()
    flushSync()
    await tick()
    flushSync()
    return app
  }

  it('фокус входит в контейнер role=menu при открытии', async () => {
    const host = floatingDouble()
    const app = await openByClick(host.floating)
    try {
      expect(document.activeElement?.getAttribute('role')).toBe('menu')
      expect(document.activeElement?.getAttribute('data-testid')).toBe('probe-menu')
    } finally {
      await unmount(app)
    }
  })

  it('стрелки на триггере открывают меню и фокусируют крайний пункт', async () => {
    for (const [key, expected] of [
      ['ArrowDown', 'probe-modal'],
      ['ArrowUp', 'probe-plain2'],
    ] as const) {
      const host = floatingDouble()
      const app = await mountHarness(host.floating, items)
      try {
        const trigger = document.querySelector<HTMLElement>('[data-testid="probe-more"]')!
        trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        flushSync()
        await tick()
        flushSync()
        expect(host.calls).toContain('open')
        expect(document.querySelector('[role="menu"]')).not.toBeNull()
        expect(document.activeElement?.getAttribute('data-testid')).toBe(expected)
      } finally {
        await unmount(app)
      }
    }
  })

  it('Home/End и стрелки внутри меню двигают фокус, Escape возвращает его на триггер', async () => {
    const host = floatingDouble()
    const app = await openByClick(host.floating)
    try {
      const menu = document.querySelector<HTMLElement>('[role="menu"]')!
      const press = (key: string) => {
        menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
        flushSync()
      }
      const active = () => document.activeElement?.getAttribute('data-testid')

      press('ArrowDown')
      expect(active()).toBe('probe-modal')
      press('End')
      expect(active()).toBe('probe-plain2')
      press('Home')
      expect(active()).toBe('probe-modal')
      press('ArrowUp')
      expect(active()).toBe('probe-plain2')

      press('Escape')
      expect(host.calls.filter((call) => call.startsWith('close:'))).toHaveLength(1)
      expect(document.querySelector('[role="menu"]')).toBeNull()
      expect(document.activeElement?.getAttribute('data-testid')).toBe('probe-more')
    } finally {
      await unmount(app)
    }
  })
})
