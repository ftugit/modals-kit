// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import Harness from './TimeAgoClock.test.svelte'

afterEach(() => {
  document.body.replaceChildren()
  vi.useRealTimers()
})

function click(target: HTMLElement, selector: string) {
  const button = target.querySelector<HTMLButtonElement>(selector)
  if (!button) throw new Error(`нет кнопки ${selector}`)
  button.click()
  flushSync()
}

test('снятие фиксированного now запускает один общий таймер, фиксация его очищает', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(1_000)
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(Harness, { target })
  try {
    flushSync()
    expect(vi.getTimerCount()).toBe(0)
    click(target, '[data-toggle]')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(60_000)
    flushSync()
    expect(target.querySelector('[data-clock="first"] time')?.textContent).toContain('минут')
    expect(target.querySelector('[data-clock="second"] time')?.textContent).toContain('минут')
    click(target, '[data-toggle]')
    expect(vi.getTimerCount()).toBe(0)
    expect(target.querySelector('[data-clock="first"] time')?.textContent).toBe('только что')
    click(target, '[data-toggle]')
    expect(vi.getTimerCount()).toBe(1)
  } finally {
    await unmount(app)
  }
  expect(vi.getTimerCount()).toBe(0)
})

test('таймер живёт до удаления последнего потребителя и создаётся снова', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(1_000)
  const target = document.createElement('div')
  document.body.append(target)
  const app = mount(Harness, { target })
  try {
    flushSync()
    click(target, '[data-toggle]')
    expect(vi.getTimerCount()).toBe(1)
    click(target, '[data-first]')
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(60_000)
    flushSync()
    expect(target.querySelector('[data-clock="second"] time')?.textContent).toContain('минут')
    click(target, '[data-second]')
    expect(vi.getTimerCount()).toBe(0)
    click(target, '[data-first]')
    expect(vi.getTimerCount()).toBe(1)
  } finally {
    await unmount(app)
  }
  expect(vi.getTimerCount()).toBe(0)
})
