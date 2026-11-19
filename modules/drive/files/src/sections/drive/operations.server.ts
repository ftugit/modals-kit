/**
 * Исполнение операций «Диска» (`plan-drive-repair.md` §5.2).
 *
 * Одна точка правды для POST: берёт актора из запроса, разрешает порты
 * (БД, хранилище, ключ подписи) и вызывает доменный сервис. Redirect из
 * `execute` нет: успех возвращает чистый `next`, который читает
 * `redirectOnSuccess` (no-JS) или клиентский hook (JS).
 */
import type { RequestEvent } from '@sveltejs/kit'
import { AUTH_SEAL_SECRET } from '$app/env/private'
import { localPath } from '#core/lib/address/index.js'
import type { Storage } from '#core/lib/storage/index.js'
import { resolveAppStorage } from '#core/server/app-storage.server.js'
import { db } from '#core/server/db.server.js'
import {
  copyDriveNode,
  createDriveFolder,
  moveDriveNode,
  purgeDriveNode,
  renameDriveNode,
  restoreDriveNode,
  shareDriveNodeMany,
  starDriveNode,
  trashDriveNode,
  unshareDriveNode,
} from '#modules/drive/service/mutate.js'
import { uploadDriveFile } from '#modules/drive/service/upload.js'
import { issueDriveDavToken, revokeDriveDavToken } from '#modules/drive/service/tokens.js'
import type { DriveActor, DriveResult } from '#modules/drive/types.js'
import type { DriveOperationName } from '#modules/drive/operations.js'
import { driveAccessRoute, driveFolderRoute, driveRootRoute } from '#modules/drive/routes.js'
import { auth } from '#modules/user/base/service/gateway.server.js'

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Актор запроса или `null`, если вход выключен/не выполнен. */
export async function driveOperationActor(event: RequestEvent): Promise<DriveActor | null> {
  const u = auth(event)
  if (!u.enabled) return null
  const who = await u.actor()
  if (!who.ok) return null
  return { id: who.value.id, permissions: [...(who.value.permissions ?? [])] }
}

/** Куда вернуть POST: только локальный адрес, иначе корень диска. */
export function driveReturnTo(event: RequestEvent): string {
  return localPath(event.url.searchParams.get('return_to')) ?? driveRootRoute.href()
}

/** Успех операции: `next` — проверенный адрес перехода, без `step`-квитанции. */
export interface DriveOperationDone {
  readonly ok: true
  readonly data: Record<string, unknown>
  readonly next: string
}

/** Отказ операции: код домена, поле формы и подстановки текста. */
export interface DriveOperationFailure {
  readonly ok: false
  readonly code: string
  readonly field: string
  readonly params?: Record<string, unknown>
}

export type DriveOperationOutcome = DriveOperationDone | DriveOperationFailure

/** Код домена → поле формы (для текста ошибки у поля, а не общим баннером). */
export function driveOperationField(code: string): string {
  if (code.startsWith('drive.name-')) return 'name'
  if (code.startsWith('drive.dav-label')) return 'label'
  if (code.startsWith('drive.share-role')) return 'role'
  if (code.startsWith('drive.share-target-missing')) return 'subjects'
  if (code.startsWith('drive.dav-')) return 'label'
  if (code.includes('target') || code.includes('parent') || code.includes('move-')) return 'target_id'
  if (code.includes('uid')) return 'uid'
  if (code.startsWith('drive.upload') || code.startsWith('drive.quota') || code.startsWith('drive.storage'))
    return 'file'
  return 'name'
}

function done(result: DriveResult<unknown>, next: string, data: Record<string, unknown> = {}): DriveOperationOutcome {
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      field: driveOperationField(result.code),
      ...(result.params ? { params: result.params } : {}),
    }
  }
  return { ok: true, data, next }
}

/** Хранилище для upload/purge: отсутствие — доменный код, не исключение. */
export type DriveStorageGate =
  | { storage: Storage; code: null }
  | { storage: Storage | null; code: 'drive.storage-unavailable' | 'drive.storage-readonly' }

export async function driveStorageGate(): Promise<DriveStorageGate> {
  try {
    const { storage, writable } = await resolveAppStorage()
    if (!storage) return { storage: null, code: 'drive.storage-unavailable' }
    if (!writable) return { storage, code: 'drive.storage-readonly' }
    return { storage, code: null }
  } catch {
    return { storage: null, code: 'drive.storage-unavailable' }
  }
}

