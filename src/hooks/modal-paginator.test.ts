import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAddressWriter } from '#lib/address/index.js'
import { createModalStore } from '#lib/modals/index.js'
import { findScopedStore, resetScopedStores } from '#lib/paginate/index.js'
import { __resetCritical, appErrors, report } from './app-errors.svelte.js'
import {
  acquireSlotStoreForModal,
  isClosedModalLayerKey,
  openUrlModalCount,
} from './modal-paginator.svelte.js'

describe('app-errors & modal-paginator hooks (3.1–3.2)', () => {
  beforeEach(() => {
    __resetCritical()
    resetScopedStores()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not throw in DEV on non-fatal errors, and throws in DEV on fatal errors (3.1)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() =>
      report({ lib: 'modals', code: 'load-failed', cause: new Error('non-fatal modal load') }),
    ).not.toThrow()
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(appErrors.critical).toBeNull()

    expect(() =>
      report({ lib: 'paginate', code: 'init-failed', cause: new Error('fatal init') }),
    ).toThrow('fatal init')
    expect(errSpy).toHaveBeenCalledTimes(1)
  })

  it('evaluates m<k>.* layer keys per target URL modal depth and preserves live parent modal keys in AddressWriter (3.2)', async () => {
    expect(openUrlModalCount(new URL('http://localhost/?users=2'))).toBe(0)
    expect(openUrlModalCount(new URL('http://localhost/?modal=user.list'))).toBe(1)
    expect(openUrlModalCount(new URL('http://localhost/?modal=user.list,user.list.filters'))).toBe(2)

    const parentAlive = new URL('http://localhost/?modal=user.list')
    expect(isClosedModalLayerKey('m0.users.q', parentAlive)).toBe(false)
    expect(isClosedModalLayerKey('m1.blocks.q', parentAlive)).toBe(true)
    expect(isClosedModalLayerKey('users.q', parentAlive)).toBe(false)

    const noModals = new URL('http://localhost/?users=2')
    expect(isClosedModalLayerKey('m0.users.q', noModals)).toBe(true)

    // Verify end-to-end with AddressWriter.go(-1)
    let href = 'http://localhost/?users=2&modal=user.list,user.list.filters&m0.users.q=bob&m1.blocks=2'
    const writer = createAddressWriter({
      read: () => ({ url: new URL(href), state: {} }),
      here: () => new URL(href),
      commit: async (step) => {
        href = new URL(step.href, 'http://localhost').href
      },
      traverse: () => {
        href = 'http://localhost/?users=2&modal=user.list'
        writer.external()
        writer.applied()
      },
    })
    writer.layerKeys((k) => k === 'modal' || k.startsWith('modal.'))
    writer.layerKeys(isClosedModalLayerKey)

    writer.go(-1)
    await Promise.resolve()
    await Promise.resolve()

    const afterFilterClose = new URL(href)
    expect(afterFilterClose.searchParams.get('modal')).toBe('user.list')
    expect(afterFilterClose.searchParams.get('m0.users.q')).toBe('bob')
    expect(afterFilterClose.searchParams.get('m1.blocks')).toBeNull()
  })

  it('keeps ScopedStore alive across inner remounts while modal slot stays in chain, and releases on slot close (3.2)', () => {
    vi.stubGlobal('window', {})
    const modalStore = createModalStore()
    modalStore.set({
      chain: [{ kind: 'registered', name: 'user.picker', params: {}, overrides: {} }],
    })

    const first = acquireSlotStoreForModal(modalStore, 'user.picker', 0)
    const second = acquireSlotStoreForModal(modalStore, 'user.picker', 0)
    expect(second.store).toBe(first.store)
    expect(findScopedStore('0:user.picker')).toBe(first.store)

    // Child modal pushed above slot 0 -> slot 0 is still 'user.picker', store stays alive
    modalStore.set({
      chain: [
        { kind: 'registered', name: 'user.picker', params: {}, overrides: {} },
        { kind: 'registered', name: 'user.list.filters', params: {}, overrides: {} },
      ],
    })
    expect(findScopedStore('0:user.picker')).toBe(first.store)

    // Slot 0 closed -> ScopedStore released immediately
    modalStore.set({ chain: [] })
    expect(findScopedStore('0:user.picker')).toBeUndefined()
  })
})
