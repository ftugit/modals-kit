import {
  defineCookieVault,
  VAULT_SLOT_ID_RE,
} from '#hooks/cookie-vault/index.js'
import { defineForm, field, v, type IssueLike } from '#lib/form/index.js'
import { maskS3Url, parseS3Url } from '#lib/storage/s3.js'

const RESERVED_SERVER_NAMES = new Set(['auto', 'local', 'memory'])

export interface StorageVaultEntry {
  readonly url: string
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
}

export interface StorageVaultMeta {
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
}

export const storageVaultEntryForm = defineForm({
  id: 'storage_vault_entry',
  fields: {
    slot: field.text({
      label: 'Имя сервера (слот)',
      placeholder: 'Например, s3_main или s3_backup',
      help: 'Латиница в нижнем регистре, цифры, «_», «-» (кроме зарезервированных local, memory, auto).',
      validate: [v.required(), v.maxLength(24)],
    }),
    url: field.password({
      label: 'Единая ссылка S3 (DSN)',
      placeholder: 's3://accessKey:secretKey@s3.us-east-005.backblazeb2.com/bucket/prefix',
      help: 'Шифруется в отдельной HttpOnly-куке (AES-256-GCM) и никогда не возвращается в HTML.',
      validate: [v.required(), v.maxLength(2048)],
    }),
    storage_mb: field.text({
      label: 'Общий лимит хранилища (МБ)',
      defaultValue: '5120',
      validate: [v.required(), v.maxLength(10)],
    }),
    file_mb: field.text({
      label: 'Лимит одного файла (МБ)',
      defaultValue: '512',
      validate: [v.required(), v.maxLength(10)],
    }),
    read_only: field.checkbox({
      label: 'Только чтение (readOnly — блокировать запись и удаление)',
      defaultValue: false,
    }),
  },
})

export const storageVaultSchema = defineCookieVault<StorageVaultEntry, StorageVaultMeta>({
  scope: 'storage',
  title: 'Куки-сейф хранилищ S3',
  description:
    'Одна кука dv_key хранит мастер-ключ шифрования, а каждый S3-сервер со своим конфигом сохраняется в отдельной зашифрованной HttpOnly-куке вашего браузера.',
  maxEntries: 8,
  entryForm: storageVaultEntryForm,

  parse(values) {
    const issues: IssueLike[] = []
    const slot = String(values.slot ?? '').trim().toLowerCase()
    if (!VAULT_SLOT_ID_RE.test(slot)) {
      issues.push({
        code: 'slot.invalid',
        path: ['slot'],
        message: 'Имя слота: строчная латиница, цифры, «_» или «-» (до 24 символов)',
      })
    } else if (RESERVED_SERVER_NAMES.has(slot)) {
      issues.push({
        code: 'slot.reserved',
        path: ['slot'],
        message: `Имя «${slot}» зарезервировано встроенным хранилищем`,
      })
    }

    const rawUrl = String(values.url ?? '').trim()
    try {
      parseS3Url(rawUrl)
    } catch (err) {
      issues.push({
        code: 'url.invalid',
        path: ['url'],
        message:
          err instanceof Error
            ? err.message.replace(/^\[storage\/s3\]\s*/, '')
            : 'Некорректная ссылка s3://key:secret@host/bucket',
      })
    }

    const storageMb = Number(String(values.storage_mb ?? '').trim())
    if (!Number.isInteger(storageMb) || storageMb < 1 || storageMb > 1_048_576) {
      issues.push({
        code: 'number.range',
        path: ['storage_mb'],
        message: 'Укажите целое число от 1 до 1 048 576 МБ',
      })
    }

    const fileMb = Number(String(values.file_mb ?? '').trim())
    if (!Number.isInteger(fileMb) || fileMb < 1 || fileMb > 1_048_576) {
      issues.push({
        code: 'number.range',
        path: ['file_mb'],
        message: 'Укажите целое число от 1 до 1 048 576 МБ',
      })
    } else if (Number.isInteger(storageMb) && fileMb > storageMb) {
      issues.push({
        code: 'number.max',
        path: ['file_mb'],
        message: 'Лимит одного файла не может превышать общий лимит хранилища',
      })
    }

    if (issues.length > 0) {
      return { ok: false, issues }
    }

    return {
      ok: true,
      id: slot,
      entry: {
        url: rawUrl,
        storageMb,
        fileMb,
        readOnly: Boolean(values.read_only),
      },
    }
  },

  mask(id, entry) {
    let summary = 's3://***'
    try {
      summary = maskS3Url(entry.url)
    } catch {
      summary = 's3://***'
    }
    return {
      label: id,
      summary,
      meta: {
        storageMb: entry.storageMb,
        fileMb: entry.fileMb,
        readOnly: entry.readOnly,
      },
    }
  },
})
