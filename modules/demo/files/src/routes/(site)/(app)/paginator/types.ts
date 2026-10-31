// Типы данных лоадера страницы — отдельно от server-only `+page.server.ts`, чтобы
// клиентский `+page.svelte` не тянул серверный модуль
// даже типом.
import type { CatalogFilterSchema } from '#lib/paginate/filters/index.js'
import type { PaginatorState } from '#lib/paginate/index.js'
import type { DemoItem } from '#content/demo-catalog/items/items.js'
import type { CatalogItem } from '#content/demo-catalog/items/item-views.js'

export interface PaginatorLoaderData {
  /** Имя URL-пагинатора (в хранилище пагинаторов). */
  defaultName: string
  /** SSR-снапшот пагинатора: данные первой страницы выбранного источника. */
  snapshot: PaginatorState<CatalogItem>
  /** Снапшот второй (галерейной) полосы под `?gallery.*` — она всегда фото. */
  gallerySnapshot: PaginatorState<DemoItem>
  /**
   * Схема фильтров выбранного источника — СЕРВЕРНАЯ сборка (значения и связки
   * из живых справочников, `builtAt`). Есть, только если выбранный источник её
   * объявляет: у товаров и фото фильтров нет, и схему для них не собирают.
   */
  filterSchema: CatalogFilterSchema | null
}
