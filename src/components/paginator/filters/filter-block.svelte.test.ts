// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import type { HostFloatingApi, HostFloatingCloseReason, HostFloatingOptions } from '#lib/modals/svelte/index.js'
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import Harness from './FilterBlock.test.svelte'

const schema: CatalogFilterSchema = {
  source: 'test',
  version: 1,
  fields: [
    { key: 'year', label: 'Год', type: 'number', bounds: ['min', 'max'] },
    { key: 'genres', label: 'Жанры', type: 'multiselect', modes: ['and'] },
    { key: 'studios', label: 'Студии', type: 'multiselect', modes: ['and'] },
    { key: 'kind', label: 'Тип', type: 'select' },
  ],
}

function floatingDouble(): { floating: HostFloatingApi; calls: string[]; options: Map<string, HostFloatingOptions> } {
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

async function mountHarness(floating?: HostFloatingApi) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  const app = mount(Harness, { target, props: { floating, schema } })
  flushSync()
  await tick()
  flushSync()
  const form = target.querySelector('form')
  if (!form) throw new Error('харнесс не отрисовал форму')
  return { form, app, target }
}

describe('FilterBlock', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('без хоста метка не становится кнопкой, поля остаются в форме', async () => {
    const { form, app } = await mountHarness()
    try {
      expect(form.querySelector('[data-filter-block="year"]')).not.toBeNull()
      expect(form.querySelector('[data-filter-block-state="mixed"]')).not.toBeNull()
      expect(document.querySelector('[data-filter-label="year"]')?.tagName).toBe('SPAN')
      expect(document.querySelector('[data-filter-label="kind"]')?.getAttribute('data-filter-label-popup')).toBe('false')
      expect(form.querySelectorAll('[name="page.filters.year.min"]')).toHaveLength(1)
      expect(document.querySelector('[data-host-floating]')).toBeNull()
    } finally {
      await unmount(app)
    }
  })

  it('метка года забирает свой блок в openFlow, имена не двоятся', async () => {
    const host = floatingDouble()
    const { form, app } = await mountHarness(host.floating)
    try {
      const year = document.querySelector<HTMLButtonElement>('[data-filter-label="year"]')
      expect(year?.tagName).toBe('BUTTON')
      expect(document.querySelector('[data-filter-label="genres"]')?.tagName).toBe('SPAN')
      expect(document.querySelector('[data-filter-label="kind"]')?.tagName).toBe('SPAN')
      year?.click()
      flushSync()
      await tick()
      flushSync()
      expect(host.calls).toContain('openFlow')
      expect(host.calls).not.toContain('open')
      const surface = document.querySelector('[data-host-floating]')
      const moved = surface?.querySelector('[data-filter-block="year"]')
      expect(moved).not.toBeNull()
      expect(form.contains(moved ?? null)).toBe(false)
      expect(document.querySelectorAll('[name="page.filters.year.min"]')).toHaveLength(1)
      expect(document.querySelectorAll('[name="page.filters.year.max"]')).toHaveLength(1)
      expect(document.querySelector('[name="page.filters.year.min"]')?.getAttribute('form')).toBe('filter-block-form')
      expect(form.querySelector('[name="page.filters.kind"]')).not.toBeNull()
      const data = new FormData(form)
      expect(data.get('page.filters.year.min')).toBe('1990')
      expect(data.get('page.filters.year.max')).toBe('1992')
      expect(data.get('page.filters.kind')).toBe('tv')
      expect(year?.getAttribute('aria-expanded')).toBe('true')
      expect(year?.getAttribute('aria-haspopup')).toBe('dialog')
    } finally {
      await unmount(app)
    }
  })

  it('закрытие хоста возвращает блок в форму и не открывает поток второй раз', async () => {
    const host = floatingDouble()
    const { form, app } = await mountHarness(host.floating)
    try {
      document.querySelector<HTMLButtonElement>('[data-filter-label="year"]')?.click()
      flushSync()
      await tick()
      flushSync()
      const opts = [...host.options.values()][0]
      opts?.onClose?.('escape')
      flushSync()
      await tick()
      flushSync()
      expect(host.calls.filter((call) => call === 'openFlow')).toHaveLength(1)
      expect(document.querySelector('[data-filter-label="year"]')?.getAttribute('aria-expanded')).toBe('false')
      expect(form.querySelector('[data-filter-block="year"]')).not.toBeNull()
      expect(form.querySelector('[name="page.filters.year.min"]')?.hasAttribute('form')).toBe(false)
      expect(document.querySelectorAll('[name="page.filters.year.min"]')).toHaveLength(1)
    } finally {
      await unmount(app)
    }
  })
})
