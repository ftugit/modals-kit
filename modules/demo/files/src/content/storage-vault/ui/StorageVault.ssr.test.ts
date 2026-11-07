import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import { storageVaultSchema } from '../schema.js'
import StorageVaultView from './StorageVaultView.svelte'

const snapshot = {
  scope: 'storage',
  hasKey: true,
  maxEntries: 8,
  items: [
    {
      id: 's3_main',
      label: 's3_main',
      summary: 's3://***@s3.example.com/bucket/app',
      updatedAt: '2026-11-06T00:00:00.000Z',
      meta: {
        storageMb: 5120,
        fileMb: 512,
        readOnly: false,
        allowSplit: true,
        encrypted: true,
      },
    },
  ],
}

describe('StorageVaultView', () => {
  it('берёт общую форму сейфа и не заводит отдельную форму сброса', () => {
    expect(storageVaultSchema.form.id).toBe('storage-server-vault')
    expect(storageVaultSchema.form.byName.priority).toBeUndefined()
    expect('resetKeyForm' in storageVaultSchema).toBe(false)

    const reserved = storageVaultSchema.parse({
      slot: 'local_dev',
      url: 's3://key:secret@s3.example.com/bucket/app',
      storage_mb: '8',
      file_mb: '2',
    })
    expect(reserved.ok).toBe(false)

    const { body } = render(StorageVaultView, { props: { snapshot } })
    expect(body).toContain('data-testid="storage-vault-entry-form"')
    expect(body).toContain('data-testid="vault-save-submit"')
    expect(body).toContain('data-testid="vault-reset-key"')
    expect(body).toContain('Проверить и сохранить')
    expect(body).not.toContain('confirm_scope')
    expect(body).not.toContain('name="priority"')
    expect(body).toContain('form="storage-server-vault"')
    // Форма слота и форма удаления строки. Сброс ключа — кнопка той же формы слота.
    expect((body.match(/<form\b/g) ?? []).length).toBe(2)
  })
})
