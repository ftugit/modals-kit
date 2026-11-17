/**
 * Серверные экшены «Диска» на настоящей PGlite (4d–4f).
 *
 * Проверяется полный путь формы: `Request` с телом → `createFormHandler` →
 * доменный сервис → строка в БД и 303-возврат. Мокаются только края:
 * `db` (подменяется тестовой базой), `auth(event)` (актор запроса) и
 * хранилище файлов (этим экшенам байты не нужны).
 */
import { PGlite } from '@electric-sql/pglite'
import { afterAll, expect, it, vi } from 'vitest'
import { conservativeLimits, createDb, type Database } from '#core/lib/db/index.js'
import { pgliteAdapter } from '#core/lib/db/adapters/pglite.js'
import { defineSchema } from '#core/lib/db/sync/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import type { RequestEvent } from '@sveltejs/kit'
import { dbExtension } from '#modules/drive/db.ext.js'
import { driveNode, driveShare } from '#modules/drive/schema.js'
import { DRIVE_SERVER } from '#modules/drive/service/access.js'
import { driveActions } from './actions.server.js'

const state = vi.hoisted(() => ({ db: null as unknown, actor: '' }))

vi.mock('#core/server/db.server.js', () => ({
  get db() {
    return state.db
  },
}))

vi.mock('#modules/user/base/service/gateway.server.js', () => ({
  auth: () => ({
    enabled: true,
    actor: async () => ({ ok: true, value: { id: state.actor, permissions: [] } }),
  }),
}))

vi.mock('#core/server/client-ip.server.js', () => ({
  createIpThrottle: () => ({ check: () => ({ allowed: true }) }),
}))

vi.mock('#core/server/app-storage.server.js', () => ({
  resolveAppStorage: async () => ({ storage: null }),
}))

vi.mock('#core/server/form-security.server.js', async () => {
  const form = await import('#core/lib/form/server.js')
  return {
    SECURITY_LAYERS: [form.methodLayer(), form.bodyLayer, form.namesLayer],
  }
})

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
  state.db = createDb({ driver, limits: conservativeLimits, resources })
  await fn(state.db as Database)
}

let seeds = 0
async function account(db: Database): Promise<string> {
  seeds += 1
  const row = await db
    .resource(auth)
    .insert(DRIVE_SERVER, { seed: `${String(seeds).padStart(2, '0')}${'b'.repeat(41)}` })
  return String(row.id)
}

async function node(
  db: Database,
  ownerId: string,
  patch: { name: string; kind?: 'file' | 'folder'; parentId?: string | null },
): Promise<string> {
  const id = crypto.randomUUID()
  await db.resource(driveNode).without(['protect'], (api) =>
    api.insert(DRIVE_SERVER, {
      id,
      owner_id: ownerId,
      parent_id: patch.parentId ?? null,
      kind: patch.kind ?? 'folder',
      name: patch.name,
      file_id: patch.kind === 'file' ? `drive/${ownerId}/${id}` : null,
      size: '0',
    }),
  )
  return id
}

type ActionName = keyof typeof driveActions

interface Answer {
  status: number
  location: string
}

/** id описания на сервере: у trash/restore/purge он общий. */
const FORM_ID: Record<ActionName, string> = {
  mkdir: 'drive-mkdir',
  upload: 'drive-upload',
  rename: 'drive-rename',
  move: 'drive-move',
  copy: 'drive-copy',
  star: 'drive-star',
  trash: 'drive-trash',
  restore: 'drive-trash',
  purge: 'drive-trash',
  share: 'drive-share',
  unshare: 'drive-unshare',
}

async function post(
  action: ActionName,
  fields: Record<string, string>,
  path = '/drive',
): Promise<Answer> {
  const body = new URLSearchParams({
    __form_id: FORM_ID[action],
    __form_rev: '1',
    __form_instance: 'drive:test',
    __form_submission: crypto.randomUUID(),
    ...fields,
  })
  const request = new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost' },
    body,
  })
  const event = {
    request,
    url: new URL(`http://localhost${path}`),
    cookies: { get: () => undefined, set: () => {}, delete: () => {} },
    params: {},
    locals: {},
    getClientAddress: () => '127.0.0.1',
  } as unknown as RequestEvent
  try {
    await driveActions[action](event)
  } catch (error) {
    const thrown = error as { status?: number; location?: string }
    if (thrown.status === 303 && typeof thrown.location === 'string') {
      return { status: thrown.status, location: thrown.location }
    }
    throw error
  }
  throw new Error(`экшен ${action} завершился без редиректа`)
}

