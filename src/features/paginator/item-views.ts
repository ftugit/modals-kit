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

/** Запись каталога любого источника демо. */
export type CatalogItem = DemoItem | AnimeCard

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

/** Заголовок записи для списка/плитки. */
export function catalogTitle(item: CatalogItem): string {
  if (isAnimeItem(item)) return animeTitle(item)
  if (isPhotoItem(item)) return `Photo ${item.id}`
  return `Product ${item.id}`
}

/** Тексты записи для fuzzy-ранжирования и словаря коррекции. */
export function catalogTexts(item: CatalogItem): string[] {
  if (isAnimeItem(item)) return animeTexts(item)
  if (isPhotoItem(item)) return [String(item.caption ?? `Photo ${item.id}`)]
  return [String((item as Product).title ?? item.id)]
}

/** `data-testid` записи — общий для тестов и проб. */
export function catalogTestId(item: CatalogItem, prefix?: string): string {
  const kind = isAnimeItem(item) ? 'anime' : isPhotoItem(item) ? 'photo' : 'card'
  return `${prefix ? `${prefix}-` : ''}${kind}-${item.id}`
}
