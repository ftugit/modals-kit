import { beforeEach, describe, expect, it, vi } from 'vitest'

let mockUrl = new URL('http://localhost:5173/checkout')
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
    const next = produce().url
    writtenUrls.push(next)
    mockUrl = new URL(next, 'http://localhost:5173')
    return Promise.resolve()
  },
}))

import { useSteps } from './steps.svelte.js'

describe('useSteps: неадресуемые шаги (addressable: false)', () => {
  beforeEach(() => {
    mockUrl = new URL('http://localhost:5173/checkout?tab=open')
    writtenUrls.length = 0
  })

  it('в hybrid: addressable: false виден в items без href, не пишет ?step= в адрес при set/switch и откатывается к первому адресуемому на холодном старте', async () => {
    let coldCurrent: string | null = 'done'
    const steps = useSteps({
      owner: 'checkout-addr-hybrid',
      key: 'cstep_h',
      mode: 'hybrid',
      steps: () => [
        { key: 'cart', label: 'Корзина', filled: true },
        { key: 'address', label: 'Адрес', filled: true },
        { key: 'done', label: 'Готово', filled: true, addressable: false },
      ],
      current: () => coldCurrent,
    })

    // 1. Холодный старт с `?cstep_h=done`: неадресуемый шаг игнорируется → выбирается `cart`
    expect(steps.currentKey).toBe('cart')
    expect(steps.isAddressable('cart')).toBe(true)
    expect(steps.isAddressable('done')).toBe(false)

    // 2. В полосе шагов `done` не получает `href`, хотя `filled: true`
    const items = steps.items
    expect(items.find((i) => i.key === 'cart')?.href).toBe('/checkout?tab=open&cstep_h=cart')
    expect(items.find((i) => i.key === 'done')?.href).toBeNull()

    // 3. `href('done')` не добавляет `cstep_h=done` и очищает существующий `cstep_h`
    steps.set('address')
    expect(writtenUrls).toEqual(['/checkout?tab=open&cstep_h=address'])
    expect(steps.href('done')).toBe('/checkout?tab=open')

    // 4. Переход на `done` меняет `currentKey`, но НЕ вызывает `writeAddress`
    writtenUrls.length = 0
    await steps.switch('done')
    expect(steps.currentKey).toBe('done')
    expect(steps.items.find((i) => i.key === 'done')?.current).toBe(true)
    expect(steps.items.find((i) => i.key === 'done')?.href).toBeNull()
    expect(writtenUrls).toEqual([])
  })

  it('в url: set/switch разрешены для addressable: false локально до смены адресного current()', async () => {
    let urlStep = 'cart'
    const steps = useSteps({
      owner: 'checkout-addr-url',
      key: 'cstep_u',
      mode: 'url',
      steps: () => [
        { key: 'cart', label: 'Корзина', filled: true },
        { key: 'confirm', label: 'Подтверждение', filled: true, addressable: false },
      ],
      current: () => urlStep,
    })

    expect(steps.currentKey).toBe('cart')
    await steps.switch('confirm')
    expect(steps.currentKey).toBe('confirm')
    expect(steps.items.find((i) => i.key === 'confirm')?.current).toBe(true)
    expect(steps.items.find((i) => i.key === 'confirm')?.href).toBeNull()

    // Как только адресный `current()` сменился — эфемерный шаг уступает адресу
    urlStep = 'cart'
    steps.set('cart') // в url-режиме адресуемый шаг не перехватывается `set()`
    urlStep = 'other'
    expect(steps.currentKey).toBe('other')
  })
})
