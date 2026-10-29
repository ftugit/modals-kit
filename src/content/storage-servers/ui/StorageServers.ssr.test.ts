import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import StorageServersView from './StorageServersView.svelte'
import type { StorageServersRouteData } from '../types.js'

const sampleRouteData = (canEdit: boolean): StorageServersRouteData => ({
  enabled: true,
  fact: null,
  slice: {
    activeMode: 'pool',
    hasDevFallback: false,
    canEdit,
    items: [
      {
        id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        slot: 's3_primary',
        priority: 10,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        meta: {
          summary: 's3://***@s3.example.com/bucket/app',
          protocol: 's3',
          storageMb: 10240,
          fileMb: 512,
          readOnly: false,
          allowSplit: true,
          encrypted: true,
        },
      },
    ],
  },
})

describe('StorageServersView SSR (STORAGE_ACL)', () => {
  it('читатель (storage.read, canEdit=false) видит пул и замаскированный summary без формы и кнопок удаления', () => {
    const { body } = render(StorageServersView, {
      props: {
        authorized: true,
        enabled: true,
        initial: sampleRouteData(false),
      },
    })
    expect(body).toContain('s3_primary')
    expect(body).toContain('Боевой пул БД')
    expect(body).toContain('AES-256-GCM')
    expect(body).toContain('s3://***@s3.example.com/bucket/app')
    expect(body).not.toContain('data-testid="storage-server-form"')
    expect(body).not.toContain('data-testid="storage-server-delete-s3_primary"')
  })

  it('редактор (storage.edit, canEdit=true) видит карточки серверов, форму добавления и кнопки управления', () => {
    const { body } = render(StorageServersView, {
      props: {
        authorized: true,
        enabled: true,
        initial: sampleRouteData(true),
      },
    })
    expect(body).toContain('s3_primary')
    expect(body).toContain('data-testid="storage-server-form"')
    expect(body).toContain('data-testid="storage-server-edit-s3_primary"')
    expect(body).toContain('data-testid="storage-server-delete-s3_primary"')
    expect(body).toContain('Проверить и добавить')
  })
})
