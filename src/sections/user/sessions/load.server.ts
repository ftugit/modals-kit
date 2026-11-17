// Свои устройства (`/user/sessions`) — тот же `load`, что у модалки
// `user.sessions`: одна дверь данных для страницы, модалки и догрузки порций.
// Адресные ключи — `sessions.*` (объявлены в `ui/sessions-list/source.ts`).
// Чужой аккаунт живёт отдельным путём (`/user/<uuid>/sessions`): цель —
// параметр пути, а не query-ключ. Экшены у пары роутов свои, как у блокировок.
import type { RequestEvent } from '@sveltejs/kit'
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { runBulkExit, sessionFormError } from '#modules/user/sessions/service/sessions-exit.server.js'
import { sessionBulkExitForm, sessionRevokeForm } from '#modules/user/sessions/svelte/sessions.form.js'
import { loadSessionsRouteData, sessionsListHref, sessionsTargetOf } from '#modules/user/sessions/svelte/sessions-list/load.server.js'
import { createFormHandler } from '#core/lib/form/server.js'
import { createIpThrottle } from '#core/server/client-ip.server.js'
import { SECURITY_LAYERS } from '#core/server/form-security.server.js'

const revokeThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

export async function loadUserSessions(event: RequestEvent) { return loadSessionsRouteData(event, null) }

export const userSessionsActions = {
  revoke: async (event: RequestEvent) => {
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
    return fail(handled.status, { result: handled.result })
  },
  others: async (event: RequestEvent) => {
    const target = sessionsTargetOf(event)
    const list = sessionsListHref(target)
    const handled = await createFormHandler({
      description: sessionBulkExitForm(),
      order: SECURITY_LAYERS,
      throttle: revokeThrottle,
      async execute({ values, commit, fail }) {
        // Набор собирает форма, а не имя экшена: «закрыть всё, что в списке»
        // и «закрыть выбранное» — разные наборы одного действия.
        const r = await runBulkExit(
          event,
          values,
          { authId: target, selfHref: list, doneHref: '/user/auth' },
          (message) => sessionFormError('auth.unavailable', message),
        )
        if (!r.ok) return fail([r.error ?? sessionFormError('auth.unavailable')])
        commit()
        return { redirect: r.redirect }
      },
    })(event.request, 'action', event)
    if (handled.result.ok && handled.result.redirect) redirect(303, handled.result.redirect)
    return fail(handled.status, { result: handled.result })
  },
}
