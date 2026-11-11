import { USER_MESSAGES } from '#content/user/messages.js'
import {
  defineStorageServerForm,
  STORAGE_SERVER_ADMIN_FORM_ID,
} from '#hooks/storage-server-form/index.js'

/** Идентификатор формы пула. Сейф использует другой id того же определения. */
export const STORAGE_SERVER_FORM_ID = STORAGE_SERVER_ADMIN_FORM_ID

/**
 * Уточнение про управляющие символы относится только к пулу: их отклоняет
 * `src/server/app-storage.server.ts`, а общий парсер `#hooks/storage-server-form`
 * проверяет длину. Поэтому уточнение живёт здесь, а не в общем `STORAGE_MESSAGES`:
 * иначе куки-сейф демо показывал бы требование, которого у него нет.
 */
export const STORAGE_POOL_MESSAGES: Record<string, string> = {
  ...USER_MESSAGES,
  'storage.key-invalid':
    'Ключ шифрования файлов должен содержать от 8 до 256 символов, без управляющих символов ASCII',
}

export const storageServerForm = defineStorageServerForm({
  id: STORAGE_SERVER_FORM_ID,
  withPriority: true,
  messages: STORAGE_POOL_MESSAGES,
})
