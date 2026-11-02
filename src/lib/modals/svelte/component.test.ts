// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte'
import { describe, expect, it, vi } from 'vitest'
import ModalContent from './ModalContent.svelte'
import ModalHost from './ModalHost.svelte'
import { ensureModalComponent, lazy, resolvedModalComponent } from './component.svelte'
import { setModalsContext } from './context'
import { createReactiveStore } from './store.svelte'
import { createModals, createRegistry, memoryStorage } from '../index'
import { resolveEntry } from '../core'
import { createLoader } from '../loader'
import { memoryCore } from '../cores/memory'

describe('modals/svelte component & ModalContent', () => {
  it('WeakMap изолирует одноимённые lazy-модалки из разных реестров', async () => {
    const CompA = () => ({})
    const CompB = () => ({})
    const defA = { name: 'dup.modal', component: lazy(async () => ({ default: CompA })) }
    const defB = { name: 'dup.modal', component: lazy(async () => ({ default: CompB })) }

    expect(resolvedModalComponent(defA)).toBeUndefined()
    expect(resolvedModalComponent(defB)).toBeUndefined()

    await ensureModalComponent(defA)
    expect(resolvedModalComponent(defA)).toBe(CompA)
    expect(resolvedModalComponent(defB)).toBeUndefined()

    await ensureModalComponent(defB)
    expect(resolvedModalComponent(defA)).toBe(CompA)
    expect(resolvedModalComponent(defB)).toBe(CompB)
    // Повторный вызов для уже доехавшего чанка синхронно отдаёт undefined.
    expect(ensureModalComponent(defA)).toBeUndefined()
  })

  it('не кеширует отклонённый динамический импорт и повторяет попытку', async () => {
    const Comp = () => ({})
    let attempts = 0
    const def = {
      name: 'flaky.modal',
      component: lazy(async () => {
        attempts += 1
        if (attempts === 1) throw new Error('network glitch')
        return { default: Comp }
      }),
    }

    await expect(ensureModalComponent(def)).rejects.toThrow('network glitch')
    expect(resolvedModalComponent(def)).toBeUndefined()

    await ensureModalComponent(def)
    expect(attempts).toBe(2)
    expect(resolvedModalComponent(def)).toBe(Comp)
  })

  it('ModalContent показывает скелетон для lazy без loader до прихода чанка и не висит при loader -> undefined', async () => {
    const scope = createRegistry('test')
    let resolveChunk!: (m: { default: unknown }) => void
    const LazyLeaf = lazy(
      () =>
        new Promise<{ default: unknown }>((r) => {
          resolveChunk = r
        }),
    )

    const PlainLeaf = (anchor: Comment) => {
      const marker = document.createElement('span')
      marker.dataset.testid = 'leaf-ready'
      marker.textContent = 'ok'
      anchor.before(marker)
    }

    scope.define([
      { name: 'lazy.noloader', component: LazyLeaf },
      { name: 'undef.loader', component: PlainLeaf, loader: async () => undefined },
    ])

    const core = memoryCore({ memory: memoryStorage() }, { lookup: scope.lookup })
    const modals = createModals(core, { onError: vi.fn() })
    const detach = modals.attach()
    const view = createReactiveStore(modals.store)
    const loader = createLoader({
      store: modals.store,
      lookup: scope.lookup,
      ensureView: (def) => ensureModalComponent(def),
    })

    const HostWrapper = (anchor: Comment, props: Record<string, unknown>) => {
      setModalsContext({
        modals,
        view,
        scope,
        loader,
        floating: {
          open: () => '',
          openFlow: () => '',
          update: () => {},
          close: () => {},
          container: () => undefined,
        },
        claimEntry: () => true,
      })
      return (ModalContent as any)(anchor, props)
    }

    const target = document.createElement('div')
    document.body.appendChild(target)

    try {
      // 1. lazy без loader: до прихода чанка горит скелетон, после прихода — контент.
      modals.open('lazy.noloader')
      const lazyEntry = resolveEntry(modals.store.state.chain[0]!, 0, scope.lookup)
      const stopLazy = loader.runLoader(lazyEntry)
      const app1 = mount(HostWrapper as any, {
        target,
        props: { entry: lazyEntry, active: true },
      })
      flushSync()
      expect(target.querySelector('[data-modal-skeleton]')).not.toBeNull()
      expect(target.querySelector('[data-testid="leaf-ready"]')).toBeNull()

      resolveChunk({ default: PlainLeaf })
      await new Promise((r) => setTimeout(r, 15))
      flushSync()
      expect(target.querySelector('[data-modal-skeleton]')).toBeNull()
      expect(target.querySelector('[data-testid="leaf-ready"]')?.textContent).toBe('ok')

      // При закрытии последней модалки (chain === []) смонтированный контент не мигает скелетоном на exit-анимации.
      modals.closeAll()
      flushSync()
      expect(target.querySelector('[data-modal-skeleton]')).toBeNull()
      expect(target.querySelector('[data-testid="leaf-ready"]')?.textContent).toBe('ok')
      stopLazy()
      await unmount(app1)

      // 2. loader возвращает undefined -> статус 'ready', скелетон не зависает.
      modals.open('undef.loader')
      const undefEntry = resolveEntry(modals.store.state.chain[0]!, 0, scope.lookup)
      const stopUndef = loader.runLoader(undefEntry)
      await new Promise((r) => setTimeout(r, 15))
      const app2 = mount(HostWrapper as any, {
        target,
        props: { entry: undefEntry, active: true },
      })
      flushSync()
      expect(target.querySelector('[data-modal-skeleton]')).toBeNull()
      expect(target.querySelector('[data-testid="leaf-ready"]')?.textContent).toBe('ok')
      stopUndef()
      await unmount(app2)
    } finally {
      loader.dispose()
      detach()
      view.destroy()
      target.remove()
    }
  })

  it('ModalHost монтируется со scoped-стором без циклов эффектов и не перезапрашивает loader при setParams({ reload: false })', async () => {
    let loads = 0
    const Leaf = (anchor: Comment, props: { params?: Record<string, unknown> }) => {
      const span = document.createElement('span')
      span.dataset.testid = 'host-leaf'
      span.textContent = String(props.params?.uids ?? '')
      anchor.before(span)
      return {}
    }
    const scope = createRegistry('host-test').define([
      {
        name: 'item.create',
        defaultParams: { uids: '' },
        loader: async () => {
          loads += 1
          return { scopes: ['auth'] }
        },
        component: Leaf as any,
      },
    ])
    const core = memoryCore(memoryStorage(), { lookup: scope.lookup })
    const modals = createModals(core, {
      tailCount: 2,
      configScope: () => '/blocks',
    })
    modals.setScope('/blocks')

    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ModalHost as any, {
      target,
      props: {
        modals,
        scope,
        closeIcon: true,
        backdropClick: 'top',
        mobileBreakpoint: 768,
        children: () => {},
      },
    })

    try {
      flushSync()
      modals.open('item.create', { params: { uids: 'u1' } })
      flushSync()
      await new Promise((r) => setTimeout(r, 20))
      flushSync()

      expect(loads).toBe(1)
      expect(document.querySelector('[data-modal-skeleton]')).toBeNull()
      expect(document.querySelector('[data-testid="host-leaf"]')).not.toBeNull()

      // Обновление параметров без reload не должно будить loader повторно или мигать скелетоном.
      expect(modals.setParams(0, { uids: 'u1,u2' }, { reload: false })).toBe(true)
      flushSync()
      await new Promise((r) => setTimeout(r, 20))
      flushSync()

      expect(loads).toBe(1)
      expect(document.querySelector('[data-modal-skeleton]')).toBeNull()
      expect(document.querySelector('[data-testid="host-leaf"]')).not.toBeNull()
    } finally {
      await unmount(app)
      target.remove()
    }
  })
})
