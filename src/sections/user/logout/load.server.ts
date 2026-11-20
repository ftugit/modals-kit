// Section: выход (`/user/logout`) — load/actions вынесены из route.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { runBulkExit, runLocalExit, sessionFormError } from '#modules/user/sessions/service/sessions-exit.server.js'
import { sessionBulkExitForm } from '#modules/user/sessions/svelte/sessions.form.js'
import { logoutLocalForm } from '#modules/user/base/svelte/logout/form.js'
import type { LogoutRouteData } from '#modules/user/base/model/types.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'

// Выход не чаще соседа по частоте — отзыв сессий (`user-sessions-revoke`).
const exitThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

export async function loadLogout(event: RequestEvent): Promise<LogoutRouteData> {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const u = auth(event)
  const me = await u.actor()
  // Без актора набор собрать нельзя — остаётся локальный выход. Отказом это
  // не считается: выйти должен и тот, чей токен уже не читается.
  if (!me.ok) return { enabled: u.enabled, sessionId: null, total: 0, canRevoke: false }

  const page = await u.listSessionsPage({ authId: me.value.id, state: 'active', page: 1, pageSize: 1 })
  return {
    enabled: u.enabled,
    sessionId: me.value.sessionId,
    total: page.ok ? page.value.total : 0,
    canRevoke: true,
  }
}

export const logoutActions = {
  exit: async (event: RequestEvent) => {
    const here = '/user/logout'
    const handled = await createFormHandler({
      description: sessionBulkExitForm({ spread: true }),
      order: SECURITY_LAYERS,
      throttle: exitThrottle,
      async execute({ values, commit, fail }: any) {
        const r = await runBulkExit(
          event,
          values,
          { selfHref: here, doneHref: '/' },
          (message: string) => sessionFormError('auth.unavailable', message),
        )
        // Выход: пустой набор или отсутствие прав не блокируют успех.
        if (!r.ok && r.error?.code !== 'session.nothing-to-close' && r.error?.code !== 'auth.forbidden') {
          return fail([r.error ?? sessionFormError('auth.unavailable')])
        }
        await auth(event).logoutLocal()
        commit()
        return { redirect: '/' }
      },
    })(event.request, 'action', event)
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    if (handled.result.outcome === 'unknown') return fail(handled.status, { result: handled.result })
    return fail(handled.status, { result: handled.result })
  },
  local: async (event: RequestEvent) => {
    const handled = await createFormHandler({
      description: logoutLocalForm,
      order: SECURITY_LAYERS,
      throttle: exitThrottle,
      async execute({ commit }: any) {
        await runLocalExit(event)
        commit()
        return { redirect: '/' }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.redirect ?? '/')
  },
}
