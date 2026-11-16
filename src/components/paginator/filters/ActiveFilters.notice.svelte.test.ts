// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import Harness from './ActiveFilters.notice.test.svelte'

const notice = 'В наборе несколько значений, выберите одно.'

let app: ReturnType<typeof mount> | undefined
let target: HTMLDivElement | undefined

async function openFilter(key: string, extra: Record<string, unknown>) {
  target = document.createElement('div')
  document.body.append(target)
  app = mount(Harness, { target, props: { extra, notice } })
  flushSync()

  const trigger = target.querySelector<HTMLButtonElement>(`[data-filter-label="${key}"]`)
  expect(trigger).not.toBeNull()
  trigger!.click()
  flushSync()
  await tick()
}

function popupControl(selector: string) {
  return document.querySelector(`[data-filter-block-popup] ${selector}`)
}

afterEach(async () => {
  if (app) {
    await unmount(app)
    app = undefined
  }
  target?.remove()
  target = undefined
  document.body.replaceChildren()
})

describe('ActiveFilters: одиночный select', () => {
  it('два значения status из extra показывают пояснение', async () => {
    // Локальное хранилище без адреса: оба значения пришли только из extra.
    await openFilter('status', { 'filters.status': 'alive,dead' })

    const marker = document.querySelector<HTMLElement>('[data-filter-block-notice]')
    expect(marker?.textContent).toBe(notice)
    expect(popupControl('select[name="page.filters.status"]')).not.toBeNull()
  })

  it('связывает пояснение с полем через aria-describedby', async () => {
    await openFilter('status', { 'filters.status': 'alive,dead' })

    const marker = document.querySelector<HTMLElement>('[data-filter-block-notice]')
    const select = popupControl('select[name="page.filters.status"]') as HTMLElement | null
    expect(marker?.id).toBeTruthy()
    expect(select?.getAttribute('aria-describedby')?.split(/\s+/)).toContain(marker?.id)
  })

  it('пояснение не привязано к status: второй одиночный select тоже его получает', async () => {
    await openFilter('kind', { 'filters.kind': 'tv,movie' })

    const marker = document.querySelector<HTMLElement>('[data-filter-block-notice]')
    expect(marker?.textContent).toBe(notice)
    expect(popupControl('select[name="page.filters.kind"]')).not.toBeNull()
  })

  it('одно значение — обычный select без пояснения', async () => {
    await openFilter('status', { 'filters.status': 'alive' })

    expect(document.querySelector('[data-filter-block-notice]')).toBeNull()
    const select = popupControl('select[name="page.filters.status"]')
    expect(select).not.toBeNull()
    expect(select?.getAttribute('aria-describedby')).toBeNull()
  })

  it('две границы number — не конфликт одиночного значения', async () => {
    await openFilter('score', { 'filters.score.min': '1', 'filters.score.max': '9' })

    expect(document.querySelector('[data-filter-block-notice]')).toBeNull()
    expect(popupControl('input[name="page.filters.score.min"]')).not.toBeNull()
  })

  it('несколько значений multiselect — не конфликт одиночного значения', async () => {
    await openFilter('genres', { 'filters.genres.and': 'drama,comedy' })

    expect(document.querySelector('[data-filter-block-notice]')).toBeNull()
    expect(popupControl('input[name="page.filters.genres.and"]')).not.toBeNull()
  })

  it('показывает код ошибки, если message пустой', async () => {
    target = document.createElement('div')
    document.body.append(target)
    app = mount(Harness, {
      target,
      props: {
        extra: { 'filters.status': 'alive' },
        notice,
        onCommitDraft: () => [
          { id: 'empty-message', code: 'required', message: '', origin: 'core' },
        ],
      },
    })
    flushSync()
    await tick()

    const trigger = target.querySelector<HTMLButtonElement>('[data-filter-label="status"]')
    trigger!.click()
    flushSync()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const select = popupControl('select[name="page.filters.status"]') as HTMLSelectElement | null
    select!.value = 'dead'
    select!.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()

    trigger!.click()
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
    flushSync()
    await tick()

    const summary = document.querySelector<HTMLElement>('[data-testid="active-filters-errors"]')
    expect(summary?.textContent).toContain('required')
  })

  it('снятие группы вызывает onRemoveGroup один раз', async () => {
    let calls = 0
    let lastPatch: Record<string, unknown> | undefined
    target = document.createElement('div')
    document.body.append(target)
    app = mount(Harness, {
      target,
      props: {
        extra: { 'filters.status': 'alive,dead' },
        notice,
        onRemoveGroup: (patch) => {
          calls += 1
          lastPatch = patch
        },
      },
    })
    flushSync()

    const remove = target.querySelector<HTMLButtonElement>('[data-filter-label-remove="status"]')
    expect(remove).not.toBeNull()
    remove!.click()
    flushSync()
    await tick()

    expect(calls).toBe(1)
    expect(lastPatch?.['filters.status']).toBeUndefined()
  })
})
