/**
 * Этап 3 `plan-drive.md`: мутации и байты.
 *
 * Квота считается по логическому размеру, копия делит `file_id`, а очистка
 * удаляет объект только когда на него больше никто не ссылается. Хранилище
 * подменено портом: сервис не должен знать, S3 там или локальная папка.
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#core/lib/db/index.js'
import { pgliteAdapter } from '#core/lib/db/adapters/pglite.js'
import { defineSchema } from '#core/lib/db/sync/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import { dbExtension } from '../db.ext.js'
import { driveNode, driveShare } from '../schema.js'
import type { DriveActor } from '../types.js'
import { DRIVE_SERVER, resolveDriveAccess } from './access.js'
import {
  copyDriveNode,
  createDriveFolder,
  moveDriveNode,
  purgeDriveNode,
  renameDriveNode,
  restoreDriveNode,
  shareDriveNode,
  starDriveNode,
  trashDriveNode,
} from './mutate.js'
import { loadDriveSlice } from './query.js'
import { uploadDriveFile, type DriveUploadStorage } from './upload.js'

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
  await fn(createDb({ driver, limits: conservativeLimits, resources }))
}

let seeds = 0
async function account(db: Database): Promise<string> {
  seeds += 1
  const row = await db.resource(auth).insert(DRIVE_SERVER, {
    seed: `${String(seeds).padStart(2, '0')}${'b'.repeat(41)}`,
  })
  return String(row.id)
}

const actor = (id: string, permissions: readonly string[] = []): DriveActor => ({ id, permissions })

function fakeStorage(): DriveUploadStorage & { puts: string[]; dels: string[] } {
  const puts: string[] = []
  const dels: string[] = []
  return {
    puts,
    dels,
    async put(input) {
      puts.push(input.path)
      return { hash: `hash-${input.size}` }
    },
    async del(path) {
      dels.push(path)
      return true
    },
  }
}

test('папки, переименование, перенос, копия и звёздочка', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const work = await createDriveFolder(db, me, { name: 'Работа' })
    const archive = await createDriveFolder(db, me, { name: 'Архив' })
    expect(work.ok && archive.ok).toBe(true)
    if (!work.ok || !archive.ok) return

    const renamed = await renameDriveNode(db, me, { nodeId: work.value.id, name: 'Проекты' })
    expect(renamed.ok && renamed.value.name).toBe('Проекты')
    expect(await renameDriveNode(db, me, { nodeId: work.value.id, name: 'архив' })).toMatchObject({
      ok: false,
      code: 'drive.name-taken',
    })
    expect(await createDriveFolder(db, me, { name: 'ПРОЕКТЫ' })).toMatchObject({
      ok: false,
      code: 'drive.name-taken',
    })

    const moved = await moveDriveNode(db, me, { nodeId: work.value.id, targetId: archive.value.id })
    expect(moved.ok && moved.value.parentId).toBe(archive.value.id)
    // В собственную подпапку переносить нельзя.
    const inner = await createDriveFolder(db, me, { name: 'Внутри', parentId: work.value.id })
    expect(inner.ok).toBe(true)
    if (!inner.ok) return
    expect(await moveDriveNode(db, me, { nodeId: work.value.id, targetId: inner.value.id })).toMatchObject({
      ok: false,
      code: 'drive.move-cycle',
    })

    const copy = await copyDriveNode(db, me, { nodeId: work.value.id, targetId: null, name: 'Копия' })
    expect(copy.ok).toBe(true)
    if (!copy.ok) return
    const copiedChildren = await loadDriveSlice(db, me, { folderId: copy.value.id })
    expect(copiedChildren.ok).toBe(true)
    if (copiedChildren.ok) expect(copiedChildren.value.slice.items.map((i) => i.node.name)).toEqual(['Внутри'])

    expect((await starDriveNode(db, me, { nodeId: copy.value.id, starred: true })).ok).toBe(true)
    const starred = await loadDriveSlice(db, me, { starred: true })
    expect(starred.ok && starred.value.slice.items.map((i) => i.node.id)).toEqual([copy.value.id])
  })
})

test('корзина: поддерево целиком, восстановление к прежнему родителю, очистка', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const folder = await createDriveFolder(db, me, { name: 'Папка' })
    if (!folder.ok) return
    const storage = fakeStorage()
    const uploaded = await uploadDriveFile(
      db,
      me,
      { parentId: folder.value.id, name: 'файл.txt', body: new Uint8Array([1]), size: 1, contentType: 'text/plain' },
      { storage },
    )
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    expect(storage.puts).toEqual([uploaded.value.fileId])

    const trashed = await trashDriveNode(db, me, { nodeId: folder.value.id })
    expect(trashed.ok && trashed.value).toHaveLength(2)
    const trashView = await loadDriveSlice(db, me, { trashed: true })
    expect(trashView.ok && trashView.value.slice.items.map((i) => i.node.id)).toEqual([folder.value.id])

    const duplicate = await createDriveFolder(db, me, { name: 'Папка' })
    expect(duplicate.ok).toBe(true)
    const restored = await restoreDriveNode(db, me, { nodeId: folder.value.id })
    expect(restored).toMatchObject({ ok: false, code: 'drive.name-taken' })
    if (duplicate.ok) {
      await trashDriveNode(db, me, { nodeId: duplicate.value.id })
      await purgeDriveNode(db, me, { nodeId: duplicate.value.id })
    }

    const back = await restoreDriveNode(db, me, { nodeId: folder.value.id })
    expect(back.ok && back.value.trashedAt).toBeNull()
    const root = await loadDriveSlice(db, me)
    expect(root.ok && root.value.slice.items.map((i) => i.node.name)).toEqual(['Папка'])

    await trashDriveNode(db, me, { nodeId: folder.value.id })
    const purged = await purgeDriveNode(db, me, { nodeId: folder.value.id }, storage)
    expect(purged).toMatchObject({ ok: true, value: { deleted: 2, freed: 1 } })
    expect(storage.dels).toEqual([uploaded.value.fileId])
    expect(
      await db.resource(driveNode).count(DRIVE_SERVER, {
        filter: { field: 'owner_id', op: 'eq', value: me.id },
      }),
    ).toBe(0)
  })
})

test('копия делит байты: очистка одной не удаляет объект, второй — удаляет', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const storage = fakeStorage()
    const uploaded = await uploadDriveFile(
      db,
      me,
      { name: 'общий.txt', body: new Uint8Array([1, 2]), size: 2 },
      { storage },
    )
    expect(uploaded.ok).toBe(true)
    if (!uploaded.ok) return
    const copy = await copyDriveNode(db, me, { nodeId: uploaded.value.id, targetId: null, name: 'копия.txt' })
    expect(copy.ok && copy.value.fileId).toBe(uploaded.value.fileId)
    if (!copy.ok) return

    await trashDriveNode(db, me, { nodeId: uploaded.value.id })
    const first = await purgeDriveNode(db, me, { nodeId: uploaded.value.id }, storage)
    expect(first).toMatchObject({ ok: true, value: { freed: 0 } })
    expect(storage.dels).toEqual([])

    await trashDriveNode(db, me, { nodeId: copy.value.id })
    const second = await purgeDriveNode(db, me, { nodeId: copy.value.id }, storage)
    expect(second).toMatchObject({ ok: true, value: { freed: 1 } })
    expect(storage.dels).toEqual([uploaded.value.fileId])
  })
})

test('загрузка: квота по логическому размеру и перезапись по имени', async () => {
  await withDb(async (db) => {
    const me = actor(await account(db))
    const storage = fakeStorage()
    const first = await uploadDriveFile(
      db,
      me,
      { name: 'док.pdf', body: new Uint8Array([1, 2, 3]), size: 3, contentType: 'application/pdf' },
      { storage, quotaLimit: 5 },
    )
    expect(first.ok && first.value.hash).toBe('hash-3')
    if (!first.ok) return

    // Ранняя проверка квоты отсекает загрузку до записи байтов: чистить нечего.
    const putsBefore = storage.puts.length
    expect(
      await uploadDriveFile(
        db,
        me,
        { name: 'второй.bin', body: new Uint8Array([1, 2, 3]), size: 3 },
        { storage, quotaLimit: 5 },
      ),
    ).toMatchObject({ ok: false, code: 'drive.quota-over' })
    expect(storage.puts).toHaveLength(putsBefore)
    expect(storage.dels).toHaveLength(0)

    // Перезапись освобождает старый размер: 3 → 4 при пределе 5 проходит.
    const again = await uploadDriveFile(
      db,
      me,
      { name: 'ДОК.pdf', body: new Uint8Array([1, 2, 3, 4]), size: 4, contentType: 'application/pdf', overwrite: true },
      { storage, quotaLimit: 5 },
    )
    expect(again.ok && again.value.id).toBe(first.value.id)
    expect(again.ok && again.value.size).toBe(4)
    expect(storage.puts.at(-1)).toBe(first.value.fileId)

    const view = await loadDriveSlice(db, me)
    expect(view.ok && view.value.slice.quota.used).toBe(4)
  })
})

test('доступ: editor чужой папки не может делиться, владелец может', async () => {
  await withDb(async (db) => {
    const owner = await account(db)
    const guest = await account(db)
    const folder = await createDriveFolder(db, actor(owner), { name: 'Общее' })
    if (!folder.ok) return
    const granted = await shareDriveNode(db, actor(owner), {
      nodeId: folder.value.id,
      uid: guest,
      role: 'editor',
    })
    expect(granted.ok && granted.value.role).toBe('editor')
    expect(
      await shareDriveNode(db, actor(guest), { nodeId: folder.value.id, uid: guest, role: 'viewer' }),
    ).toMatchObject({ ok: false, code: 'drive.forbidden' })
    expect(
      await createDriveFolder(db, actor(guest), { parentId: folder.value.id, name: 'гостевая' }),
    ).toMatchObject({ ok: true })
    expect((await resolveDriveAccess(db, actor(guest), folder.value.id))?.caps.canShare).toBe(false)
  })
})
