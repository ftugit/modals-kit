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

  it('конфигурация scoped-зеркала свежая и стабильна при unrelated runtime updates', () => {
    let currentScope = '/a'
    const core = memoryCore(memoryStorage())
    const modals = createModals(core, { configScope: () => currentScope })
    modals.setScope(currentScope)
    const view = createReactiveStore(modals.store, true)
    try {
      const initial = view.hostConfig
      const apiInitial = modals.config
      expect(modals.config).toBe(apiInitial)
      expect(view.hostConfig).toBe(initial)
      modals.store.set({ registryVersion: modals.store.state.registryVersion + 1 })
      expect(view.hostConfig).toBe(initial)
      expect(modals.config).toBe(apiInitial)
      modals.configure({ maxHeight: '70vh' })
      expect(view.hostConfig.maxHeight).toBe('70vh')
      expect(modals.config.maxHeight).toBe('70vh')
      expect(modals.config).not.toBe(apiInitial)
      const updated = view.hostConfig
      expect(updated).not.toBe(initial)
      expect(view.hostConfig).toBe(updated)
      currentScope = '/b'; modals.setScope(currentScope)
      expect(view.hostConfig.maxHeight).not.toBe('70vh')
      currentScope = '/a'; modals.setScope(currentScope)
      expect(view.hostConfig.maxHeight).toBe('70vh')
      view.destroy()
      const remount = createReactiveStore(modals.store, true)
      expect(remount.hostConfig.maxHeight).toBe('70vh')
      remount.destroy()
    } finally { view.destroy() }
  })

  it('unscoped-зеркало сохраняет базовую ссылку и отписывается', () => {
    const modals = createModals(memoryCore(memoryStorage()))
    const view = createReactiveStore(modals.store)
    const before = view.hostConfig
    modals.store.set({ registryVersion: modals.store.state.registryVersion + 1 })
    expect(view.hostConfig).toBe(before)
    modals.configure({ maxHeight: '65vh' })
    expect(view.hostConfig.maxHeight).toBe('65vh')
    const last = view.hostConfig
    view.destroy()
    modals.configure({ maxHeight: '55vh' })
    expect(view.hostConfig).toBe(last)
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

  it('возвращает фокус при размонтировании открытого хоста без derived_inert', async () => {
    const warn = vi.spyOn(console, 'warn')
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus()
    const Leaf = (anchor: Comment) => { const el = document.createElement('button'); el.textContent = 'inside'; anchor.before(el); return {} }
    const scope = createRegistry('unmount-focus').define([{ name: 'test.modal', component: Leaf as any }])
    const modals = createModals(memoryCore(memoryStorage(), { lookup: scope.lookup }))
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(ModalHost as any, { target, props: { modals, scope, children: () => {} } })
    try {
      flushSync(); modals.open('test.modal'); flushSync(); await new Promise((r) => setTimeout(r, 30)); flushSync()
      await unmount(app); await new Promise((r) => setTimeout(r, 60)); flushSync()
      expect(document.activeElement).toBe(trigger)
      expect(warn.mock.calls.some((args) => String(args[0]).includes('derived_inert'))).toBe(false)
    } finally { warn.mockRestore(); trigger.remove(); target.remove() }
  })

  it('размонтирование закрытого хоста не возвращает устаревший фокус', async () => {
    const trigger = document.createElement('button'); document.body.appendChild(trigger); trigger.focus()
    const Leaf = (anchor: Comment) => { const el = document.createElement('button'); anchor.before(el); return {} }
    const scope = createRegistry('closed-unmount').define([{ name: 'test.modal', component: Leaf as any }])
    const modals = createModals(memoryCore(memoryStorage(), { lookup: scope.lookup }))
    const target = document.createElement('div'); document.body.appendChild(target)
    const app = mount(ModalHost as any, { target, props: { modals, scope, children: () => {} } })
    try {
      flushSync(); modals.open('test.modal'); flushSync(); await new Promise((r) => setTimeout(r, 30)); flushSync()
      modals.forceCloseAll(); flushSync(); await new Promise((r) => setTimeout(r, 100)); flushSync()
      expect(document.activeElement).toBe(trigger)
      trigger.blur(); expect(document.activeElement).toBe(document.body)
      await unmount(app); await new Promise((r) => setTimeout(r, 30))
      expect(document.activeElement).toBe(document.body)
    } finally { trigger.remove(); target.remove() }
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
