import { describe, expect, it } from 'vitest'
import { render } from 'svelte/server'
import type { DrivePageData } from '../types.js'
import DriveBrowse from './DriveBrowse.svelte'

const page = (canWrite: boolean): DrivePageData => ({
  enabled: true,
  fact: null,
  folder: null,
  caps: { canRead: true, canWrite, canShare: canWrite },
  items: [
    {
      node: {
        id: '11111111-1111-4111-8111-111111111111',
        ownerId: '22222222-2222-4222-8222-222222222222',
        parentId: null,
        kind: 'file',
        name: 'отчёт.pdf',
        fileId: 'drive/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111',
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
    },
  ],
  breadcrumbs: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Работа' }],
  quota: { used: 2048, limit: 5 * 1024 ** 3, remaining: 5 * 1024 ** 3 - 2048 },
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
  total: 1,
  paged: false,
})

describe('DriveBrowse SSR', () => {
  it('читатель видит файл, крошки и квоту, но не действия записи', () => {
    const { body } = render(DriveBrowse, { props: { initial: page(false) } })
    expect(body).toContain('отчёт.pdf')
    expect(body).toContain('Работа')
    expect(body).toContain('2 КБ')
    expect(body).toContain('drive-readonly')
    expect(body).not.toContain('drive-create')
    expect(body).not.toContain('В корзину')
  })

  it('редактор видит тот же список без пометки «только просмотр»', () => {
    const { body } = render(DriveBrowse, { props: { initial: page(true) } })
    expect(body).toContain('отчёт.pdf')
    expect(body).not.toContain('drive-readonly')
    expect(body).toContain('drive-create')
    expect(body).toContain('Создать папку')
    expect(body).toContain('В корзину')
  })

  it('фильтры — GET-форма, курсор даёт «Дальше», активный фильтр — «Сбросить»', () => {
    const { body } = render(DriveBrowse, {
      props: {
        initial: {
          ...page(true),
          search: 'бета',
          type: 'file',
          from: '2026-01-01',
          to: '2026-01-31',
          nextCursor: 'next-cursor',
          total: 2,
          paged: true,
        },
      },
    })
    expect(body).toContain('drive-filters')
    expect(body).toContain('method="get"')
    expect(body).toContain('action="/drive"')
    expect(body).toContain('name="drive.q"')
    expect(body).toContain('name="drive.type"')
    expect(body).toContain('name="drive.from"')
    expect(body).toContain('name="drive.to"')
    expect(body).toContain('value="2026-01-01"')
    expect(body).toContain('drive.from=2026-01-01')
    expect(body).toContain('drive.to=2026-01-31')
    // Без JS GET не должен тащить конверт формы или старый курсор.
    const filterForm = body.slice(
      body.indexOf('data-testid="drive-filters"'),
      body.indexOf('</form>', body.indexOf('data-testid="drive-filters"')),
    )
    expect(filterForm).not.toContain('__form_')
    expect(filterForm).not.toContain('name="drive.after"')
    expect(body).toContain('Показано 1 из 2')
    expect(body).toContain('Дальше')
    expect(body).toContain('В начало')
    expect(body).toContain('Сбросить')
    expect(body).toContain('?drive.q=%D0%B1%D0%B5%D1%82%D0%B0')
    expect(body).toContain('drive.after=next-cursor')
  })
})
