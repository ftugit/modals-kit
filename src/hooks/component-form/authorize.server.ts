// Общий ранний ACL-гейт `preAuthorize` / `authorize` для HTTP POST (`server.server.ts`)
// и `wss://` (`ws-session.server.ts`).
//
// `preAuthorize(event)` (а также 1-аргументный `authorize(event)`) способен отсечь
// неавторизованного клиента ещё ДО чтения тела HTTP POST (`0` байт в RAM),
// а полный `authorize(event, form)` выполняется на Кадре 0 (после `namesLayer`),
// ДО любых асинхронных `checks` (`imageCheck`) и ДО `execute`.
import type { RequestEvent } from '@sveltejs/kit'
import type { FormError, IssueLike, StandardSchemaLike } from '#lib/form/index.js'
import type { Layer, Rejection } from '#lib/form/server.js'
import type { ComponentFormAuthVerdict, ComponentFormRegistration } from './types.js'

function isRejection(verdict: NonNullable<ComponentFormAuthVerdict>): verdict is Rejection {
  return !Array.isArray(verdict) && typeof (verdict as Rejection).status === 'number'
}

export function hasAuthVerdictError(verdict: ComponentFormAuthVerdict): boolean {
  if (!verdict) return false
  if (isRejection(verdict)) return true
  return verdict.length > 0
}

/**
 * Проверить доступ исключительно по `RequestEvent` (куки, заголовки, маршрут)
 * до чтения тела запроса в память.
 */
export async function runPreAuthorize(
  reg: ComponentFormRegistration,
  event: RequestEvent,
): Promise<{ readonly checked: boolean; readonly verdict: ComponentFormAuthVerdict }> {
  if (reg.preAuthorize) {
    return { checked: true, verdict: await reg.preAuthorize(event) }
  }
  if (reg.authorize && reg.authorize.length <= 1) {
    return { checked: true, verdict: await reg.authorize(event, new FormData()) }
  }
  return { checked: false, verdict: undefined }
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

  const hasExplicitMessage = typeof item.message === 'string' && item.message.length > 0
  const coded = typeof item.code === 'string' && item.code.length > 0
  const msg = hasExplicitMessage ? item.message : coded ? String(item.code) : 'Доступ запрещён'
  const rawTemplate = (item as { template?: unknown }).template
  const template =
    typeof rawTemplate === 'string'
      ? rawTemplate
      : hasExplicitMessage
        ? item.message
        : undefined

  return {
    message: msg,
    ...(normalizedPath ? { path: normalizedPath } : {}),
    ...(coded ? { code: item.code } : {}),
    ...(item.params && typeof item.params === 'object' ? { params: item.params } : {}),
    ...(template !== undefined ? { template } : {}),
  }
}

export interface AuthorizeGuardOptions {
  /** Уже вычисленный до чтения тела вердикт `runPreAuthorize`, чтобы не повторять проверку. */
  readonly preVerdict?: { readonly checked: boolean; readonly verdict: ComponentFormAuthVerdict }
}

export function createAuthorizeGuards(
  reg: ComponentFormRegistration,
  event: RequestEvent,
  getForm: () => FormData,
  options: AuthorizeGuardOptions = {},
): {
  readonly layer: Layer | undefined
  readonly schema: StandardSchemaLike | undefined
} {
  if (!reg.preAuthorize && !reg.authorize) {
    return { layer: undefined, schema: undefined }
  }

  let pendingIssues: readonly IssueLike[] | null = null

  const applyVerdict = (verdict: ComponentFormAuthVerdict): Rejection | undefined => {
    if (!verdict) return undefined
    if (isRejection(verdict)) return verdict
    if (verdict.length > 0) {
      pendingIssues = verdict.map((item) => toStandardIssue(item as FormError | IssueLike))
    }
    return undefined
  }

  const layer: Layer = async () => {
    if (options.preVerdict?.checked) {
      if (hasAuthVerdictError(options.preVerdict.verdict)) {
        return applyVerdict(options.preVerdict.verdict)
      }
      // Если ранний гейт покрывал только `preAuthorize`, а `authorize` читает `FormData`
      // (`authorize.length >= 2`), добиваем проверку по разобранной форме.
      if (reg.authorize && (reg.preAuthorize || reg.authorize.length >= 2)) {
        return applyVerdict(await reg.authorize(event, getForm()))
      }
      return undefined
    }

    if (reg.preAuthorize) {
      const pre = await reg.preAuthorize(event)
      if (hasAuthVerdictError(pre)) {
        return applyVerdict(pre)
      }
    }
    if (reg.authorize) {
      return applyVerdict(await reg.authorize(event, getForm()))
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
