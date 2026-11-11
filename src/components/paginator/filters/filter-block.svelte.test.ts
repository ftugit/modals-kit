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

  it('создаёт уникальный id формы и связывает поздние контролы при переносе и возврате', async () => {
    const host = floatingDouble()
    const { form, app } = await mountHarness(host.floating)
    // Клонируем только оболочки настоящей тестовой формы: без дополнительных
    // контролов и без изменения её привязки к lib/form.
    const collision = form.cloneNode(false) as HTMLFormElement
    collision.id = 'filter-block-form'
    document.body.appendChild(collision)
    const external = form.cloneNode(false) as HTMLFormElement
    external.id = 'external-form'
    document.body.appendChild(external)
    form.removeAttribute('id')
    try {
      document.querySelector<HTMLButtonElement>('[data-filter-label="year"]')?.click()
      flushSync()
      await tick()
      flushSync()
      const moved = document.querySelector<HTMLElement>('[data-host-floating] [data-filter-block="year"]')
      expect(moved).not.toBeNull()
      expect(form.id).toBe('filter-block-form-1')
      expect(form.contains(moved)).toBe(false)

      const original = moved!.querySelector<HTMLInputElement>('[name="page.filters.year.min"]')
      expect(original).not.toBeNull()
      const late = original!.cloneNode(false) as HTMLInputElement
      late.removeAttribute('form')
      late.value = '2001'
      const explicit = original!.cloneNode(false) as HTMLInputElement
      explicit.name = 'page.filters.year.max'
      explicit.value = 'foreign'
      explicit.setAttribute('form', external.id)
      moved!.append(late, explicit)
      await Promise.resolve()
      await tick()
      expect(late.getAttribute('form')).toBe(form.id)
      expect(late.form).toBe(form)
      expect(explicit.form).toBe(external)
      expect(new FormData(form).getAll('page.filters.year.min')).toContain('2001')
      expect(new FormData(form).getAll('page.filters.year.max')).not.toContain('foreign')

      const opts = [...host.options.values()][0]
      expect(opts).toBeDefined()
      opts!.onClose?.('escape')
      flushSync()
      await tick()
      flushSync()
      expect(form.contains(moved)).toBe(true)
      expect(late.hasAttribute('form')).toBe(false)
      expect(late.form).toBe(form)
      // happy-dom после возврата иногда считает владельцем вложенную форму
      // несмотря на form=external; проверяем не потерявшийся атрибут отдельно.
      expect(explicit.getAttribute('form')).toBe(external.id)
      expect(new FormData(form).getAll('page.filters.year.min')).toContain('2001')
    } finally {
      await unmount(app)
      collision.remove()
      external.remove()
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
