import type { IssueLike } from '#lib/form/index.js'
import { maskS3Url, parseS3Url } from '#lib/storage/s3.js'
import { isWebdavDsn, maskWebdavUrl, parseWebdavUrl } from '#lib/storage/webdav.js'
import { VAULT_SLOT_ID_RE } from '#hooks/cookie-vault/schema.js'

/** Имена, которые нельзя занять слотом ни в пуле, ни в сейфе. */
export const STORAGE_SERVER_RESERVED_SLOTS = new Set([
  'auto',
  'local',
  'local_dev',
  'memory',
  'shard_a',
  'shard_b',
  'split_demo',
])

const MB_MAX = 1_048_576

export interface StorageServerEntry {
  readonly slot: string
  /** Идентификатор строки пула. В сейфе пусто: слот перезаписывается по имени. */
  readonly serverId: string | null
  readonly url: string
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit: boolean
  readonly encryptionKey?: string
  readonly clearEncryptionKey?: boolean
  readonly priority?: number
}

export interface StorageServerMaskedMeta {
  readonly storageMb: number
  readonly fileMb: number
  readonly readOnly: boolean
  readonly allowSplit: boolean
  readonly encrypted: boolean
  readonly protocol: 's3' | 'webdav'
  readonly priority?: number
}

export type StorageServerParseResult =
  | { readonly ok: true; readonly id: string; readonly entry: StorageServerEntry }
  | { readonly ok: false; readonly issues: readonly IssueLike[] }

export interface ParseStorageServerOptions {
  withPriority?: boolean
  /** Пустой URL при непустом `server_id` оставляет прежний адрес (правка пула). */
  allowEditExisting?: boolean
  reserved?: ReadonlySet<string>
}

function issue(path: string, message: string, code: string): IssueLike {
  return { path: [path], message, code }
}

function dsnError(err: unknown): string {
  if (err instanceof Error) {
    return err.message.replace(/^\[storage\/(?:s3|webdav)\]\s*/, '')
  }
  return 'Некорректная ссылка s3://… или webdav://…'
}

/** Разобрать поля формы в запись сервера. `id` результата — имя слота. */
export function parseStorageServerEntry(
  values: Readonly<Record<string, unknown>>,
  options: ParseStorageServerOptions = {},
): StorageServerParseResult {
  const issues: IssueLike[] = []
  const reserved = options.reserved ?? STORAGE_SERVER_RESERVED_SLOTS
  const serverId = String(values.server_id ?? '').trim() || null
  const editing = Boolean(options.allowEditExisting && serverId)
  const slot = String(values.slot ?? '').trim().toLowerCase()

  if (!editing) {
    if (!VAULT_SLOT_ID_RE.test(slot)) {
      issues.push(issue('slot', 'Имя слота: строчная латиница, цифры, «_» или «-» (до 24 символов)', 'storage.slot-invalid'))
    } else if (reserved.has(slot)) {
      issues.push(issue('slot', `Имя «${slot}» зарезервировано встроенным хранилищем`, 'storage.slot-reserved'))
    }
  }

  const rawUrl = String(values.url ?? '').trim()
  if (!rawUrl && !editing) {
    issues.push(issue('url', 'Укажите корректную ссылку хранилища s3://… или webdav://…', 'storage.url-invalid'))
  } else if (rawUrl) {
    try {
      if (isWebdavDsn(rawUrl)) parseWebdavUrl(rawUrl)
      else parseS3Url(rawUrl)
    } catch (err) {
      issues.push(issue('url', dsnError(err), 'storage.url-invalid'))
    }
  }

  const encryptionKey = String(values.encryption_key ?? '').trim()
  if (encryptionKey && (encryptionKey.length < 8 || encryptionKey.length > 256)) {
    issues.push(issue('encryption_key', 'Ключ шифрования файлов должен содержать от 8 до 256 символов', 'storage.key-invalid'))
  }

  const storageMb = Number(String(values.storage_mb ?? '').trim())
  if (!Number.isInteger(storageMb) || storageMb < 1 || storageMb > MB_MAX) {
    issues.push(issue('storage_mb', 'Укажите целое число от 1 до 1 048 576 МБ', 'storage.limits-invalid'))
  }

  const fileMb = Number(String(values.file_mb ?? '').trim())
  if (!Number.isInteger(fileMb) || fileMb < 1 || fileMb > MB_MAX) {
    issues.push(issue('file_mb', 'Укажите целое число от 1 до 1 048 576 МБ', 'storage.limits-invalid'))
  } else if (Number.isInteger(storageMb) && fileMb > storageMb) {
    issues.push(issue('file_mb', 'Лимит одного файла не может превышать общий лимит хранилища', 'storage.limits-invalid'))
  }

  let priority: number | undefined
  if (options.withPriority) {
    priority = Number(String(values.priority ?? '').trim())
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
      issues.push(issue('priority', 'Приоритет — целое число от 0 до 10 000', 'storage.limits-invalid'))
    }
  }

  if (issues.length > 0) return { ok: false, issues }

  return {
    ok: true,
    id: editing ? slot || String(serverId) : slot,
    entry: {
      slot,
      serverId,
      url: rawUrl,
      storageMb,
      fileMb,
      readOnly: Boolean(values.read_only),
      allowSplit: values.allow_split !== undefined ? Boolean(values.allow_split) : true,
      ...(encryptionKey ? { encryptionKey } : {}),
      ...(options.allowEditExisting ? { clearEncryptionKey: Boolean(values.clear_encryption_key) } : {}),
      ...(priority !== undefined ? { priority } : {}),
    },
  }
}

/** Маска DSN для HTML. Секреты в summary не попадают. */
export function maskStorageServerEntry(
  id: string,
  entry: Pick<StorageServerEntry, 'url' | 'storageMb' | 'fileMb' | 'readOnly' | 'allowSplit' | 'encryptionKey' | 'priority'>,
): { label: string; summary: string; meta: StorageServerMaskedMeta } {
  const webdav = isWebdavDsn(entry.url)
  let summary = webdav ? 'webdav://***' : 's3://***'
  try {
    summary = webdav ? maskWebdavUrl(entry.url) : maskS3Url(entry.url)
  } catch {
    summary = webdav ? 'webdav://***' : 's3://***'
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
      protocol: webdav ? 'webdav' : 's3',
      ...(entry.priority !== undefined ? { priority: entry.priority } : {}),
    },
  }
}
