import type { PageRequest, PageResponse } from '$lib/paginate/types'
import type { AnimeRecord } from './anime'

export interface Product { id: number; title: string; price: number }
export interface Photo { id: number; caption: string }
export type ItemKind = 'products' | 'photos'
export type DemoItem = Product | Photo
/**
 * Запись демо-пагинатора: товары/фото ИЛИ тайтл аниме (источник Shikimori,
 * `content/anime.ts`). Один пагинатор обслуживает все источники — переключает
 * опция панели (`extra.kind`), разметка различает записи по форме.
 */
export type DemoEntry = DemoItem | AnimeRecord
export type ItemsQuery = { kind: ItemKind } & PageRequest

export const PRODUCTS: Product[] = Array.from({ length: 299 }, (_, i) => ({
  id: i + 1,
  title: `Product ${i + 1}`,
  price: 500 + ((i * 137) % 4500),
}))

export const GALLERY: Photo[] = Array.from({ length: 131 }, (_, i) => ({
  id: i + 1,
  caption: `Photo ${i + 1}`,
}))

export function queryItemsPage(kind: ItemKind, { page, pageSize }: PageRequest): PageResponse<DemoItem> {
  const all = kind === 'products' ? PRODUCTS : GALLERY
  const start = (page - 1) * pageSize
  return {
    items: all.slice(start, start + pageSize),
    totalItems: all.length,
    totalPages: Math.ceil(all.length / pageSize),
  }
}

export function validateItemsQuery(raw: unknown): ItemsQuery {
  const o = (raw ?? {}) as Record<string, unknown>
  const kind = o.kind === 'photos' ? 'photos' : o.kind === 'products' ? 'products' : null
  if (!kind) throw new Error('Неизвестный источник (kind: products|photos)')
  const int = (v: unknown, min: number, max: number, fallback: number) => {
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isInteger(n) && n >= min && n <= max ? n : fallback
  }
  return { kind, page: int(o.page, 1, 1_000_000, 1), pageSize: int(o.pageSize, 1, 100, 20) }
}

export async function getItemsPage(args: ItemsQuery): Promise<PageResponse<DemoItem>> {
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (typeof window !== 'undefined') {
    await new Promise((r) => setTimeout(r, 20))
  }
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return queryItemsPage(args.kind, { page: args.page, pageSize: args.pageSize })
}
