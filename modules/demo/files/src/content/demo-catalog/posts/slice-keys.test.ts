import { describe, expect, it } from 'vitest'
import { createCursorCodec } from '#lib/db/index.js'
import {
  createPaginatorStore,
  createUrlAdapter,
  definePaginator,
  defineSource,
  goToPage,
  initPaginator,
  loadMore,
  resetPaginator,
  type Extra,
} from '#lib/paginate/index.js'
import {
  DB_LIST_EXTRA_SEARCH,
  DEFAULT_DB_LIST_EXTRA,
  DB_SLICE_POSITION_KEYS,
  withDbSliceKeys,
} from './source'

describe('createCursorCodec.decodeMeta', () => {
  it('возвращает значения закладки и ISO-время выпуска токена', async () => {
    const fixedMs = Date.parse('2026-10-30T10:15:30.000Z')
    const codec = createCursorCodec({
      keys: { k1: '0123456789abcdef0123456789abcdef' },
      activeKey: 'k1',
      ttlSeconds: 300,
      maxAgeSeconds: 3600,
      now: () => fixedMs,
    })
    const scope = { resource: 'demo.post', order: [['created_at', 'desc']] }
    const token = await codec.encode(scope, ['2026-10-30T09:00:00.000Z', 'id-1'])
    const decoded = await codec.decode(token, scope)
    expect(decoded).toEqual(['2026-10-30T09:00:00.000Z', 'id-1'])

    const meta = await codec.decodeMeta!(token, scope)
    expect(meta.values).toEqual(['2026-10-30T09:00:00.000Z', 'id-1'])
    expect(meta.issuedAt).toBe('2026-10-30T10:15:30.000Z')
  })
})

