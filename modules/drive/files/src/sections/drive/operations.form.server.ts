/**
 * Серверные POST-регистрации операций «Диска» (`plan-drive-repair.md` §5).
 *
 * Один файл на всю матрицу: form ID берутся из `operations.ts`, поэтому
 * дубликат ID ловится самим реестром, а поведение операций живёт в
 * `operations.server.ts`. Redirect из `execute` нет — без JS переход делает
 * `redirectOnSuccess` по проверенному `next` из результата.
 */
import type { FormError, Result } from '#core/lib/form/index.js'
import { localPath } from '#core/lib/address/index.js'
import { registerComponentForm } from '#core/hooks/component-form/registry.js'
import { driveOperationDescription } from '#modules/drive/forms/index.js'
import { driveMessage } from '#modules/drive/messages.js'
import {
  DRIVE_OPERATIONS,
  type DriveOperationName,
  type DriveOperationSpec,
} from '#modules/drive/operations.js'
import { driveNoticeHref } from '#modules/drive/source.js'
import { DRIVE_UPLOAD_MAX_BYTES } from '#modules/drive/service/upload.js'
import { driveOperationActor, driveStorageGate, runDriveOperation } from './operations.server.js'

function refuse(
  code: string,
  path = 'name',
  params?: Record<string, unknown>,
): FormError {
  return {
    id: `${path}:${code}`,
    path,
    code,
    message: driveMessage(code),
    template: driveMessage(code),
    ...(params ? { params } : {}),
    origin: 'server',
  }
}

/** Строки матрицы, у которых POST обслуживает этот файл (фильтры — отдельно). */
export function driveSuccessRedirect(
  spec: Pick<DriveOperationSpec, 'inlineSuccess'>,
  result: Pick<Result, 'redirect'>,
): string | null | 'inline' {
  if (spec.inlineSuccess) return 'inline'
  const href = localPath(result.redirect ?? null)
  if (!href) return null // аварийный fallback
  return driveNoticeHref(href)
}

export const DRIVE_MUTATION_OPERATIONS = [
  'mkdir',
  'upload',
  'rename',
  'move',
  'copy',
  'star',
  'trash-action',
  'restore',
  'purge',
  'share',
  'unshare',
  'dav-issue',
  'dav-revoke',
] as const satisfies readonly DriveOperationName[]

for (const op of DRIVE_MUTATION_OPERATIONS) {
  const spec = DRIVE_OPERATIONS[op]
  registerComponentForm({
    id: spec.formId,
    description: () => driveOperationDescription(op),
    // Загрузка отсекает неавторизованного до чтения байтов и объявляет свой
    // бюджет файла: он совпадает с бюджетом сервиса.
    ...(op === 'upload'
      ? {
          limits: { budget: DRIVE_UPLOAD_MAX_BYTES },
          authorize: async (event: Parameters<typeof driveOperationActor>[0]) => {
            if (!(await driveOperationActor(event))) return [refuse('auth.forbidden', 'file')]
            const gate = await driveStorageGate()
            return gate.code ? [refuse(gate.code, 'file')] : null
          },
        }
      : {}),
    execute: async ({ values, commit, fail }, event) => {
      const outcome = await runDriveOperation(op, event, values as Record<string, unknown>)
      if (!outcome.ok) return fail([refuse(outcome.code, outcome.field, outcome.params)])
      commit()
      // `redirect` — чистый адрес: его читает JS и делает goto без дубля уведомления.
      return { data: outcome.data, redirect: outcome.next }
    },
    redirectOnSuccess: (_event, result) => driveSuccessRedirect(spec, result),
  })
}
