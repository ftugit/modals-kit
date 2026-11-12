// Карточка устройства чужого аккаунта (`/user/[id]/sessions/[sessionId]`) —
// страница-fallback модалки `user.session` с целью. Тот же `load`, что и у
// `/user/sessions/<id>`: цель задаёт адрес, а не данные. Расхождение адреса и
// аккаунта устройства — отказ, иначе под адресом чужого аккаунта открывалась
// бы строка, к нему не относящаяся.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { userAccountSessionRoute, userAccountSessionsRoute } from '#content/user/routes.js'
import { sessionRenameForm } from '#content/user/sessions.form.js'
import type { AuthErrorCode, SessionDetail } from '#content/user/index.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

export interface AccountSessionCardData {
  /** Аккаунт из адреса: им же задан `backHref` и возврат после экшена. */
  uid: string
  enabled: boolean
  fact: AuthErrorCode | null
  detail: SessionDetail | null
  notice: 'rename-failed' | null
}

const throttle = createIpThrottle('user-session-rename', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

export const load: PageServerLoad = async (event): Promise<AccountSessionCardData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const uid = String(event.params.id ?? '')
  const id = String(event.params.sessionId ?? '')
  const notice = event.url.searchParams.get('notice') === 'rename-failed' ? 'rename-failed' : null
  const u = auth(event)
  if (!u.enabled) {
    return { uid, enabled: false, fact: 'auth.disabled', detail: null, notice }
  }
  const r = await u.readSessionDetail(id)
  if (!r.ok) {
    return { uid, enabled: true, fact: r.fact.code, detail: null, notice }
  }
  // Право прочитал `readSessionDetail` по сессии; здесь сверяется только то,
  // что устройство принадлежит аккаунту из адреса.
  if (r.value.session.authId !== uid) {
    return { uid, enabled: true, fact: 'auth.session-unknown', detail: null, notice }
  }
  return { uid, enabled: true, fact: null, detail: r.value, notice }
}

export const actions: Actions = {
  rename: async (event) => {
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
    redirect(
      303,
      handled.result.ok && handled.result.redirect?.startsWith('/')
        ? handled.result.redirect
        : `${userAccountSessionRoute.href({ id: uid, sessionId: id })}?notice=rename-failed`,
    )
  },
}