async function rows(db: Database, ownerId: string) {
  return (await db.resource(driveNode).select(DRIVE_SERVER, {
    filter: { field: 'owner_id', op: 'eq', value: ownerId },
  })) as unknown as Record<string, unknown>[]
}

test('mkdir: создаёт папку и возвращает на страницу; занятое имя — notice', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)

    const created = await post('mkdir', { parent_id: '', return_to: '/drive', name: 'Работа' })
    expect(created).toEqual({ status: 303, location: '/drive' })
    const list = await rows(db, state.actor)
    expect(list.map((row) => row.name)).toEqual(['Работа'])
    expect(list[0]?.kind).toBe('folder')

    const duplicate = await post('mkdir', { parent_id: '', return_to: '/drive', name: 'работа' })
    expect(duplicate.location).toBe('/drive?notice=drive.name-taken')
    expect(await rows(db, state.actor)).toHaveLength(1)
  })
})

test('rename: меняет имя узла; чужой узел не открывается', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    const id = await node(db, state.actor, { name: 'Старое' })

    const renamed = await post('rename', { node_id: id, return_to: '/drive', name: 'Новое' })
    expect(renamed).toEqual({ status: 303, location: '/drive' })
    expect((await rows(db, state.actor))[0]?.name).toBe('Новое')

    const foreign = await post('rename', {
      node_id: crypto.randomUUID(),
      return_to: '/drive',
      name: 'Чужое',
    })
    expect(foreign.location).toBe('/drive?notice=drive.not-found')
  })
})

test('trash: переносит в корзину и повтор отклоняет', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    const id = await node(db, state.actor, { name: 'Черновик', kind: 'file' })

    const trashed = await post('trash', { node_id: id, return_to: '/drive' })
    expect(trashed).toEqual({ status: 303, location: '/drive' })
    expect((await rows(db, state.actor))[0]?.trashed_at).toBeTruthy()

    const again = await post('trash', { node_id: id, return_to: '/drive' })
    expect(again.location).toBe('/drive?notice=drive.trashed')
  })
})

test('move/copy: файл нельзя выбрать папкой назначения', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    const folder = await node(db, state.actor, { name: 'Папка' })
    const source = await node(db, state.actor, { name: 'исходник.txt', kind: 'file' })
    const fileTarget = await node(db, state.actor, { name: 'цель.txt', kind: 'file' })

    const moved = await post('move', {
      node_id: source,
      target_id: fileTarget,
      return_to: '/drive',
    })
    expect(moved.location).toBe('/drive?notice=drive.not-folder')

    const copied = await post('copy', {
      node_id: source,
      target_id: fileTarget,
      return_to: '/drive',
    })
    expect(copied.location).toBe('/drive?notice=drive.not-folder')

    // Ни перенос, ни копия не изменили дерево: исходник и файл-цель на месте.
    const list = await rows(db, state.actor)
    expect(list).toHaveLength(3)
    expect(list.find((row) => row.id === source)?.parent_id).toBeNull()
    expect(list.find((row) => row.id === folder)?.kind).toBe('folder')
  })
})

test('share: выдаёт и меняет роль; себе — отказ', async () => {
  await withDb(async (db) => {
    state.actor = await account(db)
    const friend = await account(db)
    const id = await node(db, state.actor, { name: 'Общее' })

    const shared = await post('share', {
      node_id: id,
      uid: friend,
      role: 'viewer',
      return_to: '/drive',
    })
    expect(shared).toEqual({ status: 303, location: '/drive' })
    let shares = (await db.resource(driveShare).select(DRIVE_SERVER, {
      filter: { field: 'node_id', op: 'eq', value: id },
    })) as unknown as Record<string, unknown>[]
    expect(shares).toHaveLength(1)
    expect(shares[0]).toMatchObject({ uid: friend, role: 'viewer' })

    await post('share', { node_id: id, uid: friend, role: 'editor', return_to: '/drive' })
    shares = (await db.resource(driveShare).select(DRIVE_SERVER, {
      filter: { field: 'node_id', op: 'eq', value: id },
    })) as unknown as Record<string, unknown>[]
    expect(shares).toHaveLength(1)
    expect(shares[0]?.role).toBe('editor')

    const self = await post('share', {
      node_id: id,
      uid: state.actor,
      role: 'viewer',
      return_to: '/drive',
    })
    expect(self.location).toBe('/drive?notice=drive.share-self')
  })
})
