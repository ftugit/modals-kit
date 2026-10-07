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
export type ItemsQuery = {
  kind: ItemKind
  /**
   * Запрос по названию. Родной поиск есть только у товаров (подстрока по title,
   * без учёта регистра); у фото его нет — источник не объявляет возможность, и
   * оболочка пагинатора запрос к нему не передаёт.
   */
  q?: string
} & PageRequest

export const PRODUCTS: Product[] = Array.from({ length: 299 }, (_, i) => ({
  id: i + 1,
  title: `Product ${i + 1}`,
  price: 500 + ((i * 137) % 4500),
}))

export const GALLERY: Photo[] = Array.from({ length: 131 }, (_, i) => ({
  id: i + 1,
  caption: `Photo ${i + 1}`,
}))

/** Название записи для поиска: у товара — title, у фото подписи в поиск не идут. */
function searchableTitle(item: DemoItem): string | null {
  return 'title' in item ? item.title : null
}

export function queryItemsPage(
  kind: ItemKind,
  { page, pageSize, q }: PageRequest & { q?: string },
): PageResponse<DemoItem> {
  const all = kind === 'products' ? PRODUCTS : GALLERY
  // Поиск — возможность ТОЛЬКО товаров: подстрока по названию без учёта регистра.
  // Фильтр применяется ДО среза страницы: пагинация идёт по найденному, а не по
  // всему массиву, иначе вторая страница выдачи показала бы «дырки». Фото —
  // «просто данные»: ни родного поиска, ни фильтра по подписям у них нет.
  const query = kind === 'products' && typeof q === 'string' ? q.trim().toLowerCase() : ''
  const rows =
    query.length === 0
      ? all
      : all.filter((item) => {
          const title = searchableTitle(item)
          return title !== null && title.toLowerCase().includes(query)
        })
  const start = (page - 1) * pageSize
  return {
    items: rows.slice(start, start + pageSize),
    totalItems: rows.length,
    totalPages: Math.ceil(rows.length / pageSize),
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
  const q = typeof o.q === 'string' ? o.q.slice(0, 120) : undefined
  return { kind, page: int(o.page, 1, 1_000_000, 1), pageSize: int(o.pageSize, 1, 100, 20), q }
}

export async function getItemsPage(args: ItemsQuery): Promise<PageResponse<DemoItem>> {
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (typeof window !== 'undefined') {
    await new Promise((r) => setTimeout(r, 20))
  }
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return queryItemsPage(args.kind, { page: args.page, pageSize: args.pageSize, q: args.q })
}
