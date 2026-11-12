import { render } from 'svelte/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { definePaginator, defineSource, initialState, resetRegistry, type PaginatorState } from '#lib/paginate/index.js'
import ListingRowHost from './ListingRowHost.test.svelte'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/probe'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))

// Кнопка фильтров берёт `useModalLink`, а он требует <ModalHost> выше по дереву.
// Строки тут ни при чём: они получают атрибуты от хоста, модалка не нужна.
vi.mock('#hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => () => ({ href: '/probe/filters', 'data-modal-link': '' }),
  }
})

const source = defineSource({
  name: 'probe-row-source',
  record: { id: () => '', title: () => '', texts: () => [] },
  data: async () => ({ items: [] as { id: string }[] }),
})

/** Страница с двумя строками: иначе сниппет строки не вызывается вовсе. */
function snapshotWithRows(): PaginatorState<{ id: string }> {
  const base = initialState<{ id: string }>('probe-list', 20)
  return {
    ...base,
    totalItems: 2,
    totalPages: 1,
    loadedPages: [1],
    pages: { 1: [{ id: 'r1' }, { id: 'r2' }] },
  }
}

describe('Listing: строка рисуется хостом', () => {
  beforeEach(() => {
    resetRegistry()
    definePaginator({ name: 'probe-list', pageSize: 20, source })
  })

  it('строка-картинка не становится ссылкой: оболочка не навязывает <a>', () => {
    const { body } = render(ListingRowHost, {
      props: { snapshot: snapshotWithRows(), mode: 'image' },
    })

    expect(body).toContain('<img')
    expect(body).toContain('data-testid="probe-image"')
    expect(body).toContain('data-id="r1"')
    // Негативный контроль: оберни оболочка строку ссылкой — этой строки не будет.
    expect(body).not.toContain('<a')
    expect(body).not.toContain('href="/probe/r1"')
  })

  it('строка-ссылка: ListingRow даёт href, data-id и testId хоста', () => {
    const { body } = render(ListingRowHost, {
      props: { snapshot: snapshotWithRows(), mode: 'link' },
    })

    expect(body).toContain('href="/probe/r1"')
    expect(body).toContain('data-testid="probe-row"')
    expect(body).toContain('data-id="r2"')
    expect(body).not.toContain('data-testid="probe-image"')
  })

  it('признак выбора приходит в сниппет и в обоих режимах один и тот же', () => {
    const link = render(ListingRowHost, { props: { snapshot: snapshotWithRows(), mode: 'link' } })
    const image = render(ListingRowHost, { props: { snapshot: snapshotWithRows(), mode: 'image' } })

    for (const body of [link.body, image.body]) {
      expect(body).toContain('data-selected')
      // Отмечена только r2 — `isSelected` задаёт хост, разметку — тоже он.
      expect(body).not.toMatch(/data-id="r1"[^>]*data-selected/)
      expect(body).toMatch(/data-id="r2"[^>]*data-selected/)
    }
  })

  it('контекст строки несёт порядковый номер', () => {
    const { body } = render(ListingRowHost, {
      props: { snapshot: snapshotWithRows(), mode: 'image' },
    })

    expect(body).toContain('data-index="0"')
    expect(body).toContain('data-index="1"')
  })
})
