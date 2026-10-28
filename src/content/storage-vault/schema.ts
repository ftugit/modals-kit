import {
  defineCookieVault,
  VAULT_SLOT_ID_RE,
} from '#hooks/cookie-vault/index.js'
import { defineForm, field, v, type IssueLike } from '#lib/form/index.js'
import { maskS3Url, parseS3Url } from '#lib/storage/s3.js'
import { isWebdavDsn, maskWebdavUrl, parseWebdavUrl } from '#lib/storage/webdav.js'

const RESERVED_SERVER_NAMES = new Set(['auto', 'local', 'memory'])

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
      label: 'Единая ссылка хранилища (DSN s3:// или webdav://)',
      placeholder:
        's3://key:secret@host/bucket/prefix или webdav://user@mail.ru:pass@webdav.cloud.mail.ru/dir',
      help: 'Шифруется в отдельной HttpOnly-куке (AES-256-GCM) и никогда не возвращается в HTML.',
      validate: [v.required(), v.maxLength(2048)],
    }),
    encryption_key: field.password({
      label: 'Ключ потокового шифрования файлов (необязательно)',
      placeholder: 'Парольная фраза для прозрачного AES-256-GCM (64 КБ блоки + Range)',
      validate: [v.maxLength(256)],
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
    allow_split: field.checkbox({
      label: 'Разрешить хранение частей больших файлов (allowSplit)',
      defaultValue: true,
    }),
    read_only: field.checkbox({
      label: 'Только чтение (readOnly — блокировать запись и удаление)',
      defaultValue: false,
    }),
  },
})

export const storageVaultSchema = defineCookieVault<StorageVaultEntry, StorageVaultMeta>({
  scope: 'storage',
  title: 'Куки-сейф хранилищ (S3 / WebDAV)',
  description:
    'Одна кука dv_key хранит мастер-ключ шифрования, а каждый сервер S3 или WebDAV со своим конфигом сохраняется в отдельной зашифрованной HttpOnly-куке вашего браузера.',
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
      if (isWebdavDsn(rawUrl)) {
        parseWebdavUrl(rawUrl)
      } else {
        parseS3Url(rawUrl)
      }
    } catch (err) {
      issues.push({
        code: 'url.invalid',
        path: ['url'],
        message:
          err instanceof Error
            ? err.message.replace(/^\[storage\/(?:s3|webdav)\]\s*/, '')
            : 'Некорректная ссылка s3://... или webdav://...',
      })
    }

    const encryptionKey = String(values.encryption_key ?? '').trim()

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
        allowSplit: values.allow_split !== undefined ? Boolean(values.allow_split) : true,
        ...(encryptionKey ? { encryptionKey } : {}),
      },
    }
  },

  mask(id, entry) {
    let summary = isWebdavDsn(entry.url) ? 'webdav://***' : 's3://***'
    try {
      summary = isWebdavDsn(entry.url) ? maskWebdavUrl(entry.url) : maskS3Url(entry.url)
    } catch {
      summary = isWebdavDsn(entry.url) ? 'webdav://***' : 's3://***'
    }
    return {
      label: id,
      summary,
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