function folderHref(targetId: string | null): string {
  return targetId ? driveFolderRoute.href({ folderId: targetId }) : driveRootRoute.href()
}

function subjectsOf(values: Record<string, unknown>): string[] {
  const raw = values.subjects
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string')
  if (typeof raw === 'string') return raw.split(',')
  return []
}

/**
 * Выполнить операцию. `returnTo` уже проверен `localPath` при разборе query;
 * здесь он повторно нормализуется как поле формы (клиент — просьба, не право).
 */
export async function runDriveOperation(
  op: DriveOperationName,
  event: RequestEvent,
  values: Record<string, unknown>,
): Promise<DriveOperationOutcome> {
  const actor = await driveOperationActor(event)
  if (!actor) return { ok: false, code: 'auth.forbidden', field: 'name' }
  const back = localPath(text(values.return_to)) ?? driveReturnTo(event)
  const nodeId = text(values.node_id)
  const targetId = text(values.target_id) || null

  switch (op) {
    case 'mkdir':
      return done(
        await createDriveFolder(db, actor, {
          parentId: text(values.parent_id) || null,
          name: text(values.name),
        }),
        back,
      )

    case 'upload': {
      const file = values.file
      if (!(file instanceof File) || file.size <= 0) {
        return { ok: false, code: 'drive.upload-empty', field: 'file' }
      }
      const gate = await driveStorageGate()
      if (gate.code) return { ok: false, code: gate.code, field: 'file' }
      const result = await uploadDriveFile(
        db,
        actor,
        {
          parentId: text(values.parent_id) || null,
          name: file.name,
          body: file,
          size: file.size,
          contentType: file.type || null,
          overwrite: true,
        },
        { storage: { put: (input) => gate.storage.put(input), del: (path) => gate.storage.del(path) } },
      )
      event.setHeaders({ 'cache-control': 'private, no-store' })
      return done(result, back)
    }

    case 'rename':
      return done(
        await renameDriveNode(db, actor, { nodeId, name: text(values.name) }),
        back,
      )

    case 'move':
      return done(
        await moveDriveNode(db, actor, { nodeId, targetId }),
        folderHref(targetId),
      )

    case 'copy':
      return done(
        await copyDriveNode(db, actor, {
          nodeId,
          targetId,
          name: text(values.name) || undefined,
        }),
        folderHref(targetId),
      )

    case 'star':
      return done(
        await starDriveNode(db, actor, { nodeId, starred: text(values.starred) === '1' }),
        back,
      )

    case 'trash-action': {
      const result = await trashDriveNode(db, actor, { nodeId })
      return done(result, back)
    }

    case 'restore':
      return done(await restoreDriveNode(db, actor, { nodeId }), back)

    case 'purge': {
      const gate = await driveStorageGate()
      const result = await purgeDriveNode(
        db,
        actor,
        { nodeId },
        gate.code === null ? { del: (path) => gate.storage.del(path) } : null,
      )
      return done(result, back)
    }

    case 'share': {
      const supplied = subjectsOf(values)
      const uids = supplied.length > 0 ? supplied : [text(values.uid)]
      const result = await shareDriveNodeMany(db, actor, {
        nodeId,
        uids,
        role: text(values.role),
      })
      if (!result.ok) {
        return {
          ok: false,
          code: result.code,
          field: supplied.length > 0 ? 'subjects' : 'uid',
          ...(result.params ? { params: result.params } : {}),
        }
      }
      return done(result, driveAccessRoute.href({ node_id: nodeId }))
    }

    case 'unshare':
      return done(
        await unshareDriveNode(db, actor, { nodeId, uid: text(values.uid) }),
        back,
      )

    case 'dav-issue': {
      const result = await issueDriveDavToken(db, actor, {
        label: text(values.label),
        secretKey: AUTH_SEAL_SECRET ?? '',
      })
      // Секрет живёт только в этом POST-ответе: ни URL, ни снапшот его не несут.
      event.setHeaders({ 'cache-control': 'private, no-store' })
      return done(result, back, result.ok ? { token: result.value.token, label: result.value.label } : {})
    }

    case 'dav-revoke':
      return done(
        await revokeDriveDavToken(db, actor, text(values.token_id)),
        back,
      )
  }
}
