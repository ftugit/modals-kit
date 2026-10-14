/**
 * Paginator core + URL adapter + shared address writer under React Router.
 * Page in the address → the list follows; list navigation → the address follows;
 * a modal opened in the same tick as a page change keeps both keys.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router'
import {
  createPaginatorStore,
  createUrlAdapter,
  defineSource,
  definePaginator,
  getState,
  type Store,
} from '#lib/paginate/index.js'
import { createRegistry } from '#lib/modals/index.js'
import { createRouterAddress, type RouterAddress } from '../src/address'
import { createRouterModals, ModalsProvider, useModals } from '../src/modals'
import { usePaginatorActions, usePaginatorHost, usePaginatorItems, usePaginatorState } from '../src/paginate'
import { click, mount, run, settle } from './harness'

type Row = { id: number }
const ROWS: Row[] = Array.from({ length: 95 }, (_, i) => ({ id: i + 1 }))
const calls: number[] = []

const rowsSource = defineSource<Row>({
  name: 'rows',
  record: { id: (r) => String(r.id), title: (r) => `#${r.id}`, texts: () => [] },
  scan: {},
  data: async (look) => {
    calls.push(look.page)
    const start = (look.page - 1) * look.pageSize
    return { items: ROWS.slice(start, start + look.pageSize), totalItems: ROWS.length }
  },
})

let seq = 0
function definePaged(): string {
  const name = `rows-${++seq}`
  definePaginator({ name, adapter: createUrlAdapter({ name, source: rowsSource, pageSize: 10, append: false }) })
  return name
}

function List({ store, name, addr }: { store: Store; name: string; addr: RouterAddress }) {
  usePaginatorHost(store, name, addr)
  const state = usePaginatorState<Row>(store, name)
  const items = usePaginatorItems<Row>(store, name)
  const actions = usePaginatorActions(store, name)
  const modals = useModals()
  return (
    <section>
      <span data-page>{state.page}</span>
      <span data-status>{state.status}</span>
      <ol data-items>
        {items.map((r) => (
          <li key={r.id}>{r.id}</li>
        ))}
      </ol>
      <button data-next onClick={() => actions.goPage(state.page + 1)}>
        next
      </button>
      <button
        data-next-and-open
        onClick={() => {
          // Two owners write the address in the same tick.
          modals.open('note')
          actions.goPage(state.page + 1)
        }}
      >
        both
      </button>
    </section>
  )
}

const scope = createRegistry('sim-paginate')
scope.define([{ name: 'note', component: () => <p>note</p> }])

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c()
})

async function setup(initial: string) {
  const name = definePaged()
  const store = createPaginatorStore()
  // The route component reads `addr` at render time; the router must exist first.
  let addr!: RouterAddress
  const Bound = () => <List store={store} name={name} addr={addr} />
  const router = createMemoryRouter([{ path: '*', Component: Bound }], { initialEntries: [initial] })
  addr = createRouterAddress(router)
  const modals = createRouterModals(addr)
  const view = await mount(
    <ModalsProvider modals={modals} scope={scope}>
      <RouterProvider router={router} />
    </ModalsProvider>,
  )
  await settle(8)
  cleanups.push(async () => {
    await view.unmount()
    addr.dispose()
  })
  const items = () => [...view.el.querySelectorAll('[data-items] li')].map((li) => Number(li.textContent))
  const search = () => new URLSearchParams(router.state.location.search)
  return { name, store, router, addr, view, items, search }
}

describe('paginator under React Router', () => {
  it('starts on the page from the address', async () => {
    const t = await setup('/rows?page=3')
    expect(t.items()).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30])
    expect(getState(t.store, t.name).status).toBe('idle')
  })

  it('moving the list writes the page into the address', async () => {
    const t = await setup('/rows?page=3&sort=new')
    await click(t.view.el.querySelector('[data-next]'))
    await settle(8)
    expect(t.items()[0]).toBe(31)
    expect(t.search().get('page')).toBe('4')
    expect(t.search().get('sort')).toBe('new')
  })

  it('an address change from outside moves the list', async () => {
    const t = await setup('/rows?page=1')
    await run(() => t.router.navigate('/rows?page=6'))
    await settle(8)
    expect(t.items()[0]).toBe(51)
  })

  it('a modal opened in the same tick as a page change keeps both keys', async () => {
    const t = await setup('/rows?page=2')
    await click(t.view.el.querySelector('[data-next-and-open]'))
    await settle(10)
    expect(t.search().get('modal')).toBe('note')
    expect(t.search().get('page')).toBe('3')
    expect(t.view.el.querySelector('[role="dialog"]')?.textContent).toBe('note')
  })
})
