import { getShikimoriFilterSchema } from '$lib/server/shikimori-schema'
import { fetchAnimesPage } from '$lib/server/shikimori-filters'
import {
  createPaginatorStore,
  initServerPaginator,
  type PaginatorState,
} from '$lib/paginate'
import {
  DEFAULT_DEMO_EXTRA,
  DEFAULT_GALLERY_EXTRA,
  DEMO_LIVE_SRC,
  ensureDemoPaginator,
  ensureGalleryPaginator,
  setLiveServerTransport,
} from './definition'
import type { DemoItem } from '../../content/items'
import type { CatalogFilterSchema } from '$lib/filters'
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
  async fetchPage(query) {
    // Фильтры применяет ТОТ ЖЕ конвейер, что и роут (`fetchAnimesPage`): один
    // разбор, одна живая схема, одни связки. Иначе SSR-снапшот строился бы по
    // другим правилам, чем клиентская догрузка, — и «перезагрузка страницы
    // меняет выдачу» вернулось бы.
    return await fetchAnimesPage({ query, filters: query.filters ?? {} })
  },
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

  return { defaultName, snapshot, gallerySnapshot, filterSchema: await schemaOf(snapshot) }
}

/**
 * Схема фильтров — только для источника, который их объявляет, и только когда
 * он выбран адресом. Товарам и фото схему не собирают вовсе: сборка трогает
 * живые справочники источника, и страница без фильтров её не ждёт.
 *
 * Без серверной схемы SSR-разметка фильтров не нарисуется (без JavaScript
 * фильтры работают только через неё) — поэтому сбой сборки не роняет страницу:
 * панель просто не показывается, а клиент попробует схему сам.
 */
async function schemaOf(snapshot: PaginatorState<CatalogItem>): Promise<CatalogFilterSchema | null> {
  if (snapshot.extra?.src !== DEMO_LIVE_SRC) return null
  try {
    return await getShikimoriFilterSchema()
  } catch {
    return null
  }
}