describe('withDbSliceKeys — жизненный цикл среза (asof и курсор)', () => {
  function setupPaginator(testId: string, initialSearch: Record<string, unknown> = {}) {
    let searchState: Record<string, unknown> = { ...initialSearch }

    const serializeSearch = (s: Record<string, unknown>): string => {
      const sp = new URLSearchParams()
      for (const [k, v] of Object.entries(s)) {
        if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
      }
      return sp.toString()
    }

    let headCounter = 0
    const seenRequests: Array<{ page: number; extra: Extra }> = []

    const source = defineSource<{ id: string; title: string }>({
      name: `src_${testId}`,
      record: {
        id: (r) => r.id,
        title: (r) => r.title,
        texts: (r) => [r.title],
      },
      filters: ['flt', 'ord', 'cur', 'after', 'asof'],
      totals: true,
      data: async (look, input) => {
        seenRequests.push({ page: look.page, extra: { ...input.filters } })
        const cursorOn = input.filters.cur === 'true' || input.filters.cur === '1'
        if (cursorOn) {
          const after = input.filters.after || ''
          headCounter += 1
          const iso = `2026-10-30T12:0${headCounter}:00.000Z`
          return {
            items: [{ id: `c-${look.page}-${headCounter}`, title: `Row ${headCounter}` }],
            hasNext: true,
            extra: {
              after: `nextToken${headCounter}`,
              ...(after ? { beg: `resigned_${after}`, begAt: '2026-10-30T11:30:00.000Z' } : { headAt: iso }),
            },
          }
        }
        const lockedAsof = input.filters.asof || ''
        if (!lockedAsof) headCounter += 1
        const effectiveAsof = lockedAsof || `2026-10-30T12:0${headCounter}:00.000Z|post-${headCounter}`
        const isFreshFirst = !lockedAsof && look.page === 1
        return {
          items: [{ id: `p-${look.page}`, title: `Post ${look.page}` }],
          totalItems: 15,
          totalPages: 3,
          hasNext: look.page < 3,
          extra: isFreshFirst
            ? { asofHead: effectiveAsof }
            : { asof: effectiveAsof, asofHead: '' },
        }
      },
    })

    const name = `pag_${testId}`
    const pageParam = `p_${testId}`
    const adapter = withDbSliceKeys(
      createUrlAdapter({
        name,
        source,
        pageSize: 5,
        pageSizes: [5, 10],
        pageParam,
        append: true,
        extraSearch: DB_LIST_EXTRA_SEARCH,
        extraDefaults: DEFAULT_DB_LIST_EXTRA,
      }),
    )

    adapter.setRouter({
      currentSearch: () => ({ ...searchState }),
      navigate: ({ search }: { search: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
        searchState = search({ ...searchState })
      },
      syncAddress: ({ search }: { search: (prev: Record<string, unknown>) => Record<string, unknown> }) => {
        searchState = search({ ...searchState })
      },
    })

    definePaginator({
      name,
      pageSize: 5,
      reloadKeys: ['flt', 'ord', 'cur'],
      positionKeys: DB_SLICE_POSITION_KEYS,
      adapter,
    })

    return {
      name,
      pageParam,
      adapter,
      getUrlSearch: () => serializeSearch(searchState),
      getInitUrl: () => {
        const qs = serializeSearch(searchState)
        return `http://localhost/db-demo${qs ? `?${qs}` : ''}`
      },
      seenRequests,
    }
  }

  it('не пишет page.asof на чистой 1-й странице, фиксирует его со 2-й, держит при возврате на 1-ю и очищает при reset()', async () => {
    const { name, pageParam, adapter, getUrlSearch, getInitUrl } = setupPaginator('offset_lifecycle')
    const store = createPaginatorStore()
    await initPaginator(store, name, { url: getInitUrl() })
    const read = store.state(name)

    // 1. Чистая 1-я страница: в URL нет .asof, активного asof нет, но кандидат asofHead сохранён
    const s1 = read()
    expect(s1.page).toBe(1)
    expect(s1.extra.asof).toBe('')
    expect(s1.extra.asofHead).toBe('2026-10-30T12:01:00.000Z|post-1')
    expect(getUrlSearch()).toBe('')

    // Ссылка без JS на страницу 2 уже несёт срез с 1-й страницы
    const page2Href = adapter.hrefFor!(2, { extra: s1.extra, search: {} }) ?? ''
    expect(decodeURIComponent(page2Href)).toContain(`${pageParam}=2`)
    expect(decodeURIComponent(page2Href)).toContain(`${pageParam}.asof=2026-10-30T12:01:00.000Z|post-1`)

    // Ссылка сброса (patch сбрасывает позиционные ключи) не подставляет asofHead обратно
    const resetHref =
      adapter.hrefFor!(1, {
        extra: s1.extra,
        search: {},
        patch: { asof: undefined, asofHead: undefined },
      }) ?? ''
    expect(decodeURIComponent(resetHref)).not.toContain('.asof=')

    // 2. Переход на страницу 2 закрепляет срез в состоянии и в URL
    await goToPage(store, name, 2)
    const s2 = read()
    expect(s2.page).toBe(2)
    expect(s2.extra.asof).toBe('2026-10-30T12:01:00.000Z|post-1')
    expect(decodeURIComponent(getUrlSearch())).toContain(`${pageParam}.asof=2026-10-30T12:01:00.000Z|post-1`)

    // 3. Возврат на страницу 1 сохраняет активный срез (и в состоянии, и в URL)
    await goToPage(store, name, 1)
    const sBack1 = read()
    expect(sBack1.page).toBe(1)
    expect(sBack1.extra.asof).toBe('2026-10-30T12:01:00.000Z|post-1')
    expect(decodeURIComponent(getUrlSearch())).toContain(`${pageParam}.asof=2026-10-30T12:01:00.000Z|post-1`)

    // 4. Явный resetPaginator() очищает срез в URL и в состоянии и запрашивает свежий край БД
    await resetPaginator(store, name)
    const sReset = read()
    expect(sReset.page).toBe(1)
    expect(sReset.extra.asof).toBe('')
    expect(sReset.extra.asofHead).toBe('2026-10-30T12:02:00.000Z|post-2')
    expect(getUrlSearch()).toBe('')
  })

  it('в курсорном режиме активирует begAt только после ухода с чистой 1-й порции и сбрасывает при reset()', async () => {
    const { name, pageParam, getUrlSearch, getInitUrl } = setupPaginator('cursor_lifecycle', {
      'p_cursor_lifecycle.cur': '1',
    })
    const store = createPaginatorStore()
    await initPaginator(store, name, { url: getInitUrl() })
    const read = store.state(name)

    // 1. Чистая 1-я порция курсора: begAt отсутствует, в URL нет .after
    const s1 = read()
    expect(s1.extra.begAt ?? '').toBe('')
    expect(getUrlSearch()).not.toContain(`${pageParam}.after`)

    // 2. Догрузка 2-й порции активирует метку среза begAt (по краю открытого потока)
    await loadMore(store, name, 1)
    const s2 = read()
    expect(s2.extra.begAt).toBe('2026-10-30T12:01:00.000Z')

    // 3. resetPaginator() очищает курсорные метки и возвращает чистую 1-ю порцию
    await resetPaginator(store, name)
    const sReset = read()
    expect(sReset.extra.begAt ?? '').toBe('')
    expect(getUrlSearch()).not.toContain(`${pageParam}.after`)
  })

  it('после SSR-гидрации чистой 1-й порции курсора догрузка 2-й не пишет page.after преждевременно, но ставит begAt', async () => {
    // Серверный адаптер собрал SSR-снапшот
    const ssr = setupPaginator('cursor_ssr', { 'p_cursor_ssr.cur': '1' })
    const ssrStore = createPaginatorStore()
    await initPaginator(ssrStore, ssr.name, { url: ssr.getInitUrl() })
    const snapshot = ssrStore.state(ssr.name)()

    // В браузере свой экземпляр адаптера (startOf пуст при гидрации из снапшота)
    const client = setupPaginator('cursor_client', { 'p_cursor_client.cur': '1' })
    const clientStore = createPaginatorStore()
    clientStore.hydrate(client.name, { ...snapshot, name: client.name })
    await initPaginator(clientStore, client.name, { url: client.getInitUrl() })

    await loadMore(clientStore, client.name, 1)
    const s = clientStore.state(client.name)()
    expect(s.page).toBe(1)
    expect(s.extra.begAt).toBe('2026-10-30T12:01:00.000Z')
    expect(client.getUrlSearch()).not.toContain(`${client.pageParam}.after`)
  })
})
