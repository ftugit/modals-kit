/**
 * Исполнение операций «Диска» (`plan-drive-repair.md` §5.2).
 *
 * Одна точка правды для POST: берёт актора из запроса, разрешает порты
 * (БД, хранилище, ключ подписи) и вызывает доменный сервис. Ни redirect из
 * `execute`, ни превращения отказа в успех здесь нет: успех — `step: 'done'`
 * в результате, отказ — код домена.
 */
import type { RequestEvent } from '@sveltejs/kit'
import { AUTH_SEAL_SECRET } from '$app/env/private'
import { localPath } from '#core/lib/address/index.js'
import { resolveAppStorage } from '#core/server/app-storage.server.js'
import { db } from '#core/server/db.server.js'
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
  unshareDriveNode,
} from '#modules/drive/service/mutate.js'
import { uploadDriveFile } from '#modules/drive/service/upload.js'
import { issueDriveDavToken, revokeDriveDavToken } from '#modules/drive/service/tokens.js'
import type { DriveActor, DriveResult } from '#modules/drive/types.js'
import type { DriveOperationName } from '#modules/drive/operations.js'
import { driveRootRoute } from '#modules/drive/routes.js'
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

/** Успех операции: `step` для stationary-квитанции и `next` для PRG без JS. */
export interface DriveOperationDone {
  readonly ok: true
  readonly data: Record<string, unknown>
  readonly next: string
}

/** Отказ операции: код домена плюс поле формы, к которому он относится. */
export interface DriveOperationFailure {
  readonly ok: false
  readonly code: string
  readonly field: string
}

export type DriveOperationOutcome = DriveOperationDone | DriveOperationFailure

/** Код домена → поле формы (для текста ошибки у поля, а не общим баннером). */
export function driveOperationField(code: string): string {
  if (code.startsWith('drive.name-')) return 'name'
  if (code.startsWith('drive.dav-label')) return 'label'
  if (code.startsWith('drive.share-role')) return 'role'
  if (code.startsWith('drive.dav-')) return 'label'
  if (code.includes('target') || code.includes('parent') || code.includes('move-')) return 'target_id'
  if (code.includes('uid')) return 'uid'
  if (code.startsWith('drive.upload') || code.startsWith('drive.quota') || code.startsWith('drive.storage'))
    return 'file'
  return 'name'
}

function done(result: DriveResult<unknown>, next: string, data: Record<string, unknown> = {}): DriveOperationOutcome {
  if (!result.ok) return { ok: false, code: result.code, field: driveOperationField(result.code) }
  return { ok: true, data: { step: 'done', ...data }, next }
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
  const next = localPath(text(values.return_to)) ?? driveReturnTo(event)
  const nodeId = text(values.node_id)

  switch (op) {
    case 'mkdir':
      return done(
        await createDriveFolder(db, actor, {
          parentId: text(values.parent_id) || null,
          name: text(values.name),
        }),
        next,
      )

    case 'upload': {
      const file = values.file
      if (!(file instanceof File) || file.size <= 0) {
        return { ok: false, code: 'drive.upload-empty', field: 'file' }
      }
      const { storage } = await resolveAppStorage()
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
        { storage: storage ? { put: (input) => storage.put(input), del: (path) => storage.del(path) } : null },
      )
      event.setHeaders({ 'cache-control': 'private, no-store' })
      return done(result, next, result.ok ? { name: result.value.name } : {})
    }

    case 'rename':
      return done(
        await renameDriveNode(db, actor, { nodeId, name: text(values.name) }),
        next,
      )

    case 'move':
      return done(
        await moveDriveNode(db, actor, { nodeId, targetId: text(values.target_id) || null }),
        next,
      )

    case 'copy':
      return done(
        await copyDriveNode(db, actor, {
          nodeId,
          targetId: text(values.target_id) || null,
          name: text(values.name) || undefined,
        }),
        next,
      )

    case 'star':
      return done(
        await starDriveNode(db, actor, { nodeId, starred: text(values.starred) === '1' }),
        next,
      )

    case 'trash-action': {
      const result = await trashDriveNode(db, actor, { nodeId })
      return done(result, next, result.ok ? { count: result.value.length } : {})
    }

    case 'restore':
      return done(await restoreDriveNode(db, actor, { nodeId }), next)

    case 'purge': {
      const { storage } = await resolveAppStorage()
      const result = await purgeDriveNode(
        db,
        actor,
        { nodeId },
        storage ? { del: (path) => storage.del(path) } : null,
      )
      return done(result, next, result.ok ? { deleted: result.value.deleted, freed: result.value.freed } : {})
    }

    case 'share':
      return done(
        await shareDriveNode(db, actor, {
          nodeId,
          uid: text(values.uid),
          role: text(values.role),
        }),
        next,
      )

    case 'unshare':
      return done(
        await unshareDriveNode(db, actor, { nodeId, uid: text(values.uid) }),
        next,
      )

    case 'dav-issue': {
      const result = await issueDriveDavToken(db, actor, {
        label: text(values.label),
        secretKey: AUTH_SEAL_SECRET ?? '',
      })
      // Секрет живёт только в этом POST-ответе: ни URL, ни снапшот его не несут.
      event.setHeaders({ 'cache-control': 'private, no-store' })
      return done(result, next, result.ok ? { token: result.value.token, label: result.value.label } : {})
    }

    case 'dav-revoke':
      return done(
        await revokeDriveDavToken(db, actor, text(values.token_id)),
        next,
      )

    case 'filters':
      // Обрабатывается отдельной регистрацией (`filters.form.server.ts`):
      // адрес списка собирает адаптер пагинатора, а не доменный сервис.
      return { ok: false, code: 'drive.forbidden', field: 'from' }
  }
}
