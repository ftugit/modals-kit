import type { DemoItem } from '../../content/items'

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

export function isPhotoItem(item: DemoItem): item is { id: number; caption: string } {
  return 'caption' in item
}
