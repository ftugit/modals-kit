/**
 * Вьюхи и типы элементов каталога демо-пагинатора.
 *
 * Один пагинатор обслуживает три источника (товары, фото, живой каталог
 * Shikimori): элементы разных источников — один union, а различаются они
 * формой записи. Здесь же лежат стражи-предикаты, заголовки и тексты для
 * fuzzy-ранжирования — и разметка (`ItemRow`/`ShotTile`/`AnimeRow`/`AnimeTile`),
 * и источник (`definition.ts`) смотрят на записи через них.
 */
import type { DemoItem, Photo, Product } from '../../content/items'
import { animeTexts, animeTitle, type AnimeCard } from '../../content/shikimori'
import type { DbPost } from '$lib/ui/demo/db-list/definition'

/**
 * Запись каталога любого источника демо. `DbPost` — не «ещё одна форма строки»,
 * а тот же тип, что отдаёт `$lib/db`: источник БД в списке источников обязан
 * приезжать без переразметки, иначе это была бы вторая реализация.
 */
export type CatalogItem = DemoItem | AnimeCard | DbPost

export const SHOT_COLORS = [
  'bg-chart-1/20',
  'bg-chart-2/20',
  'bg-chart-3/20',
  'bg-chart-4/20',
  'bg-chart-5/20',
]

/** Детерминированная высота плитки 140–270px: «картинки разной высоты». */
export function shotHeight(seed: number): number {
  return 140 + ((seed * 7919) % 131)
}

export function isPhotoItem(item: CatalogItem): item is Photo {
  return 'caption' in item
}

export function isProductItem(item: CatalogItem): item is Product {
  return 'title' in item && 'price' in item
}

/** Запись живого каталога Shikimori: у неё есть романдзированное название и ссылка. */
export function isAnimeItem(item: CatalogItem): item is AnimeCard {
  return 'name' in item && 'url' in item
}

/**
 * Запись из БД: `created_at` есть только у неё (у товара — цена, у фото — подпись,
 * у аниме — название и ссылка). Различие по форме, а не по имени источника:
 * так вьюха не зависит от того, каким ключом панели выбран источник.
 */
export function isDbItem(item: CatalogItem): item is DbPost {
  return 'created_at' in item && 'title' in item
}

/** Заголовок записи для списка/плитки. */
export function catalogTitle(item: CatalogItem): string {
  if (isDbItem(item)) return item.title
  if (isAnimeItem(item)) return animeTitle(item)
  if (isPhotoItem(item)) return `Photo ${item.id}`
  return `Product ${item.id}`
}

/** Тексты записи для fuzzy-ранжирования и словаря коррекции. */
export function catalogTexts(item: CatalogItem): string[] {
  if (isDbItem(item)) return [item.title, item.id]
  if (isAnimeItem(item)) return animeTexts(item)
  if (isPhotoItem(item)) return [String(item.caption ?? `Photo ${item.id}`)]
  return [String((item as Product).title ?? item.id)]
}

/** `data-testid` записи — общий для тестов и проб. */
export function catalogTestId(item: CatalogItem, prefix?: string): string {
  const kind = isDbItem(item) ? 'db' : isAnimeItem(item) ? 'anime' : isPhotoItem(item) ? 'photo' : 'card'
  return `${prefix ? `${prefix}-` : ''}${kind}-${item.id}`
}
