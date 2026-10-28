// Общий ранний ACL-гейт `authorize` для HTTP POST (`server.server.ts`) и `wss://` (`ws-session.server.ts`).
//
// Выполняется строго на Кадре 0 (после `namesLayer`), ДО любых асинхронных `checks` (`imageCheck`)
// и ДО `execute` — при отказе с клиента не вытягивается ни одного байта файла (`0` сегментов).
import type { RequestEvent } from '@sveltejs/kit'
import type { FormError, IssueLike, StandardSchemaLike } from '#lib/form/index.js'
import type { Layer, Rejection } from '#lib/form/server.js'
import type { ComponentFormAuthVerdict, ComponentFormRegistration } from './types.js'

function isRejection(verdict: NonNullable<ComponentFormAuthVerdict>): verdict is Rejection {
  return !Array.isArray(verdict) && typeof (verdict as Rejection).status === 'number'
}

function toStandardIssue(item: FormError | IssueLike): IssueLike {
  const pathVal = (item as { path?: unknown }).path
  const normalizedPath =
    typeof pathVal === 'string'
      ? pathVal.length > 0
        ? [pathVal]
        : undefined
      : Array.isArray(pathVal)
        ? pathVal
        : undefined

  const msg = typeof item.message === 'string' && item.message.length > 0 ? item.message : 'Доступ запрещён'
  const rawTemplate = (item as { template?: unknown }).template
  const template = typeof rawTemplate === 'string' ? rawTemplate : msg

  return {
    message: msg,
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(typeof item.code === 'string' ? { code: item.code } : {}),
    ...(item.params && typeof item.params === 'object' ? { params: item.params } : {}),
    template,
  }
}

export function createAuthorizeGuards(
  reg: ComponentFormRegistration,
  event: RequestEvent,
  getForm: () => FormData,
): {
  readonly layer: Layer | undefined
  readonly schema: StandardSchemaLike | undefined
} {
  if (!reg.authorize) {
    return { layer: undefined, schema: undefined }
  }

  let pendingIssues: readonly IssueLike[] | null = null

  const layer: Layer = async () => {
    const verdict = await reg.authorize!(event, getForm())
    if (!verdict) return undefined
    if (isRejection(verdict)) return verdict
    if (verdict.length > 0) {
      pendingIssues = verdict.map((item) => toStandardIssue(item as FormError | IssueLike))
    }
    return undefined
  }

  const schema: StandardSchemaLike = {
    '~standard': {
      validate(value) {
        if (pendingIssues && pendingIssues.length > 0) {
          return { issues: pendingIssues }
        }
        return { value }
      },
    },
  }

  return { layer, schema }
}
