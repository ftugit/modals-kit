/**
 * Этап 2 `plan-drive.md`: модель, права и срез папки на настоящей PGlite.
 *
 * Проверяются не только удачные срезы: чужая папка не открывается по id,
 * одноимённый узел не вставляется, перенос в собственное поддерево
 * отклоняется, а квота считает логические байты живых файлов.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#core/lib/db/index.js'
import { pgliteAdapter } from '#core/lib/db/adapters/pglite.js'
import { defineSchema } from '#core/lib/db/sync/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import type { DriveNodeKind } from '#core/lib/drive/index.js'
import { checkDriveMove, isDriveNameTaken } from '../checks.js'
import { dbExtension } from '../db.ext.js'
import { driveNode, driveShare } from '../schema.js'
import type { DriveActor } from '../types.js'
import { DRIVE_SERVER, resolveDriveAccess } from './access.js'
import { driveUsedBytes, loadDriveSlice } from './query.js'

const test = (name: string, fn: () => Promise<void>) => it(name, fn, 60_000)

let shared: PGlite | undefined
afterAll(async () => {
  await shared?.close()
})

async function withDb(fn: (db: Database) => Promise<void>) {
  shared ??= new PGlite()
  await shared.exec('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  const driver = pgliteAdapter(shared)
  const resources = [auth, driveNode, driveShare]
  const report = await defineSchema({ resources, sql: dbExtension.sql }).sync(driver)
  expect(report.status).toBe('ok')
  const db = createDb({ driver, limits: conservativeLimits, resources })
  await fn(db)
}

let seeds = 0
async function account(db: Database): Promise<string> {
  seeds += 1
  const row = await db.resource(auth).insert(DRIVE_SERVER, { seed: `${String(seeds).padStart(2, '0')}${'a'.repeat(41)}` })
  return String(row.id)
}

const actor = (id: string, permissions: readonly string[] = []): DriveActor => ({ id, permissions })

interface NodePatch {
  name: string
  kind?: DriveNodeKind
  parentId?: string | null
  size?: number
  starred?: boolean
}

async function node(db: Database, ownerId: string, patch: NodePatch): Promise<string> {
  const id = crypto.randomUUID()
  // `id` задаётся заранее (он входит в байтовый путь), поэтому защита
  // системных полей снята точечно — как в тестах сессий.
  await db.resource(driveNode).without(['protect'], (api) =>
    api.insert(DRIVE_SERVER, {
      id,
      owner_id: ownerId,
      parent_id: patch.parentId ?? null,
      kind: patch.kind ?? 'folder',
      name: patch.name,
      file_id: (patch.kind ?? 'folder') === 'file' ? `drive/${ownerId}/${id}` : null,
      size: String(patch.size ?? 0),
      starred: patch.starred ?? false,
    }),
  )
  return id
}

async function trash(db: Database, id: string): Promise<void> {
  await db.resource(driveNode).update(DRIVE_SERVER, id, {
    trashed_at: new Date().toISOString(),
    trashed_from: null,
  })
}

test('чужой диск не протекает: ни в корень, ни по прямому id', async () => {
  await withDb(async (db) => {
    const me = await account(db)
    const them = await account(db)
    const mine = await node(db, me, { name: 'Отчёты' })
    const theirs = await node(db, them, { name: 'Секрет' })
    await node(db, them, { name: 'файл.txt', kind: 'file', parentId: theirs, size: 10 })

    const root = await loadDriveSlice(db, actor(me))
    expect(root.ok).toBe(true)
    if (!root.ok) return
    expect(root.value.slice.items.map((entry) => entry.node.id)).toEqual([mine])
    expect(JSON.stringify(root.value)).not.toContain('Секрет')

    const foreign = await loadDriveSlice(db, actor(me), { folderId: theirs })
    expect(foreign).toMatchObject({ ok: false, code: 'drive.not-found' })
    expect(await resolveDriveAccess(db, actor(me), theirs)).toBeNull()

    // Свой узел чужой аккаунт тоже не открывает — владелец имеет значение.
    expect(await resolveDriveAccess(db, actor(them), mine)).toBeNull()
  })
})

test('доступ по ссылке: viewer читает поддерево, editor пишет, корзина закрыта', async () => {
  await withDb(async (db) => {
    const owner = await account(db)
    const guest = await account(db)
    const sharedFolder = await node(db, owner, { name: 'Общее' })
    const child = await node(db, owner, { name: 'план.md', kind: 'file', parentId: sharedFolder, size: 5 })
    const other = await node(db, owner, { name: 'Личное' })

    await db.resource(driveShare).insert(DRIVE_SERVER, {
      node_id: sharedFolder,
      uid: guest,
      role: 'viewer',
    })

    const view = await loadDriveSlice(db, actor(guest), { folderId: sharedFolder })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.value.slice.items.map((entry) => entry.node.id)).toEqual([child])
    expect(view.value.caps).toEqual({ canRead: true, canWrite: false, canShare: false })
    expect(view.value.slice.items[0]?.caps).toEqual({ canRead: true, canWrite: false, canShare: false })
    expect(view.value.slice.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Общее'])

    // Чужой «Личное» рядом не виден даже через доступ к папке владельца.
    const root = await loadDriveSlice(db, actor(guest))
    expect(root.ok).toBe(true)
    if (root.ok) expect(root.value.slice.items).toHaveLength(0)

    // Корзина владельца недоступна тому, кто видит только папку.
    expect(
      await loadDriveSlice(db, actor(guest), { folderId: sharedFolder, trashed: true }),
    ).toMatchObject({ ok: false, code: 'drive.forbidden' })

    await db.resource(driveShare).update(DRIVE_SERVER, String(
      (await db.resource(driveShare).select(DRIVE_SERVER, {
        filter: { field: 'node_id', op: 'eq', value: sharedFolder },
      }))[0]!.id,
    ), { role: 'editor' })

    const editor = await resolveDriveAccess(db, actor(guest), child)
    expect(editor?.caps).toEqual({ canRead: true, canWrite: true, canShare: false })
    expect((await loadDriveSlice(db, actor(guest), { folderId: other })).ok).toBe(false)
  })
})

test('имя уникально без учёта регистра, перенос в своё поддерево отклоняется', async () => {
  await withDb(async (db) => {
    const me = await account(db)
    const folder = await node(db, me, { name: 'Отчёт' })
    await expect(node(db, me, { name: 'отчёт' })).rejects.toBeTruthy()
    expect(
      await db.resource(driveNode).count(DRIVE_SERVER, {
        filter: { field: 'owner_id', op: 'eq', value: me },
      }),
    ).toBe(1)

    const child = await node(db, me, { name: 'Внутри', parentId: folder })
    const folderView = (await resolveDriveAccess(db, actor(me), folder))!.node
    const childView = (await resolveDriveAccess(db, actor(me), child))!.node
    expect(checkDriveMove(folderView, folderView, [folder])).toBe('drive.move-self')
    expect(checkDriveMove(folderView, childView, [folder, child])).toBe('drive.move-cycle')
    expect(checkDriveMove(childView, folderView, [child])).toBeNull()

    // Помощник имени повторяет правило индекса: регистр не важен, свой id исключён.
    expect(isDriveNameTaken([{ id: folder, name: 'Отчёт' }], 'ОТЧЁТ')).toBe(true)
    expect(isDriveNameTaken([{ id: folder, name: 'Отчёт' }], 'ОТЧЁТ', folder)).toBe(false)
  })
})

test('срез: крошки, сортировка, курсор, поиск, звёздочка, корзина и квота', async () => {
  await withDb(async (db) => {
    const me = await account(db)
    const root = await node(db, me, { name: 'Работа' })
    const nested = await node(db, me, { name: '2026', parentId: root })
    for (const [name, size] of [['бета.txt', 30], ['альфа.txt', 10], ['гамма.txt', 20]] as const) {
      await node(db, me, { name, kind: 'file', parentId: nested, size })
    }
    const starred = await node(db, me, { name: 'важное', kind: 'file', parentId: root, size: 7, starred: true })

    const slice = await loadDriveSlice(db, actor(me), { folderId: nested })
    expect(slice.ok).toBe(true)
    if (!slice.ok) return
    expect(slice.value.slice.breadcrumbs.map((crumb) => crumb.name)).toEqual(['Работа', '2026'])
    expect(slice.value.slice.items.map((entry) => entry.node.name)).toEqual(['альфа.txt', 'бета.txt', 'гамма.txt'])
    expect(slice.value.slice.total).toBe(3)
    // Квота — по всему диску: три файла вложенной папки и звёздный файл корня.
    expect(slice.value.slice.quota.used).toBe(67)
    expect(slice.value.slice.quota.remaining).toBe(5 * 1024 ** 3 - 67)

    const bySize = await loadDriveSlice(db, actor(me), { folderId: nested, sort: 'size' })
    expect(bySize.ok).toBe(true)
    if (!bySize.ok) return
    expect(bySize.value.slice.items.map((entry) => entry.node.name)).toEqual(['бета.txt', 'гамма.txt', 'альфа.txt'])

    const first = await loadDriveSlice(db, actor(me), { folderId: nested, limit: 2 })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.value.slice.items.map((entry) => entry.node.name)).toEqual(['альфа.txt', 'бета.txt'])
    expect(first.value.slice.cursor).toBeTruthy()

    const second = await loadDriveSlice(db, actor(me), {
      folderId: nested,
      limit: 2,
      cursor: first.value.slice.cursor,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.slice.items.map((entry) => entry.node.name)).toEqual(['гамма.txt'])
    expect(second.value.slice.cursor).toBeNull()

    const search = await loadDriveSlice(db, actor(me), { search: 'ЕТА' })
    expect(search.ok).toBe(true)
    if (search.ok) expect(search.value.slice.items.map((item) => item.node.name)).toEqual(['бета.txt'])

    const stars = await loadDriveSlice(db, actor(me), { starred: true })
    expect(stars.ok).toBe(true)
    if (stars.ok) expect(stars.value.slice.items.map((item) => item.node.id)).toEqual([starred])

    // Фильтр типа режет срез до файлов или папок, не меняя остальные права.
    const onlyFiles = await loadDriveSlice(db, actor(me), { folderId: root, kind: 'file' })
    expect(onlyFiles.ok).toBe(true)
    if (onlyFiles.ok) expect(onlyFiles.value.slice.items.map((item) => item.node.name)).toEqual(['важное'])
    const onlyFolders = await loadDriveSlice(db, actor(me), { folderId: root, kind: 'folder' })
    expect(onlyFolders.ok).toBe(true)
    if (onlyFolders.ok) expect(onlyFolders.value.slice.items.map((item) => item.node.name)).toEqual(['2026'])

    // Даты изменения: будущее/прошлое не пересекается с только что созданными.
    const future = await loadDriveSlice(db, actor(me), { from: Date.now() + 60_000 })
    expect(future.ok).toBe(true)
    if (future.ok) expect(future.value.slice.items).toHaveLength(0)
    const past = await loadDriveSlice(db, actor(me), { to: Date.now() - 60_000 })
    expect(past.ok).toBe(true)
    if (past.ok) expect(past.value.slice.items).toHaveLength(0)

    // Помечаем всё поддерево удалённым: в корзине виден только его корень.
    await trash(db, nested)
    for (const id of (slice.value.slice.items ?? []).map((entry) => entry.node.id)) await trash(db, id)
    const trashView = await loadDriveSlice(db, actor(me), { trashed: true })
    expect(trashView.ok).toBe(true)
    if (!trashView.ok) return
    expect(trashView.value.slice.items.map((entry) => entry.node.id)).toEqual([nested])
    expect(await driveUsedBytes(db, me)).toBe(7)
  })
})

test('аудит: drive.read видит чужой диск, но не получает права писать и делиться', async () => {
  await withDb(async (db) => {
    const owner = await account(db)
    const folder = await node(db, owner, { name: 'Чужое' })
    const auditor = actor(await account(db), ['drive.read'])

    const view = await loadDriveSlice(db, auditor, { folderId: folder })
    expect(view.ok).toBe(true)
    if (!view.ok) return
    expect(view.value.folder?.name).toBe('Чужое')
    expect(view.value.caps).toEqual({ canRead: true, canWrite: false, canShare: false })
    expect(await loadDriveSlice(db, auditor, { trashed: true })).toMatchObject({ ok: true })
  })
})
