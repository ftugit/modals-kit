// Карточка одного устройства (`/user/sessions/<id>`) — страница-fallback
// модалки `user.session`. Переименование — именованный экшен: без JS форма
// компонента отправляется обычным POST и возвращается на список.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { sessionRenameForm } from '#content/user/sessions.form.js'
import { userSessionRoute, userSessionsRoute } from '#content/user/routes.js'
import type { AuthErrorCode, SessionDetail } from '#content/user/index.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

export interface SessionCardData {
  enabled: boolean
  fact: AuthErrorCode | null
  detail: SessionDetail | null
  notice: 'rename-failed' | null
}

const list = userSessionsRoute.href()
const throttle = createIpThrottle('user-session-rename', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

export const load: PageServerLoad = async (event): Promise<SessionCardData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const notice = event.url.searchParams.get('notice') === 'rename-failed' ? 'rename-failed' : null
  const u = auth(event)
  if (!u.enabled) {
    return { enabled: false, fact: 'auth.disabled', detail: null, notice }
  }
  const r = await u.readSessionDetail(event.params.id)
  if (!r.ok) {
    return { enabled: true, fact: r.fact.code, detail: null, notice }
  }
  return { enabled: true, fact: null, detail: r.value, notice }
}

export const actions: Actions = {
  rename: async (event) => {
    const id = String(event.params.id)
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
      handled.result.ok && handled.result.redirect?.startsWith('/') ? handled.result.redirect : `${userSessionRoute.href({ id })}?notice=rename-failed`,
    )
  },
}
