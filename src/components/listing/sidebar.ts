import type { SidebarPlace } from '#components/shell/index.js'

/**
 * Базовое место формы списка в зоне.
 * `mergeSlot` ставит 999 после каркаса и после 1, 600, 888.
 * Тот же offset перезаписывается последней регистрацией.
 */
export const FILTER_SIDEBAR_OFFSET = 999

/**
 * Зона передана — форма регистрируется в sidebar и остаётся там на любой ширине.
 * Узкий и широкий решает класс, не хук.
 */
export function filtersUseSidebar(zone: SidebarPlace | undefined): boolean {
  return Boolean(zone)
}
