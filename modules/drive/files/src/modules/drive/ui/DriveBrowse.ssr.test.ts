import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { DriveCapabilities } from '#core/lib/drive/index.js'
import type { PaginatorState } from '#core/lib/paginate/index.js'
import type { DriveListItem, DriveListRouteData } from '../types.js'
import { DRIVE_NAME, driveSource, ensureDrivePaginator } from '../source.js'
import DriveBrowse from './DriveBrowse.svelte'

// `Listing` без хоста модалок не рисуется: подменяем только ссылку фильтров
// и адрес приложения, как это делает тест `Listing.sidebar`.
vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/drive'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$app/navigation')>()
  return { ...actual, preloadData: async () => ({ type: 'error' }) }
})
vi.mock('#core/hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => () => ({ href: '/probe/filters', 'data-modal-link': '' }),
  }
})

beforeAll(() => ensureDrivePaginator())

const NODE = '11111111-1111-4111-8111-111111111111'
const OWNER = '22222222-2222-4222-8222-222222222222'
const CRUMB = '33333333-3333-4333-8333-333333333333'

const item = (canWrite: boolean): DriveListItem => ({
  id: NODE,
  node: {
    id: NODE,
    ownerId: OWNER,
    parentId: CRUMB,
    kind: 'file',
    name: 'отчёт.pdf',
    fileId: `drive/${OWNER}/${NODE}`,
    size: 2048,
    contentType: 'application/pdf',
    hash: 'ab'.repeat(32),
    starred: true,
    trashedAt: null,
    trashedFrom: null,
    createdAt: new Date('2026-01-01T10:00:00Z'),
    updatedAt: new Date('2026-01-02T10:00:00Z'),
  },
  caps: { canRead: true, canWrite, canShare: canWrite },
})

function page(caps: DriveCapabilities): DriveListRouteData {
  const entry = item(caps.canWrite)
  const snapshot: PaginatorState<DriveListItem> = {
    name: DRIVE_NAME,
    page: 1,
    pageSize: 30,
    totalItems: 1,
    totalPages: 1,
    extra: { _list: 'root' },
    loadedPages: [1],
    pages: { 1: [entry] },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: false,
    hasPrev: false,
    reqId: 0,
    capabilities: driveSource.capabilitiesFor({}),
  }
  return {
    snapshot,
    fact: null,
    enabled: true,
    identity: 'root',
    pathname: '/drive',
    folder: null,
    caps,
    quota: { used: 2048, limit: 5 * 1024 ** 3, remaining: 5 * 1024 ** 3 - 2048 },
    breadcrumbs: [{ id: CRUMB, name: 'Работа' }],
    trashed: false,
    folders: [{ id: CRUMB, label: 'Работа' }],
    notice: null,
    pick: null,
  }
}

const reader: DriveCapabilities = { canRead: true, canWrite: false, canShare: false }
const writer: DriveCapabilities = { canRead: true, canWrite: true, canShare: true }

describe('DriveBrowse SSR', () => {
  it('читатель видит файл, крошки и квоту, но не действия записи', () => {
    const { body } = render(DriveBrowse, { props: { initial: page(reader) } })
    expect(body).toContain('отчёт.pdf')
    expect(body).toContain('Работа')
    expect(body).toContain('2 КБ')
    expect(body).toContain('drive-readonly')
    expect(body).not.toContain('В корзину')
    expect(body).not.toContain('Переименовать')
  })

  it('редактор видит ссылки операций вместо inline-форм', () => {
    const { body } = render(DriveBrowse, { props: { initial: page(writer) } })
    expect(body).toContain('отчёт.pdf')
    expect(body).not.toContain('drive-readonly')
    expect(body).toContain('В корзину')
    expect(body).toContain('Переименовать')
    // Ссылка операции ведёт на свой fallback route, а не на `?/rename`.
    expect(body).toContain('/drive/rename')
    expect(body).not.toContain('?/rename')
  })
})
