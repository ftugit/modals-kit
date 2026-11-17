/**
 * Действия форм «Диска» (4d–4f `plan-drive-ui.md`).
 *
 * Один набор на все страницы: адрес возврата и текущая папка едут скрытыми
 * полями, а `return_to` пропускается только через `localPath`. Любой доменный
 * отказ возвращает на ту же страницу с `?notice=<код>` — без JS это видимое
 * сообщение, с JS — та же навигация после инвалидации.
 */
import type { Actions, RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { localPath } from '#core/lib/address/index.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { resolveAppStorage } from '#core/server/app-storage.server.js'
import { db } from '#core/server/db.server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'
import { DRIVE_MESSAGES } from '#modules/drive/messages.js'
import {
  driveCopyForm,
  driveMkdirForm,
  driveMoveForm,
  driveRenameForm,
  driveShareForm,
  driveStarForm,
  driveTrashForm,
  driveUnshareForm,
  driveUploadForm,
} from '#modules/drive/form.js'
import { createDriveFolder, copyDriveNode, moveDriveNode, purgeDriveNode, renameDriveNode, restoreDriveNode, shareDriveNode, starDriveNode, trashDriveNode, unshareDriveNode } from '#modules/drive/service/mutate.js'
import { uploadDriveFile } from '#modules/drive/service/upload.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import type { DriveActor, DriveResult } from '#modules/drive/types.js'

const throttle = createIpThrottle('drive-forms', 120, 60_000)

/** Предел тела загрузки: общий бюджет формы (2 МиБ) для файлов мал. */
const DRIVE_UPLOAD_BUDGET = 64 * 1024 * 1024

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const backHref = (event: RequestEvent, values: Record<string, unknown>): string =>
  localPath(text(values.return_to)) ?? event.url.pathname

const noticeHref = (path: string, code: string): string => {
  const url = new URL(path, 'http://local')
  url.searchParams.set('notice', code in DRIVE_MESSAGES ? code : 'drive.forbidden')
  return `${url.pathname}?${url.searchParams.toString()}`
}

async function actorOf(event: RequestEvent): Promise<DriveActor | null> {
  const u = auth(event)
  if (!u.enabled) return null
  const who = await u.actor()
  if (!who.ok) return null
  return { id: who.value.id, permissions: [...(who.value.permissions ?? [])] }
}

/** Общий приём: доменный результат либо возврат с сообщением. */
async function run(
  event: RequestEvent,
  description: Parameters<typeof createFormHandler>[0]['description'],
  op: (values: Record<string, unknown>) => Promise<DriveResult<unknown>>,
  limits?: { budget: number },
) {
  const handled = await createFormHandler({
    description,
    order: SECURITY_LAYERS,
    throttle,
    ...(limits ? { limits } : {}),
    async execute({ values, commit }) {
      const result = await op(values as Record<string, unknown>)
      if (!result.ok) {
        // Отказ домена — тоже завершённая отправка: без commit библиотека
        // считает исход неизвестным и не отдаёт redirect.
        commit()
        return { redirect: noticeHref(backHref(event, values), result.code) }
      }
      commit()
      return { redirect: backHref(event, values) }
    },
  })(event.request, 'action', event)
  if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
  return fail(handled.status, { result: handled.result })
}

const withActor =
  (event: RequestEvent, op: (actor: DriveActor, values: Record<string, unknown>) => Promise<DriveResult<unknown>>) =>
  async (values: Record<string, unknown>) => {
    const actor = await actorOf(event)
    return actor ? op(actor, values) : ({ ok: false, code: 'drive.forbidden' } as const)
  }

async function upload(actor: DriveActor, values: Record<string, unknown>) {
  const file = values.file
  if (!(file instanceof File) || file.size <= 0) {
    return { ok: false as const, code: 'drive.upload-empty' }
  }
  const { storage } = await resolveAppStorage()
  return uploadDriveFile(
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
    {
      storage: storage
        ? { put: (input) => storage.put(input), del: (path) => storage.del(path) }
        : null,
    },
  )
}

async function purge(actor: DriveActor, values: Record<string, unknown>) {
  const { storage } = await resolveAppStorage()
  return purgeDriveNode(
    db,
    actor,
    { nodeId: text(values.node_id) },
    storage ? { del: (path) => storage.del(path) } : null,
  )
}

export const driveActions = {
  mkdir: (event) =>
    run(event, driveMkdirForm(null, ''), withActor(event, (actor, values) =>
      createDriveFolder(db, actor, {
        parentId: text(values.parent_id) || null,
        name: text(values.name),
      }),
    )),
  upload: (event) =>
    run(
      event,
      driveUploadForm(null, ''),
      withActor(event, upload),
      { budget: DRIVE_UPLOAD_BUDGET },
    ),
  rename: (event) =>
    run(event, driveRenameForm('', '', ''), withActor(event, (actor, values) =>
      renameDriveNode(db, actor, { nodeId: text(values.node_id), name: text(values.name) }),
    )),
  move: (event) =>
    run(event, driveMoveForm('', [], ''), withActor(event, (actor, values) =>
      moveDriveNode(db, actor, {
        nodeId: text(values.node_id),
        targetId: text(values.target_id) || null,
      }),
    )),
  copy: (event) =>
    run(event, driveCopyForm('', [], ''), withActor(event, (actor, values) =>
      copyDriveNode(db, actor, {
        nodeId: text(values.node_id),
        targetId: text(values.target_id) || null,
        name: text(values.name) || undefined,
      }),
    )),
  star: (event) =>
    run(event, driveStarForm('', false, ''), withActor(event, (actor, values) =>
      starDriveNode(db, actor, {
        nodeId: text(values.node_id),
        starred: text(values.starred) === '1',
      }),
    )),
  trash: (event) =>
    run(event, driveTrashForm('', ''), withActor(event, (actor, values) =>
      trashDriveNode(db, actor, { nodeId: text(values.node_id) }),
    )),
  restore: (event) =>
    run(event, driveTrashForm('', ''), withActor(event, (actor, values) =>
      restoreDriveNode(db, actor, { nodeId: text(values.node_id) }),
    )),
  purge: (event) =>
    run(event, driveTrashForm('', ''), withActor(event, purge)),
  share: (event) =>
    run(event, driveShareForm('', ''), withActor(event, (actor, values) =>
      shareDriveNode(db, actor, {
        nodeId: text(values.node_id),
        uid: text(values.uid),
        role: text(values.role),
      }),
    )),
  unshare: (event) =>
    run(event, driveUnshareForm('', '', ''), withActor(event, (actor, values) =>
      unshareDriveNode(db, actor, { nodeId: text(values.node_id), uid: text(values.uid) }),
    )),
} satisfies Actions
