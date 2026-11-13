// Выход по набору: одна точка, из которой его делают и список сессий, и
// экран выхода. Набор считает сервер по фильтру из POST (`bulkExitArgs`),
// клиентские `ids`/`pick` не участвуют. Цель — из пути роута, не из тела.
import type { RequestEvent } from '@sveltejs/kit'
import type { FormError } from '#lib/form/index.js'
import { instruction, type AuthErrorCode } from './error.js'
import { auth } from './gateway.server.js'
import { AUTH_MESSAGES } from './messages.js'
import { bulkExitArgs } from './sessions.form.js'

export interface BulkExitTarget {
  /**
   * Чей аккаунт. `null` — свой: домен подставит актора сам. Чужой приходит
   * параметром пути (`/user/<uuid>/sessions`), а не query.
   */
  authId?: string | null
  /** Куда вернуть, если своя сессия жива. */
  selfHref: string
  /** Куда уйти, если закрыта и своя сессия: куки уже сняты гейтвеем. */
  doneHref: string
}

export type BulkExitOutcome = { ok: true; redirect: string } | { ok: false; error?: FormError }

/** Общий конструктор ошибки формы сессионных роутов: код только из каталога. */
export function sessionFormError(code: AuthErrorCode, message?: string, path?: string): FormError {
  return {
    id: `${path ?? '*'}:${code}:0`,
    code,
    message: message ?? AUTH_MESSAGES[code] ?? code,
    ...(path ? { path } : {}),
    origin: 'server',
    ...(code === 'auth.unavailable' ? { retryable: true } : {}),
  }
}

/**
 * Отозвать набор сессий. Куки снимает гейтвей и только когда в снятых есть
 * текущая сессия зрителя (`R4`), поэтому здесь о куках речи нет. Бросок домена
 * превращается в `auth.unavailable`, а не в глухой редирект.
 */
export async function runBulkExit(
  event: RequestEvent,
  values: Record<string, unknown>,
  target: BulkExitTarget,
  failWith: (message: string) => FormError = (message) => sessionFormError('auth.unavailable', message),
): Promise<BulkExitOutcome> {
  const me = await auth(event).actor()
  const args = bulkExitArgs(values, me.ok ? me.value.sessionId : null)
  try {
    const r = await auth(event).revokeBulkSessions({ ...args, authId: target.authId ?? null })
    if (!r.ok) {
      return { ok: false, error: instruction(r.fact)[0] ?? failWith(AUTH_MESSAGES['auth.unavailable']!) }
    }
    return { ok: true, redirect: r.value.current ? target.doneHref : target.selfHref }
  } catch {
    return { ok: false, error: failWith(AUTH_MESSAGES['auth.unavailable']!) }
  }
}

/** Локальный выход: единственный вызов здесь — снятие кук, строка живёт до истечения. */
export async function runLocalExit(event: RequestEvent): Promise<BulkExitOutcome> {
  const r = await auth(event).logoutLocal()
  if (!r.ok) return { ok: false }
  return { ok: true, redirect: '/' }
}
