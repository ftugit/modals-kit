// Карточка одного устройства (`/user/sessions/<id>`) — страница-fallback
// модалки `user.session`. Переименование — именованный экшен: без JS форма
// компонента отправляется обычным POST и возвращается на список.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { sessionRenameForm } from '#modules/user/sessions/svelte/sessions.form.js'
import { userSessionRoute, userSessionsRoute } from '#modules/user/base/routes.js'
import type { AuthErrorCode, SessionDetail } from '#modules/user/base/index.js'
import type { FormError } from '#core/lib/form/index.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'

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

export async function loadSessionCard(event: RequestEvent<{ id: string }>): Promise<SessionCardData> {
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

export const sessionCardActions = {
  rename: async (event: RequestEvent<{ id: string }>) => {
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
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    return fail(handled.status, { result: handled.result })
  },
}
