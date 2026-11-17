// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './FilterBlockPlaceholder.test.svelte'
import { resetFilterList, setFilterListOpen, setFilterListSlot } from './filter-registry.svelte.js'

const NAME = 'placeholder-test'
let cleanup: (() => Promise<void>) | undefined

afterEach(async () => {
  await cleanup?.()
  cleanup = undefined
  resetFilterList(NAME)
  document.body.replaceChildren()
})

describe('FilterBlock: placeholder на время переноса', () => {
  it('резервирует место дома, не отправляет placeholder и возвращает узел', async () => {
    const target = document.createElement('div')
    const slot = document.createElement('div')
    document.body.append(target, slot)
    const app = mount(Harness, { target })
    flushSync()

    setFilterListSlot(NAME, slot)
    setFilterListOpen(NAME, 'genre')
    flushSync()

    const form = target.querySelector('form')!
    const home = target.querySelector<HTMLElement>('[data-filter-block-home]')!
    const input = slot.querySelector<HTMLInputElement>('input[name="genre"]')!
    const placeholder = home.querySelector<HTMLElement>('[data-filter-block-placeholder]')!
    expect(input).not.toBeNull()
    expect(home.contains(input)).toBe(false)
    expect(placeholder).not.toBeNull()
    expect(placeholder.tagName).toBe('FIELDSET')
    expect(placeholder.hasAttribute('disabled')).toBe(true)
    expect(placeholder.getAttribute('aria-hidden')).toBe('true')
    expect(placeholder.hasAttribute('name')).toBe(false)
    expect(placeholder.querySelector('[name], button, input, select, textarea, a[href]')).toBeNull()
    expect(placeholder.classList.length).toBe(0)
    expect(placeholder.style.display).toBe('block')
    expect(placeholder.style.display).not.toBe('contents')

    const data = new FormData(form)
    expect(data.get('genre')).toBe('11')
    expect(data.has('')).toBe(false)

    setFilterListOpen(NAME, null)
    flushSync()

    expect(slot.querySelector('input[name="genre"]')).toBeNull()
    expect(home.contains(input)).toBe(true)
    expect(home.querySelector('[data-filter-block-placeholder]')).toBeNull()

    cleanup = async () => {
      await unmount(app)
    }
  })
})
