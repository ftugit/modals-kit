// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostFloatingApi, HostFloatingCloseReason, HostFloatingOptions } from '#lib/modals/svelte/index.js'
import Harness from './Floating.test.svelte'

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

async function mountHarness(
  floating: HostFloatingApi | undefined,
  props: { mode?: 'popup' | 'flow'; sheetOnNarrow?: boolean; frame?: boolean; withTrigger?: boolean; open?: boolean } = {},
) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const app = mount(Harness, { target, props: { floating, ...props } })
  flushSync()
  await tick()
  flushSync()
  return app
}

describe('Floating', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('без хоста не рисует панель и не зовёт open', async () => {
    const app = await mountHarness(undefined)
    try {
      expect(document.querySelector('[data-floating-body]')).toBeNull()
      expect(document.querySelector('[data-floating]')).toBeNull()
    } finally {
      await unmount(app)
    }
  })

  it('меню зовёт open, не openFlow, и кладёт render в контейнер хоста', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating, { sheetOnNarrow: false })
    try {
      expect(host.calls).toContain('open')
      expect(host.calls).not.toContain('openFlow')
      expect([...host.options.values()][0]?.modalOnNarrow).toBe(false)
      const surface = document.querySelector('[data-host-floating]')
      expect(surface?.querySelector('[data-floating-body]')).not.toBeNull()
      expect(surface?.querySelector('[data-floating]')).not.toBeNull()
      expect(surface?.querySelector('[data-floating-body]')?.textContent).toBe('Содержимое')
    } finally {
      await unmount(app)
    }
  })

  it('flow зовёт openFlow и не передаёт выключатель листа', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating, { mode: 'flow', sheetOnNarrow: false })
    try {
      expect(host.calls).toContain('openFlow')
      expect(host.calls).not.toContain('open')
      const opts = [...host.options.values()][0]
      expect(opts?.modalOnNarrow).toBeUndefined()
      expect(opts?.mobile).toBeUndefined()
    } finally {
      await unmount(app)
    }
  })

  it('триггер сам открывает меню и не повторяет клик после Escape', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating, { withTrigger: true, open: false })
    try {
      expect(host.calls).not.toContain('open')
      const anchor = document.querySelector<HTMLButtonElement>('[data-floating-anchor]')
      anchor?.click()
      flushSync()
      await tick()
      flushSync()
      expect(host.calls.filter((call) => call === 'open')).toHaveLength(1)
      expect(document.querySelector('[data-floating-body]')).not.toBeNull()
      const opts = [...host.options.values()][0]
      opts?.onClose?.('escape')
      flushSync()
      anchor?.click()
      flushSync()
      await tick()
      expect(host.calls.filter((call) => call === 'open')).toHaveLength(1)
    } finally {
      await unmount(app)
    }
  })

  it('Escape хоста не открывает поверхность снова', async () => {
    const host = floatingDouble()
    const app = await mountHarness(host.floating)
    try {
      const opts = [...host.options.values()][0]
      opts?.onClose?.('escape')
      flushSync()
      await tick()
      flushSync()
      expect(host.calls.filter((call) => call === 'open')).toHaveLength(1)
      expect(document.querySelector('[data-floating-body]')).toBeNull()
    } finally {
      await unmount(app)
    }
  })
})
