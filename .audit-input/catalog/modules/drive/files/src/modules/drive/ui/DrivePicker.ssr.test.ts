import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { DriveEntry } from '#core/lib/drive/index.js'
import type { DrivePageData } from '../types.js'
import DrivePicker from './DrivePicker.svelte'

const entry = (id: string, name: string, kind: 'file' | 'folder'): DriveEntry => ({
  node: {
    id,
    ownerId: '22222222-2222-4222-8222-222222222222',
    parentId: null,
    kind,
    name,
    fileId: kind === 'file' ? `drive/${id}` : null,
    size: kind === 'file' ? 10 : 0,
    contentType: null,
    hash: null,
    starred: false,
    trashedAt: null,
    trashedFrom: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
  },
  caps: { canRead: true, canWrite: true, canShare: true },
})

const page: DrivePageData = {
  enabled: true,
  fact: null,
  folder: null,
  caps: { canRead: true, canWrite: true, canShare: true },
  items: [
    entry('11111111-1111-4111-8111-111111111111', 'Документы', 'folder'),
    entry('33333333-3333-4333-8333-333333333333', 'отчёт.pdf', 'file'),
  ],
  breadcrumbs: [],
  quota: { used: 10, limit: 100, remaining: 90 },
  trashed: false,
  node: null,
  folders: [],
  shares: [],
  notice: null,
  pick: null,
  sort: 'name',
  search: null,
  type: 'all',
  starred: false,
  pageSize: 30,
  from: null,
  to: null,
  nextCursor: null,
  total: 2,
  paged: false,
}

describe('DrivePicker SSR', () => {
  it('режим папок скрывает файлы и подписывает выбор папки', () => {
    const { body } = render(DrivePicker, {
      props: { initial: page, from: '/drive', param: 'target_id', kind: 'folder' },
    })
    expect(body).toContain('Документы')
    expect(body).not.toContain('отчёт.pdf')
    expect(body).toContain('Выбрать папку')
    expect(body).toContain('Выбрать корень диска')
  })

  it('обычный режим показывает и файлы', () => {
    const { body } = render(DrivePicker, {
      props: { initial: page, from: '/drive', param: 'id', kind: 'any' },
    })
    expect(body).toContain('отчёт.pdf')
    expect(body).toContain('Выбрать из диска')
  })
})
