// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createPaginatorStore,
  definePaginator,
  EMPTY_CAPABILITIES,
  initialState,
  resetRegistry,
  type PaginatorAdapter,
  type Store,
} from '#core/lib/paginate/index.js'
import Harness from './FiltersPanel.test-harness.svelte'

const NAME = 'filters-panel-commit-draft'
const extra = { 'filters.q': 'bad' }

let store: Store
let app: ReturnType<typeof mount> | undefined
let target: HTMLDivElement | undefined

function adapter(): PaginatorAdapter<unknown> {
  return {
    getInitial: () => ({ page: 1, pageSize: 20, extra }),
    loadPage: async () => ({ items: [], totalItems: 0, totalPages: 0, hasNext: false }),
    persist: () => {},
    capabilities: { append: false },
    capabilitiesFor: () => EMPTY_CAPABILITIES,
  }
}

async function mountPanel() {
  target = document.createElement('div')
  document.body.append(target)
  app = mount(Harness, { target, props: { store, name: NAME, extra } })
  flushSync()
  await tick()
}

function trigger() {
  const button = target?.querySelector<HTMLButtonElement>('[data-filter-label="q"]')
  expect(button).not.toBeNull()
  return button!
}

async function openPopup() {
  trigger().click()
  flushSync()
  await tick()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function draftInput() {
  const input = document.querySelector<HTMLInputElement>('[data-filter-block-popup] input[name="filters.q"]')
  expect(input).not.toBeNull()
  return input!
}

function setDraft(value: string) {
  const input = draftInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  input.dispatchEvent(new Event('change', { bubbles: true }))
  flushSync()
}

async function settleClose() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  flushSync()
  await tick()
}

beforeEach(() => {
  resetRegistry()
  definePaginator({ name: NAME, adapter: adapter() })
  store = createPaginatorStore()
  store.hydrate(NAME, initialState(NAME, 20, extra))
})

afterEach(async () => {
  if (app) {
    await unmount(app)
    app = undefined
  }
  target?.remove()
  target = undefined
  document.body.replaceChildren()
  resetRegistry()
})

describe('FiltersPanel: commitDraft', () => {
  it('не применяет недопустимый черновик и показывает ошибку', async () => {
    await mountPanel()
    await openPopup()
    setDraft('')

    trigger().click()
    flushSync()
    await settleClose()

    const summary = document.querySelector<HTMLElement>('[data-testid="active-filters-errors"]')
    expect(summary).not.toBeNull()
    expect(summary!.textContent?.trim()).not.toBe('')
    expect(store.state(NAME)().extra).toEqual(extra)
  })

  it('применяет допустимый черновик', async () => {
    await mountPanel()
    await openPopup()
    setDraft('great')

    trigger().click()
    flushSync()
    await settleClose()

    expect(document.querySelector('[data-testid="active-filters-errors"]')).toBeNull()
    expect(store.state(NAME)().extra).toEqual({ 'filters.q': 'great' })
  })

  it('не показывает ошибку прошлого popup после быстрого повторного открытия', async () => {
    await mountPanel()
    await openPopup()
    setDraft('')

    trigger().click()
    flushSync()
    trigger().click()
    flushSync()
    await settleClose()

    expect(document.querySelector('[data-testid="active-filters-errors"]')).toBeNull()
  })
})
