import { beforeAll, describe, expect, it, vi } from 'vitest'
import { render } from 'svelte/server'
import type { DriveCapabilities } from '#core/lib/drive/index.js'
import type { PaginatorState } from '#core/lib/paginate/index.js'
import type { DriveListItem, DriveListRouteData, DrivePickerData } from '../types.js'
import { DRIVE_NAME, driveSource, ensureDrivePaginator } from '../source.js'
import DrivePicker from './DrivePicker.svelte'

vi.mock('$app/state', () => ({
  page: { url: new URL('http://localhost/drive/pick'), state: {}, data: {} },
  navigating: { to: null, from: null, type: null },
}))
vi.mock('$app/navigation', () => ({ preloadData: async () => ({ type: 'error' }) }))
vi.mock('#core/hooks/links/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('#core/hooks/links/index.js')>()
  return {
    ...actual,
    useModalLink: () => () => ({ href: '/probe/filters', 'data-modal-link': '' }),
  }
})

beforeAll(() => ensureDrivePaginator())

const OWNER = '22222222-2222-4222-8222-222222222222'
const FILE = '11111111-1111-4111-8111-111111111111'
const FOLDER = '33333333-3333-4333-8333-333333333333'
const CAPS: DriveCapabilities = { canRead: true, canWrite: true, canShare: true }

const node = (id: string, kind: 'file' | 'folder', name: string) => ({
  id,
  ownerId: OWNER,
  parentId: null,
  kind,
  name,
  fileId: kind === 'file' ? `drive/${OWNER}/${id}` : null,
  size: kind === 'file' ? 1024 : 0,
  contentType: kind === 'file' ? 'text/plain' : null,
  hash: null,
  starred: false,
  trashedAt: null,
  trashedFrom: null,
  createdAt: new Date('2026-01-01T10:00:00Z'),
  updatedAt: new Date('2026-01-02T10:00:00Z'),
})

const entry = (id: string, kind: 'file' | 'folder', name: string): DriveListItem => ({
  id,
  node: node(id, kind, name),
  caps: CAPS,
})

function list(items: DriveListItem[]): DriveListRouteData {
  const snapshot: PaginatorState<DriveListItem> = {
    name: DRIVE_NAME,
    page: 1,
    pageSize: 30,
    totalItems: items.length,
    totalPages: 1,
    extra: { _list: 'root' },
    loadedPages: [1],
    pages: { 1: items },
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
    caps: CAPS,
    quota: { used: 1024, limit: 1024 ** 3, remaining: 1024 ** 3 - 1024 },
    breadcrumbs: [],
    trashed: false,
    notice: null,
    pick: null,
  }
}

const picker = (kind: 'any' | 'folder', items: DriveListItem[]): DrivePickerData => ({
  list: list(items),
  from: '/drive',
  param: kind === 'folder' ? 'target_id' : 'id',
  kind,
  folderId: null,
})

describe('DrivePicker SSR', () => {
  it('режим папок показывает только папки и подписывает выбор', () => {
    // Фильтр `kind=folder` применяет сервер: в срез файлы уже не попадают.
    const { body } = render(DrivePicker, {
      props: { initial: picker('folder', [entry(FOLDER, 'folder', 'Документы')]) },
    })
    expect(body).toContain('Документы')
    expect(body).not.toContain('отчёт.pdf')
    expect(body).toContain('Выбрать')
    expect(body).toContain('Выбрать корень диска')
  })

  it('обычный режим показывает и файлы', () => {
    const { body } = render(DrivePicker, {
      props: {
        initial: picker('any', [
          entry(FOLDER, 'folder', 'Документы'),
          entry(FILE, 'file', 'отчёт.pdf'),
        ]),
      },
    })
    expect(body).toContain('Документы')
    expect(body).toContain('отчёт.pdf')
    expect(body).toContain('Выбрать')
  })
})
