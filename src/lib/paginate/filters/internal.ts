/**
 * Общие константы модулей фильтров: режимы групп и границы чисел. Наружу не
 * экспортируются (`index.ts` этот файл не реэкспортирует) — это не API пакета.
 */
import type { CatalogFilterMode, CatalogFilterBound } from './schema'

export const modes: readonly CatalogFilterMode[] = ['and', 'or', 'not']

export const bounds: readonly CatalogFilterBound[] = ['min', 'max']
