import { render } from 'svelte/server'
import { describe, expect, it } from 'vitest'
import {
  createLocalAdapter,
  createPaginatorStore,
  definePaginator,
  defineSource,
  initServerPaginator,
} from '#lib/paginate/index.js'
import {
  isChatStreamMode,
  nextSliceScrollProgress,
  resolveSliceTimestamp,
  shouldRenderPageSlice,
} from './slice'
import PageSliceSsrHarness from './test/PageSliceSsrHarness.svelte'

describe('slice.ts — чистая логика плашки среза', () => {
  it('resolveSliceTimestamp извлекает ISO из asof (<ISO>|<id>), begAt и sliceAt и игнорирует asofHead', () => {
    expect(resolveSliceTimestamp(undefined)).toBeNull()
    expect(resolveSliceTimestamp({ asofHead: '2026-10-30T12:00:00.000Z|p1', asof: '' })).toBeNull()
    expect(resolveSliceTimestamp({ asof: '2026-10-30T12:00:00.000Z|p1' })).toBe(
      '2026-10-30T12:00:00.000Z',
    )
    expect(resolveSliceTimestamp({ begAt: '2026-10-30T11:30:00.000Z' })).toBe(
      '2026-10-30T11:30:00.000Z',
    )
    expect(resolveSliceTimestamp({ sliceAt: '2026-10-30T09:15:00.000Z' })).toBe(
      '2026-10-30T09:15:00.000Z',
    )
    expect(resolveSliceTimestamp({ asof: 'not-a-date|id' })).toBeNull()
  })

  it('isChatStreamMode и nextSliceScrollProgress учитывают направление потока', () => {
    expect(isChatStreamMode({ topTrigger: 'direction', bottomTrigger: 'direction' })).toBe(false)
    expect(isChatStreamMode({ topTrigger: 'chat', bottomTrigger: 'off' })).toBe(true)
    expect(isChatStreamMode({ topTrigger: 'off', bottomTrigger: 'chat' })).toBe(true)

    // Обычный поток: скролл вниз (+24px из 48px) скрывает (0 -> 0.5), скролл вверх раскрывает
    const pDown = nextSliceScrollProgress(0, 24, 48, false)
    expect(pDown).toBeCloseTo(0.5, 5)
    expect(nextSliceScrollProgress(pDown, -24, 48, false)).toBeCloseTo(0, 5)

    // Режим чата: скролл вверх (-24px из 48px) скрывает (0 -> 0.5), скролл вниз раскрывает
    const pChatUp = nextSliceScrollProgress(0, -24, 48, true)
    expect(pChatUp).toBeCloseTo(0.5, 5)
    expect(nextSliceScrollProgress(pChatUp, 24, 48, true)).toBeCloseTo(0, 5)
  })

  it('shouldRenderPageSlice соблюдает приоритет метки, jsOnly, enable и firstPageOnly', () => {
    // Нет активного среза -> всегда скрыт, даже при enable: true
    expect(
      shouldRenderPageSlice({
        sliceAt: null,
        enable: true,
        firstPageOnly: false,
        currentPage: 1,
        hydrated: true,
      }),
    ).toBe(false)

    // firstPageOnly скрывает на 2-й странице по умолчанию, но enable: true пробивает ограничение
    expect(
      shouldRenderPageSlice({
        sliceAt: '2026-10-30T12:00:00.000Z',
        enable: undefined,
        firstPageOnly: true,
        currentPage: 2,
        hydrated: true,
      }),
    ).toBe(false)
    expect(
      shouldRenderPageSlice({
        sliceAt: '2026-10-30T12:00:00.000Z',
        enable: true,
        firstPageOnly: true,
        currentPage: 2,
        hydrated: true,
      }),
    ).toBe(true)

    // enable: false принудительно скрывает даже на 1-й странице
    expect(
      shouldRenderPageSlice({
        sliceAt: '2026-10-30T12:00:00.000Z',
        enable: false,
        firstPageOnly: true,
        currentPage: 1,
        hydrated: true,
      }),
    ).toBe(false)

    // jsOnly скрывает до гидрации (без JS)
    expect(
      shouldRenderPageSlice({
        sliceAt: '2026-10-30T12:00:00.000Z',
        jsOnly: true,
        currentPage: 1,
        hydrated: false,
      }),
    ).toBe(false)
    expect(
      shouldRenderPageSlice({
        sliceAt: '2026-10-30T12:00:00.000Z',
        jsOnly: true,
        currentPage: 1,
        hydrated: true,
      }),
    ).toBe(true)
  })
})

