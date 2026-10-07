import type { PageRequest, PageResponse } from '$lib/paginate/types'

export interface Product { id: number; title: string; price: number }
export interface Photo { id: number; caption: string }
export type ItemKind = 'products' | 'photos'
export type DemoItem = Product | Photo
export type ItemsQuery = { kind: ItemKind; q?: string } & PageRequest

export const PRODUCTS: Product[] = Array.from({ length: 299 }, (_, i) => ({
  id: i + 1,
  title: `Product ${i + 1}`,
  price: 500 + ((i * 137) % 4500),
}))

export const GALLERY: Photo[] = Array.from({ length: 131 }, (_, i) => ({
  id: i + 1,
  caption: `Photo ${i + 1}`,
}))

/** Текст записи, по которому ищет локальный источник (у демо — заголовок/подпись). */
function searchTextOf(kind: ItemKind, item: DemoItem): string {
  return kind === 'products' ? String((item as Product).title ?? '') : String((item as Photo).caption ?? '')
}

/** Нормализация запроса локального источника: регистр/пробелы (подстрока, не fuzzy). */
function normalizeLocalQuery(q: string | undefined): string {
  return String(q ?? '').trim().toLocaleLowerCase('ru')
}

/**
 * Страница локального корпуса с учётом ПОИСКА ПО НАЗВАНИЮ: сужение идёт до
 * пагинации, поэтому числа страниц (`totalItems`/`totalPages`) считаются по
 * найденному, а не по всему массиву — источник остаётся честным пагинатором.
 * Объявляет ли источник поиск — его дело (`search` в спеке `defineSource`):
 * здесь механизм, там возможность.
 */
export function queryItemsPage(
  kind: ItemKind,
  { page, pageSize, q }: PageRequest & { q?: string },
): PageResponse<DemoItem> {
  const all = kind === 'products' ? PRODUCTS : GALLERY
  const query = normalizeLocalQuery(q)
  const matched = query
    ? all.filter((item) => searchTextOf(kind, item).toLocaleLowerCase('ru').includes(query))
    : all
  const start = (page - 1) * pageSize
  return {
    items: matched.slice(start, start + pageSize),
    totalItems: matched.length,
    totalPages: Math.ceil(matched.length / pageSize),
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

/**
 * Транспортная задержка демо-источника, мс (только клиент: SSR отдаёт данные сразу).
 *
 * Здесь она и должна жить — в исходнике (SolidHono) данные приезжают по сети,
 * поэтому скелетоны/индикатор видно сами собой. В порте источник локальный, и с
 * прежними 20 мс подгрузка была визуально мгновенной: скелетоны успевали
 * прожить ~19 мс. 500 мс — как раз чтобы «загрузка» читалась глазом.
 */
const DEMO_TRANSPORT_MS = 500

export async function getItemsPage(args: ItemsQuery): Promise<PageResponse<DemoItem>> {
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (typeof window !== 'undefined') {
    await new Promise((r) => setTimeout(r, DEMO_TRANSPORT_MS))
  }
  if (args.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return queryItemsPage(args.kind, { page: args.page, pageSize: args.pageSize, q: args.q })
}
