import { render } from 'svelte/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { definePaginator, defineSource, initialState, resetRegistry } from '#lib/paginate/index.js'
import ListingSidebarHost from './ListingSidebarHost.test.svelte'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/probe'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))

vi.mock('#hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => () => ({ href: '/probe/filters', 'data-modal-link': '' }),
  }
})

const source = defineSource({
  name: 'probe-sidebar-source',
  record: { id: () => '', title: () => '', texts: () => [] },
  data: async () => ({ items: [] as { id: string }[] }),
})

describe('Listing sidebar CSS', () => {
  beforeEach(() => {
    resetRegistry()
    definePaginator({ name: 'probe-list', pageSize: 20, source })
  })

  it('зона есть — форма и кнопка в HTML, узкий прячет форму, широкий прячет кнопку', () => {
    const { body } = render(ListingSidebarHost, {
      props: { zone: 'middle', snapshot: initialState('probe-list', 20) },
    })

    expect(body).toContain('data-listing-sidebar-filters')
    expect(body).toContain('max-lg:hidden')
    expect(body).toContain('data-testid="sidebar-filter-form"')
    expect(body).toContain('data-sidebar-offset="999"')
    expect(body).toContain('data-testid="probe-filters"')
    expect(body).toContain('lg:hidden')
  })

  it('зоны нет — кнопки без класса ширины, слота нет', () => {
    const { body } = render(ListingSidebarHost, {
      props: { snapshot: initialState('probe-list', 20) },
    })

    expect(body).not.toContain('data-listing-sidebar-filters')
    expect(body).not.toContain('lg:hidden')
    expect(body).toContain('data-testid="probe-filters"')
  })
})
