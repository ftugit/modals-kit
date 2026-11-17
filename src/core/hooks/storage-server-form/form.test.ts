import { describe, expect, it } from 'vitest'
import {
  STORAGE_SERVER_ADMIN_FORM_ID,
  STORAGE_SERVER_VAULT_FORM_ID,
  defineStorageServerForm,
  maskStorageServerEntry,
  parseStorageServerEntry,
} from './index.js'

const S3 = 's3://key:secret@s3.example.com/bucket/app'

describe('storage-server-form', () => {
  it('пул и сейф делят определение, но не id и не поля пула', () => {
    const admin = defineStorageServerForm({
      id: STORAGE_SERVER_ADMIN_FORM_ID,
      withPriority: true,
    })
    const vault = defineStorageServerForm({
      id: STORAGE_SERVER_VAULT_FORM_ID,
      withPriority: false,
    })

    expect(admin.id).toBe('storage-server-admin')
    expect(vault.id).toBe('storage-server-vault')
    expect(admin.id).not.toBe(vault.id)
    expect(admin.actions.map((action) => action.id)).toEqual(['save', 'delete', 'reset-key'])
    expect(admin.actions.find((action) => action.id === 'delete')?.validate).toBe('none')
    expect(admin.actions.find((action) => action.id === 'reset-key')?.validate).toBe('none')
    expect(admin.byName.priority).toBeDefined()
    expect(admin.byName.server_id).toBeDefined()
    expect(admin.byName.clear_encryption_key).toBeDefined()
    expect(vault.byName.priority).toBeUndefined()
    expect(vault.byName.server_id).toBeUndefined()
    expect(vault.byName.clear_encryption_key).toBeUndefined()
    expect(vault.byName.slot?.name).toBe('slot')
    expect(vault.byName.url?.name).toBe('url')
  })

  it('разбирает слот s3 и маскирует секрет в summary', () => {
    const parsed = parseStorageServerEntry({
      slot: 'S3_Main',
      url: S3,
      storage_mb: '5120',
      file_mb: '512',
      allow_split: true,
      read_only: false,
      encryption_key: 'phrase-ok',
    })

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.id).toBe('s3_main')
    expect(parsed.entry.storageMb).toBe(5120)
    expect(parsed.entry.encryptionKey).toBe('phrase-ok')
    expect(parsed.entry.priority).toBeUndefined()

    const masked = maskStorageServerEntry(parsed.id, parsed.entry)
    expect(masked.label).toBe('s3_main')
    expect(masked.summary).not.toContain('secret')
    expect(masked.summary).not.toContain('phrase-ok')
    expect(masked.meta.protocol).toBe('s3')
    expect(masked.meta.encrypted).toBe(true)
  })

  it('отклоняет резерв, пустой адрес и короткий ключ', () => {
    const reserved = parseStorageServerEntry({
      slot: 'local_dev',
      url: S3,
      storage_mb: '8',
      file_mb: '2',
    })
    expect(reserved.ok).toBe(false)
    if (!reserved.ok) expect(reserved.issues.some((issue) => issue.code === 'storage.slot-reserved')).toBe(true)

    const empty = parseStorageServerEntry({
      slot: 's3_main',
      url: '   ',
      storage_mb: '8',
      file_mb: '2',
    })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.issues.some((issue) => issue.path?.[0] === 'url')).toBe(true)

    const shortKey = parseStorageServerEntry({
      slot: 's3_main',
      url: S3,
      encryption_key: 'short',
      storage_mb: '8',
      file_mb: '2',
    })
    expect(shortKey.ok).toBe(false)
    if (!shortKey.ok) expect(shortKey.issues.some((issue) => issue.code === 'storage.key-invalid')).toBe(true)
  })

  it('сохраняет допустимый ключ с управляющим символом без изменения контракта', () => {
    const parsed = parseStorageServerEntry({
      slot: 's3_main', url: S3, encryption_key: 'abcdefgh\u0001', storage_mb: '8', file_mb: '2',
    })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.entry.encryptionKey).toBe('abcdefgh\u0001')
  })

  it('правка пула оставляет пустой url при server_id и принимает приоритет', () => {
    const edited = parseStorageServerEntry(
      {
        server_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        slot: 's3_main',
        url: '',
        storage_mb: '10',
        file_mb: '2',
        priority: '10',
        clear_encryption_key: true,
      },
      { allowEditExisting: true, withPriority: true },
    )

    expect(edited.ok).toBe(true)
    if (!edited.ok) return
    expect(edited.id).toBe('s3_main')
    expect(edited.entry.url).toBe('')
    expect(edited.entry.serverId).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    expect(edited.entry.priority).toBe(10)
    expect(edited.entry.clearEncryptionKey).toBe(true)
  })
})
