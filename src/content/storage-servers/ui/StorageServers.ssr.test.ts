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

  it('редактор (storage.edit, canEdit=true) видит карточки серверов, единый тег формы и кнопки управления', () => {
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
    expect((body.match(/<form\b/g) ?? []).length).toBe(1)
  })
})

describe('StorageServersView: parity с эталоном по применимым возможностям (S20)', () => {
  const facts = ['s3_primary', 'S3', 'Приоритет 10', '10240', '512', 's3://***@s3.example.com/bucket/app']

  it('читатель и редактор видят одни и те же факты строки — оформление общее', () => {
    const reader = render(StorageServersView, {
      props: { authorized: true, enabled: true, initial: sampleRouteData(false) },
    }).body
    const editor = render(StorageServersView, {
      props: { authorized: true, enabled: true, initial: sampleRouteData(true) },
    }).body

    for (const fact of facts) {
      expect(reader).toContain(fact)
      expect(editor).toContain(fact)
    }
    // Негативный контроль: кнопки — не оформление, их набор зависит от права.
    expect(reader).not.toContain('storage-server-edit-s3_primary')
    expect(editor).toContain('storage-server-edit-s3_primary')
  })

  it('пул не получает порций и фильтров: их контракта у модуля нет', () => {
    const body = render(StorageServersView, {
      props: { authorized: true, enabled: true, initial: sampleRouteData(true) },
    }).body

    expect(body).not.toContain('storage-servers-paginator')
    expect(body).not.toContain('storage-servers-filters')
    // Единственный тег формы — тег пула: кнопки строк подчиняются ему.
    expect((body.match(/<form\b/g) ?? []).length).toBe(1)
  })
})
