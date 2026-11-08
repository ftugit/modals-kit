// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostFloatingApi, HostFloatingCloseReason, HostFloatingOptions } from '#lib/modals/svelte/index.js'
import Harness from './PopupSteps.test.svelte'
import { useSteps, type StepsHost } from './steps.svelte.js'

let mockUrl = new URL('http://localhost:5173/steps?tab=1')
const writtenUrls: string[] = []

vi.mock('esm-env', () => ({
  BROWSER: true,
  DEV: true,
}))

vi.mock('$app/state', () => ({
  page: {
    get url() {
      return mockUrl
    },
    state: {} as Record<string, unknown>,
  },
}))

vi.mock('#lib/address/sveltekit.js', () => ({
  linkTask: () => ({ status: 'idle' }),
  visibleAddress: () => ({ url: mockUrl, state: {} }),
  writeAddress: (produce: () => { url: string }) => {
    writtenUrls.push(produce().url)
    return Promise.resolve()
  },
}))

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
    open() {
      calls.push('open')
      throw new Error('PopupSteps не зовёт floating.open')
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

function stepsOf(owner: string, key: string, mode: 'hybrid' | 'url', current: string | null): StepsHost {
  return useSteps({
    owner,
    mode,
    key,
    steps: () => [
      { key: 'alpha', label: 'Альфа', filled: true },
      { key: 'beta', label: 'Бета', filled: true },
    ],
    current: () => current,
  })
}

async function mountInForm(steps: StepsHost, floating?: HostFloatingApi) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const app = mount(Harness, { target, props: { steps, floating } })
  flushSync()
  await tick()
  await tick()
  flushSync()
  const form = target.querySelector('form')
  if (!form) throw new Error('харнесс не отрисовал форму')
  return { form, app }
}

describe('PopupSteps', () => {
  afterEach(() => {
    document.body.replaceChildren()
    mockUrl = new URL('http://localhost:5173/steps?tab=1')
    writtenUrls.length = 0
  })

  it('без хоста не рисует свою панель: открытый срез в форме, имена не двоятся', async () => {
    const steps = stepsOf('popup-steps-inline', 'pinline', 'hybrid', 'alpha')
    const { form, app } = await mountInForm(steps)
    try {
      const open = form.querySelector('[data-step-popup="open"]')
      expect(open).not.toBeNull()
      expect(open?.className ?? '').not.toContain('absolute')
      expect(open?.className ?? '').not.toContain('fixed')
      expect(document.querySelector('[data-step-popup-host]')).toBeNull()
      expect(form.querySelectorAll('[name="alpha"]')).toHaveLength(1)
      expect(form.querySelectorAll('[name="beta"]')).toHaveLength(1)
      expect(form.querySelector('[data-step="beta"]')?.hasAttribute('hidden')).toBe(true)
      const data = new FormData(form)
      expect(data.get('alpha')).toBe('from-alpha')
      expect(data.get('beta')).toBe('from-beta')
    } finally {
      await unmount(app)
    }
  })

  it('открытый срез уезжает в container хоста через openFlow, поля остаются в POST', async () => {
    const steps = stepsOf('popup-steps-host', 'phost', 'hybrid', 'alpha')
    const host = floatingDouble()
    const { form, app } = await mountInForm(steps, host.floating)
    try {
      expect(host.calls).toContain('openFlow')
      expect(host.calls).not.toContain('open')
      const surface = document.querySelector('[data-host-floating]')
      const open = surface?.querySelector('[data-step-popup-host]')
      expect(open).not.toBeNull()
      expect(open?.className ?? '').not.toContain('absolute')
      expect(form.contains(open ?? null)).toBe(false)
      expect(document.querySelectorAll('[name="alpha"]')).toHaveLength(1)
      expect(document.querySelectorAll('[name="beta"]')).toHaveLength(1)
      expect(document.querySelector('[name="alpha"]')?.getAttribute('form')).toBe('popup-form')
      expect(form.querySelector('[name="beta"]')).not.toBeNull()
      const data = new FormData(form)
      expect(data.get('alpha')).toBe('from-alpha')
      expect(data.get('beta')).toBe('from-beta')
      const label = form.querySelector('a[aria-expanded="true"]')
      expect(label?.getAttribute('aria-controls')).toBe(surface?.id)
      expect(label?.getAttribute('aria-haspopup')).toBe('dialog')
    } finally {
      await unmount(app)
    }
  })

  it('Escape хоста в hybrid закрывает срез через close(), не оставляя второй openFlow', async () => {
    const steps = stepsOf('popup-steps-esc', 'pesc', 'hybrid', 'alpha')
    const host = floatingDouble()
    const { app } = await mountInForm(steps, host.floating)
    try {
      const opts = [...host.options.values()][0]
      opts?.onClose?.('escape')
      flushSync()
      expect(steps.currentKey).toBeNull()
      expect(host.calls.filter((call) => call === 'openFlow')).toHaveLength(1)
      expect(document.querySelector('[data-step-popup="open"]')).toBeNull()
    } finally {
      await unmount(app)
    }
  })

  it('Escape хоста в url пишет blankHref и не зовёт close()', async () => {
    mockUrl = new URL('http://localhost:5173/steps?purl=alpha&tab=1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const steps = stepsOf('popup-steps-url', 'purl', 'url', 'alpha')
    const host = floatingDouble()
    const { app } = await mountInForm(steps, host.floating)
    try {
      const opts = [...host.options.values()][0]
      opts?.onClose?.('escape')
      flushSync()
      expect(writtenUrls.at(-1)).toBe('/steps?tab=1')
      expect(steps.currentKey).toBe('alpha')
      expect(host.calls.filter((call) => call === 'openFlow')).toHaveLength(1)
      expect(warn.mock.calls.some((args) => String(args[0]).includes('close()'))).toBe(false)
    } finally {
      warn.mockRestore()
      await unmount(app)
    }
  })
})
