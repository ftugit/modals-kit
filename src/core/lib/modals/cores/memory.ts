// Ядро без окружения: SSR, тесты, встраиваемый виджет.
import { buildCore, type CoreOptions } from '../build'
import { memoryEngine } from '../engine'
import { memoryStorage } from '../storages'
import type { Sources } from '../build'
import type { ModalCore } from '../core-contract'

/**
 * Хранилище по умолчанию выбрано ПОД эту среду: истории нет, адреса нет —
 * значит и носителю незачем переживать перезагрузку.
 */
export function memoryCore(
  sources: Sources = memoryStorage(),
  options: CoreOptions = {},
): ModalCore {
  return buildCore(memoryEngine(), sources, options)
}
