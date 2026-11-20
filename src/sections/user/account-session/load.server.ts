// Карточка устройства чужого аккаунта (`/user/[id]/sessions/[sessionId]`) —
// страница-fallback модалки `user.session` с целью. Тот же `load`, что и у
// `/user/sessions/<id>`: цель задаёт адрес, а не данные. Расхождение адреса и
// аккаунта устройства — отказ, иначе под адресом чужого аккаунта открывалась
// бы строка, к нему не относящаяся.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { userAccountSessionRoute, userAccountSessionsRoute } from '#modules/user/base/routes.js'
import { sessionRenameForm } from '#modules/user/sessions/svelte/sessions.form.js'
import type { AuthErrorCode, SessionDetail } from '#modules/user/base/index.js'
import type { FormError } from '#core/lib/form/index.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'

export interface AccountSessionCardData {
  /** Аккаунт из адреса: им же задан `backHref` и возврат после экшена. */
  uid: string
  enabled: boolean
  fact: AuthErrorCode | null
  detail: SessionDetail | null
}

const throttle = createIpThrottle('user-session-rename', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

export async function loadAccountSession(event: RequestEvent<{ id: string; sessionId: string }>): Promise<AccountSessionCardData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const uid = String(event.params.id ?? '')
  const id = String(event.params.sessionId ?? '')
  const u = auth(event)
  if (!u.enabled) {
    return { uid, enabled: false, fact: 'auth.disabled', detail: null }
  }
  const r = await u.readSessionDetail(id)
  if (!r.ok) {
    return { uid, enabled: true, fact: r.fact.code, detail: null }
  }
  // Право прочитал `readSessionDetail` по сессии; здесь сверяется только то,
  // что устройство принадлежит аккаунту из адреса.
  if (r.value.session.authId !== uid) {
    return { uid, enabled: true, fact: 'auth.session-unknown', detail: null }
  }
  return { uid, enabled: true, fact: null, detail: r.value }
}

export const accountSessionActions = {
  rename: async (event: RequestEvent<{ id: string; sessionId: string }>) => {
    const uid = String(event.params.id ?? '')
    const id = String(event.params.sessionId ?? '')
    const list = userAccountSessionsRoute.href({ id: uid })
    const handled = await createFormHandler({
      description: sessionRenameForm(id),
      order: SECURITY_LAYERS,
      throttle,
      async execute({ values, commit, fail }) {
        // Идентификатор пришёл скрытым полем: подменённый — отказ, а не чужая строка.
        if (String(values.id ?? '').trim() !== id) {
          return fail([error('auth.session-unknown', 'Устройство не найдено', 'id')])
        }
        const name = String(values.device_name ?? '')
        const r = await auth(event).renameSessionDevice(id, name.trim() || null)
        if (!r.ok) return fail([error('auth.rename', 'Не удалось переименовать устройство', 'device_name')])
        commit()
        return { redirect: list }
      },
    })(event.request, 'action', event)
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    return fail(handled.status, { result: handled.result })
  },
}
