import type { DemoEntry } from '../../content/items'
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
} from './definition'

import type { DemoItem } from '../../content/items'

export interface PaginatorLoaderData {
  defaultName: string
  /** Снапшот основного раздела: товары/фото ИЛИ каталог Shikimori (опция `kind`). */
  snapshot: PaginatorState<DemoEntry>
  gallerySnapshot: PaginatorState<DemoItem>
}

export type PaginatorSearch = { page?: number }

export async function loadPaginatorDemo(ctx: {
  url?: string | URL
  pathname?: string
  search?: Record<string, unknown> | URLSearchParams
}): Promise<PaginatorLoaderData> {
  const store = createPaginatorStore()
  const defaultName = ensureDemoPaginator('url')
  store.update<DemoEntry>(defaultName, (state) => ({
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
  store.update<DemoItem>(galleryName, (state) => ({
    ...state,
    extra: { ...DEFAULT_GALLERY_EXTRA },
  }))

  const [snapshot, gallerySnapshot] = await Promise.all([
    initServerPaginator<DemoEntry>(store, defaultName, { url }),
    initServerPaginator<DemoItem>(store, galleryName, { url }),
  ]);

  return { defaultName, snapshot, gallerySnapshot }
}
