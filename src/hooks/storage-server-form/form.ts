import { defineForm, type FormDescription } from '#lib/form/index.js'
import { storageServerFields } from './fields.js'

/** Пул БД. Не совпадает с сейфом: реестр форм падает на одинаковом `id`. */
export const STORAGE_SERVER_ADMIN_FORM_ID = 'storage-server-admin'

/** Куки-сейф. То же определение полей, другой идентификатор. */
export const STORAGE_SERVER_VAULT_FORM_ID = 'storage-server-vault'

export interface DefineStorageServerFormOptions {
  /** Уникальный id формы. Пул и сейф обязаны различаться. */
  id: string
  /** `priority` и правка существующей строки — только пул БД. */
  withPriority: boolean
  /**
   * Скрытый `server_id` и `clear_encryption_key`.
   * По умолчанию совпадает с `withPriority`: в сейфе слот перезаписывается по имени.
   */
  allowEditExisting?: boolean
  /** Словарь кодов. Хук не тянет `#content/*`: тексты передаёт вызывающий. */
  messages?: Readonly<Record<string, string>>
}

/**
 * Одно определение формы сервера хранилища.
 * Действия: `save`, `delete` (`validate: 'none'`, аргумент `delete:<id>`),
 * `reset-key` (`validate: 'none'`, только сейф).
 */
export function defineStorageServerForm(options: DefineStorageServerFormOptions): FormDescription {
  const allowEditExisting = options.allowEditExisting ?? options.withPriority
  return defineForm({
    id: options.id,
    revision: 1,
    ...(options.messages ? { messages: options.messages } : {}),
    actions: [
      { id: 'save', label: 'Проверить и сохранить', validate: 'full' },
      { id: 'delete', label: 'Удалить', validate: 'none' },
      { id: 'reset-key', label: 'Сбросить ключ и куки', validate: 'none' },
    ],
    fields: storageServerFields({
      withPriority: options.withPriority,
      allowEditExisting,
    }),
  })
}