describe('PageSlice и PageDivider — SSR-рендер', () => {
  async function makeStoreWithSlice(
    name: string,
    extra: Record<string, string>,
    page = 1,
  ) {
    const source = defineSource<{ id: string; title: string }>({
      name: `src_${name}`,
      record: { id: (r) => r.id, title: (r) => r.title, texts: (r) => [r.title] },
      totals: true,
      data: async () => ({
        items: [{ id: '1', title: 'Row 1' }],
        totalItems: 10,
        totalPages: 2,
        hasNext: page < 2,
        extra,
      }),
    })
    definePaginator({
      name,
      pageSize: 5,
      adapter: createLocalAdapter({
        name,
        source,
        pageSize: 5,
        storage: {
          read: () => ({ page, pageSize: 5, extra }),
          write: () => {},
        },
      }),
    })
    const store = createPaginatorStore()
    const snapshot = await initServerPaginator(store, name)
    return { store, snapshot }
  }

  it('рендерит текст среза с TimeAgo и кнопкой сброса, разрешая floating только внутри PaginatorHost без id', async () => {
    const sliceIso = '2026-10-30T11:55:00.000Z'
    const fixedNow = Date.parse('2026-10-30T12:00:00.000Z')
    const { store, snapshot } = await makeStoreWithSlice('ssr_slice_host', {
      asof: `${sliceIso}|id-1`,
    })

    // Внутри PaginatorHost без явного name -> floating="top" активен
    const insideHtml = render(PageSliceSsrHarness, {
      props: {
        store,
        name: 'ssr_slice_host',
        snapshot,
        mode: 'inside',
        floating: 'top',
        now: fixedNow,
        sliceClass: 'px-6',
      },
    }).body
    expect(insideHtml).toContain('data-testid="page-slice"')
    expect(insideHtml).toContain('Отображается срез от')
    expect(insideHtml).toContain('5 минут назад')
    expect(insideHtml).toContain('сбросить?')
    expect(insideHtml).toContain('data-floating="top"')
    expect(insideHtml).toContain('px-6')

    // Снаружи PaginatorHost (передан явный name) -> floating="top" игнорируется
    const outsideHtml = render(PageSliceSsrHarness, {
      props: {
        store,
        name: 'ssr_slice_host',
        snapshot,
        mode: 'outside',
        floating: 'top',
        now: fixedNow,
      },
    }).body
    expect(outsideHtml).toContain('data-testid="page-slice"')
    expect(outsideHtml).not.toContain('data-floating=')

    // jsOnly=true на SSR -> ничего не рендерится
    const jsOnlyHtml = render(PageSliceSsrHarness, {
      props: {
        store,
        name: 'ssr_slice_host',
        snapshot,
        mode: 'inside',
        jsOnly: true,
        now: fixedNow,
      },
    }).body
    expect(jsOnlyHtml).not.toContain('data-testid="page-slice"')
  })

  it('PageDivider не рендерит «страница 1», показывает PageSlice при активном срезе и оставляет «страница 2»', async () => {
    const clean = await makeStoreWithSlice('ssr_div_clean', {
      asofHead: '2026-10-30T12:00:00.000Z|id-1',
    })
    const cleanHtml = render(PageSliceSsrHarness, {
      props: {
        store: clean.store,
        name: 'ssr_div_clean',
        snapshot: clean.snapshot,
        mode: 'dividers',
      },
    }).body
    expect(cleanHtml).not.toContain('страница 1')
    expect(cleanHtml).not.toContain('data-testid="page-divider-1"')
    expect(cleanHtml).not.toContain('data-testid="page-slice"')
    expect(cleanHtml).toContain('data-testid="page-divider-2"')
    expect(cleanHtml).toContain('страница 2 (5)')

    const active = await makeStoreWithSlice('ssr_div_active', {
      asof: '2026-10-30T11:50:00.000Z|id-1',
    })
    const activeHtml = render(PageSliceSsrHarness, {
      props: {
        store: active.store,
        name: 'ssr_div_active',
        snapshot: active.snapshot,
        mode: 'dividers',
        now: Date.parse('2026-10-30T12:00:00.000Z'),
      },
    }).body
    expect(activeHtml).not.toContain('страница 1')
    expect(activeHtml).toContain('data-testid="page-slice"')
    expect(activeHtml).toContain('10 минут назад')
    expect(activeHtml).toContain('страница 2 (5)')
  })
})
