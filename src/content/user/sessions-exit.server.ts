// Выход по набору: одна точка, из которой его делают и список сессий, и
// экран выхода. Раньше намерение жило в имени экшена (`?/others`), из-за чего
// «закрыть выбранное» и «выйти из аккаунта» требовали разных экшенов.
//
// Набор собирает `bulkExitArgs` из значений формы, а не из адреса: форма одна
// на оба носителя, разница — в значениях по умолчанию и во флаге `spread`.
import type { RequestEvent } from '@sveltejs/kit'
import type { FormError } from '#lib/form/index.js'
import { auth } from './gateway.server.js'
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

/**
 * Отозвать набор сессий. Куки снимает гейтвей и только когда в снятых есть
 * текущая сессия зрителя (`R4`), поэтому здесь о куках речи нет.
 */
export async function runBulkExit(
  event: RequestEvent,
  values: Record<string, unknown>,
  target: BulkExitTarget,
  failWith: (message: string) => FormError,
): Promise<BulkExitOutcome> {
  const me = await auth(event).actor()
  const args = bulkExitArgs(values, me.ok ? me.value.sessionId : null)
  const r = await auth(event).revokeBulkSessions({ ...args, authId: target.authId ?? null })
  if (!r.ok) return { ok: false, error: failWith('Не удалось завершить сессии') }
  return { ok: true, redirect: r.value.current ? target.doneHref : target.selfHref }
}

/** Локальный выход: куки снимаются без отзыва, сессия живёт до истечения. */
export async function runLocalExit(event: RequestEvent): Promise<BulkExitOutcome> {
  const r = await auth(event).logoutLocal()
  if (!r.ok) return { ok: false }
  return { ok: true, redirect: '/' }
}
