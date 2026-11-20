// Устройства выбранного аккаунта (`/user/<uuid>/sessions`). Тот же загрузчик,
// что у своих: цель — параметр пути, как у блокировок (`/user/[id]/blocks`).
// Экшены повторяют пару `/user/sessions` — по образцу пар блокировок; цель
// отзыва оба берут из пути, а не из тела формы.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { sessionBulkExitForm, sessionRevokeForm } from '#modules/user/sessions/svelte/sessions.form.js'
import { runBulkExit, sessionFormError } from '#modules/user/sessions/service/sessions-exit.server.js'
import { loadSessionsRouteData, sessionsListHref, sessionsTargetOf } from '#modules/user/sessions/svelte/sessions-list/load.server.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'

const revokeThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

export async function loadUserSessions(event: RequestEvent<{ id: string }>) { return loadSessionsRouteData(event, event.params.id) }

export const userSessionsActions = {
  revoke: async (event: RequestEvent<{ id: string }>) => {
    const list = sessionsListHref(sessionsTargetOf(event))
    const handled = await createFormHandler({
      description: sessionRevokeForm(''),
      order: SECURITY_LAYERS,
      throttle: revokeThrottle,
      async execute({ values, commit, fail }) {
        const id = String(values.id ?? '').trim()
        const r = await auth(event).revokeSessionById(id)
        if (!r.ok) return fail([sessionFormError(r.fact.code)])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    if (handled.result.ok) {
      event.locals.formResult = handled.result
      return { result: handled.result }
    }
    return fail(handled.status, { result: handled.result })
  },
  others: async (event: RequestEvent<{ id: string }>) => {
    const target = sessionsTargetOf(event)
    const list = sessionsListHref(target)
    const handled = await createFormHandler({
      description: sessionBulkExitForm(),
      order: SECURITY_LAYERS,
      throttle: revokeThrottle,
      async execute({ values, commit, fail }) {
        // Набор собирает форма, а не имя экшена: цель — аккаунт из пути.
        const r = await runBulkExit(
          event,
          values,
          { authId: target, selfHref: list, doneHref: '/user/auth' },
          (message) => sessionFormError('auth.unavailable', message),
        )
        if (!r.ok) return fail([r.error ?? sessionFormError('auth.unavailable')])
        commit()
        if (r.current) return { redirect: '/user/auth' }
        if (r.requested > r.revoked) return { data: { requested: r.requested, revoked: r.revoked } }
        return { redirect: list }
      },
    })(event.request, 'action', event)
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    if (handled.result.ok) {
      event.locals.formResult = handled.result
      return { result: handled.result }
    }
    return fail(handled.status, { result: handled.result })
  },
}
