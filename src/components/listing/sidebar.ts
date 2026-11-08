import type { SidebarPlace } from '#components/shell/index.js'

/**
 * Форма фильтров уходит в sidebar только когда зона передана и ширина уже
 * известна как не узкая. До чтения `--mobile` и без JS остаётся кнопка.
 */
export function filtersUseSidebar(
  zone: SidebarPlace | undefined,
  ready: boolean,
  narrow: boolean,
): boolean {
  return Boolean(zone) && ready && !narrow
}
