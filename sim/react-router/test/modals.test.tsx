/**
 * Modals core + shared address writer driven by React Router (memory history).
 * Same scenarios as the Svelte suite: open by name → address, close → history back,
 * browser Back closes, deep link opens, loader runs for the active entry only.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createRegistry } from '#lib/modals/index.js'
import { createRouterAddress } from '../src/address'
import { createRouterModals, ModalsProvider, useLoader, useModal, useModals, useChain } from '../src/modals'
import { click, mount, run, settle } from './harness'

const scope = createRegistry('sim')

function Card() {
  const m = useModal<{ id: string }>()
  return (
    <section>
      <h2>Card {m.params.id}</h2>
      <button data-close onClick={m.close}>
        close
      </button>
    </section>
  )
}

function Details() {
  const l = useLoader<{ title: string }>()
  return <p data-title>{l.data?.title}</p>
}

let release: (() => void) | null = null
scope.define([
  { name: 'card', component: Card },
  {
    name: 'details',
    component: Details,
    loader: (params: Record<string, unknown>) =>
      new Promise<{ title: string }>((resolve) => {
        release = () => resolve({ title: `Title ${params.id}` })
      }),
  },
])

function Page() {
  const modals = useModals()
  const chain = useChain()
  return (
    <main>
      <span data-depth>{chain.length}</span>
      <button data-open-card onClick={() => modals.open('card', { params: { id: '7' } })}>
        card
      </button>
      <button data-open-details onClick={() => modals.open('details', { params: { id: '3' } })}>
        details
      </button>
    </main>
  )
}

async function setup(initial = '/list') {
  const router = createMemoryRouter([{ path: '*', element: <Page /> }], { initialEntries: [initial] })
  const addr = createRouterAddress(router)
  const modals = createRouterModals(addr)
  const view = await mount(
    <ModalsProvider modals={modals} scope={scope}>
      <RouterProvider router={router} />
    </ModalsProvider>,
  )
  await settle()
  const search = () => new URLSearchParams(router.state.location.search)
  const dialog = () => view.el.querySelector('[role="dialog"]:not([hidden])')
  cleanups.push(async () => {
    await view.unmount()
    addr.dispose()
  })
  return { router, addr, modals, view, search, dialog }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

describe('modals under React Router', () => {
  it('open by name writes the chain into the address and renders the dialog', async () => {
    const t = await setup()
    await click(t.view.el.querySelector('[data-open-card]'))
    expect(t.search().get('modal')).toBe('card')
    expect(t.router.state.location.pathname).toBe('/list')
    expect(t.dialog()?.textContent).toContain('Card 7')
    expect(t.router.state.historyAction).toBe('PUSH')
  })

  it('close returns along history (the open entry stays forward), the page address is intact', async () => {
    const t = await setup('/list?sort=new')
    await click(t.view.el.querySelector('[data-open-card]'))
    expect(t.search().get('modal')).toBe('card')
    await click(t.dialog()!.querySelector('[data-close]'))
    expect(t.search().get('modal')).toBeNull()
    expect(t.search().get('sort')).toBe('new')
    expect(t.router.state.historyAction).toBe('POP')
    expect(t.dialog()).toBeNull()
  })

  it('browser Back closes the modal, Forward opens it again', async () => {
    const t = await setup()
    await click(t.view.el.querySelector('[data-open-card]'))
    await run(() => t.router.navigate(-1))
    expect(t.dialog()).toBeNull()
    expect(t.view.el.querySelector('[data-depth]')?.textContent).toBe('0')
    await run(() => t.router.navigate(1))
    expect(t.dialog()?.textContent).toContain('Card 7')
  })

  it('a deep link opens the modal on first render', async () => {
    const first = await setup()
    await click(first.view.el.querySelector('[data-open-card]'))
    const link = first.router.state.location.pathname + first.router.state.location.search
    for (const c of cleanups.splice(0)) await c()

    const t = await setup(link)
    expect(t.dialog()?.textContent).toContain('Card 7')
  })

  it('the loader runs for the active entry and its result reaches useLoader', async () => {
    const t = await setup()
    await click(t.view.el.querySelector('[data-open-details]'))
    expect(t.dialog()?.querySelector('[data-modal-loading]')).not.toBeNull()
    await run(() => release?.())
    expect(t.dialog()?.querySelector('[data-title]')?.textContent).toBe('Title 3')
  })

  it('an unknown name from the address is reported, not rendered blank', async () => {
    const t = await setup('/list?modal=nope')
    expect(t.dialog()?.querySelector('[data-modal-missing]')?.textContent).toBe('nope')
  })

  it('two modals in a row are two history steps; closing all goes back past both', async () => {
    const t = await setup('/list')
    await click(t.view.el.querySelector('[data-open-card]'))
    await click(t.view.el.querySelector('[data-open-details]'))
    expect(t.view.el.querySelector('[data-depth]')?.textContent).toBe('2')
    await run(() => t.modals.closeAll())
    expect(t.search().get('modal')).toBeNull()
    expect(t.view.el.querySelector('[data-depth]')?.textContent).toBe('0')
  })
})
