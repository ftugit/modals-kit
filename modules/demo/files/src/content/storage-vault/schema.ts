import { STORAGE_MESSAGES } from '#content/user/messages.js'
import { defineCookieVault } from '#hooks/cookie-vault/index.js'
import {
  defineStorageServerForm,
  maskStorageServerEntry,
  parseStorageServerEntry,
  STORAGE_SERVER_VAULT_FORM_ID,
} from '#hooks/storage-server-form/index.js'

export interface StorageVaultEntry {
  readonly url: string
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit?: boolean
  readonly encryptionKey?: string
}

export interface StorageVaultMeta {
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit: boolean
  readonly encrypted: boolean
}

/** Та же форма, что у пула, без приоритета и без правки существующего слота. */
export const storageVaultForm = defineStorageServerForm({
  id: STORAGE_SERVER_VAULT_FORM_ID,
  withPriority: false,
  messages: STORAGE_MESSAGES,
})

export const storageVaultSchema = defineCookieVault<StorageVaultEntry, StorageVaultMeta>({
  scope: 'storage',
  title: 'Куки-сейф хранилищ (S3 / WebDAV)',
  description:
    'Одна кука dv_key хранит мастер-ключ шифрования, а каждый сервер S3 или WebDAV со своим конфигом сохраняется в отдельной зашифрованной HttpOnly-куке вашего браузера.',
  maxEntries: 8,
  form: storageVaultForm,

  parse(values) {
    const parsed = parseStorageServerEntry(values, { allowEditExisting: false })
    if (!parsed.ok) return parsed
    const entry = parsed.entry
    return {
      ok: true,
      id: parsed.id,
      entry: {
        url: entry.url,
        storageMb: entry.storageMb,
        fileMb: entry.fileMb,
        readOnly: entry.readOnly,
        allowSplit: entry.allowSplit,
        ...(entry.encryptionKey ? { encryptionKey: entry.encryptionKey } : {}),
      },
    }
  },

  mask(id, entry) {
    const masked = maskStorageServerEntry(id, {
      ...entry,
      allowSplit: entry.allowSplit !== false,
    })
    return {
      label: masked.label,
      summary: masked.summary,
      meta: {
        storageMb: entry.storageMb,
        fileMb: entry.fileMb,
        readOnly: entry.readOnly,
        allowSplit: entry.allowSplit !== false,
        encrypted: Boolean(entry.encryptionKey),
      },
    }
  },
})
