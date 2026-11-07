import { USER_MESSAGES } from '#content/user/messages.js'
import {
  defineStorageServerForm,
  STORAGE_SERVER_ADMIN_FORM_ID,
} from '#hooks/storage-server-form/index.js'

/** Идентификатор формы пула. Сейф использует другой id того же определения. */
export const STORAGE_SERVER_FORM_ID = STORAGE_SERVER_ADMIN_FORM_ID

export const storageServerForm = defineStorageServerForm({
  id: STORAGE_SERVER_FORM_ID,
  withPriority: true,
  messages: USER_MESSAGES,
})
