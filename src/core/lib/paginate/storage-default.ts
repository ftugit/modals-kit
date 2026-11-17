// Внутренний модуль (не реэкспортируется из index): умолчание хранилища адаптеров.
import { BROWSER } from 'esm-env'
import { createMemoryStorage } from './storage'
import type { PaginatorStorage } from './types'

/**
 * Хранилище адаптера по умолчанию. В браузере — память сеанса (переживает
 * размонтирование хоста, не переживает перезагрузку). На сервере адаптер один на
 * процесс, и память в нём стала бы общей для всех запросов: снимок одного
 * пользователя (страница, extra, курсоры) восстанавливался бы другому. Поэтому
 * там хранилище ничего не помнит — как `createLocalStorageStorage` на SSR.
 */
export function createSessionDefaultStorage(): PaginatorStorage {
  return BROWSER ? createMemoryStorage() : { read: () => null, write: () => {} }
}
