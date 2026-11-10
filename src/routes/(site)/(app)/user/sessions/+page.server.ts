// Свои устройства (`/user/sessions`) — тот же `load`, что у модалки `user.sessions`.
// Блокировка — именованные экшены. Тело разбирает `#lib/form`, не маршрут.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { sessionRevokeForm, sessionRevokeOthersForm } from '#content/user/sessions.form.js'
import type { SessionsRouteData } from '#content/user/index.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

const failed = '/user/sessions?notice=revoke-failed'
const list = '/user/sessions'
const throttle = createIpThrottle('user-sessions-revoke', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

export const load: PageServerLoad = async (event): Promise<SessionsRouteData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })
  const notice = event.url.searchParams.get('notice') === 'revoke-failed' ? 'revoke-failed' : null
  const u = auth(event)
  if (!u.enabled) {
    return { enabled: false, fact: 'auth.disabled', page: null, notice }
  }
  const r = await u.listSessionsPage()
  if (!r.ok) {
    return { enabled: true, fact: r.fact.code, page: null, notice }
  }
  return { enabled: true, fact: null, page: r.value, notice }
}

export const actions: Actions = {
  revoke: async (event) => {
    const handled = await createFormHandler({
      description: sessionRevokeForm(''),
      order: SECURITY_LAYERS,
      throttle,
      async execute({ values, commit, fail }) {
        const id = String(values.id ?? '').trim()
        const r = await auth(event).revokeSessionById(id)
        if (!r.ok) fail([error('auth.revoke', 'Не удалось заблокировать сессию', 'id')])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.ok && handled.result.redirect?.startsWith('/') ? handled.result.redirect : failed)
  },
  others: async (event) => {
    const handled = await createFormHandler({
      description: sessionRevokeOthersForm(),
      order: SECURITY_LAYERS,
      throttle,
      async execute({ commit, fail }) {
        const r = await auth(event).revokeBulkSessions({ scope: 'others' })
        if (!r.ok) fail([error('auth.revoke', 'Не удалось заблокировать остальные сессии')])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.ok && handled.result.redirect?.startsWith('/') ? handled.result.redirect : failed)
  },
}
