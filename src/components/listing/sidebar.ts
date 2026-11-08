import type { SidebarPlace } from '#components/shell/index.js'

/**
 * Опция включена и сейчас ПК (`useIsMobile` = false) — форма в sidebar, без кнопки.
 * Узкий экран и отсутствие зоны — кнопка в `Surface`.
 */
export function filtersUseSidebar(zone: SidebarPlace | undefined, narrow: boolean): boolean {
  return Boolean(zone) && !narrow
}
