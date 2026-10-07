import type { AnimeRecord } from '../../content/anime'
import type { DemoEntry } from '../../content/items'

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

export function isPhotoItem(item: DemoEntry): item is { id: number; caption: string } {
  return 'caption' in item
}

/**
 * Запись каталога Shikimori: у неё есть синонимы, по которым ранжирует
 * lib search (у демо-наборов их нет). Разметка различает записи по форме.
 */
export function isAnimeRecord(item: DemoEntry): item is AnimeRecord {
  return 'aliases' in item
}
