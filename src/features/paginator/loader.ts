import { fetchAnimes } from '$lib/server/shikimori'
import {
  createPaginatorStore,
  initServerPaginator,
  type PaginatorState,
} from '$lib/paginate'
import {
  DEFAULT_DEMO_EXTRA,
  DEFAULT_GALLERY_EXTRA,
  ensureDemoPaginator,
  ensureGalleryPaginator,
  setLiveServerTransport,
} from './definition'
import type { DemoItem } from '../../content/items'
import type { CatalogItem } from './item-views'
import type { PaginatorLoaderData } from './types'

export type { PaginatorLoaderData } from './types'

/**
 * Мост живого источника на сервере: лоадер отдаёт пагинатору транспорт прямо
 * к серверному модулю Shikimori (`$lib/server/shikimori` — кэш, троттлинг,
 * User-Agent), поэтому SSR-снапшот строится одним запросом на сервере и БЕЗ
 * обращения к собственному HTTP-эндпоинту. В браузере тот же источник идёт в
 * `/api/shikimori/animes` (см. `content/shikimori.ts`).
 *
 * Вызов идемпотентен и живёт на уровне модуля: транспорт — инвариант сервера,
 * а не состояние запроса.
 */
setLiveServerTransport({
  fetchPage: (query) => fetchAnimes(query),
})

export type PaginatorSearch = { page?: number }

export async function loadPaginatorDemo(ctx: {
  url?: string | URL
  pathname?: string
  search?: Record<string, unknown> | URLSearchParams
}): Promise<PaginatorLoaderData> {
  const store = createPaginatorStore()
  const defaultName = ensureDemoPaginator('url')
  store.update<CatalogItem>(defaultName, (state) => ({
    ...state,
    extra: { ...DEFAULT_DEMO_EXTRA },
  }))

  let searchStr = ''
  if (ctx.url) {
    const u = typeof ctx.url === 'string' ? new URL(ctx.url, 'http://localhost') : ctx.url
    searchStr = u.search
  } else if (ctx.search) {
    if (ctx.search instanceof URLSearchParams) {
      const s = ctx.search.toString()
      searchStr = s ? `?${s}` : ''
    } else {
      const params = new URLSearchParams()
      for (const [k, v] of Object.entries(ctx.search)) {
        if (v != null) params.set(k, String(v))
      }
      const s = params.toString()
      searchStr = s ? `?${s}` : ''
    }
  }

  const url = `${ctx.pathname || '/paginator'}${searchStr}`
  const galleryName = ensureGalleryPaginator()
  store.update<CatalogItem>(galleryName, (state) => ({
    ...state,
    extra: { ...DEFAULT_GALLERY_EXTRA },
  }))

  const [snapshot, gallerySnapshot]: [PaginatorState<CatalogItem>, PaginatorState<DemoItem>] =
    await Promise.all([
      initServerPaginator<CatalogItem>(store, defaultName, { url }),
      // Галерея — вторая полоса под своим префиксом `?gallery.*`, всегда фото.
      initServerPaginator<DemoItem>(store, galleryName, { url }),
    ])

  return { defaultName, snapshot, gallerySnapshot }
}
