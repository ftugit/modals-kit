// Типы данных лоадера страницы — вынесены из server-only `loader.ts`, чтобы
// клиентские компоненты (`PaginatorDemo.svelte`) не тянули серверный модуль
// даже типом.
import type { CatalogFilterSchema } from '$lib/filters'
import type { PaginatorState } from '$lib/paginate'
import type { DemoItem } from '../../content/items'
import type { CatalogItem } from './item-views'

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
