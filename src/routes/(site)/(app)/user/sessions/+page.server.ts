// Свои устройства (`/user/sessions`) — тот же `load`, что у модалки
// `user.sessions`: одна дверь данных для страницы, модалки и догрузки порций.
// Адресные ключи — `sessions.*` (объявлены в `ui/sessions-list/source.ts`).
// Чужой аккаунт живёт отдельным путём (`/user/<uuid>/sessions`): цель —
// параметр пути, а не query-ключ. Экшены у пары роутов свои, как у блокировок.
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { runBulkExit, sessionFormError } from '#content/user/sessions-exit.server.js'
import { sessionBulkExitForm, sessionRevokeForm } from '#content/user/sessions.form.js'
import { loadSessionsRouteData, sessionsListHref, sessionsTargetOf } from '#content/user/ui/sessions-list/load.server.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

const revokeThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

export const load: PageServerLoad = async (event) => loadSessionsRouteData(event, null)

export const actions: Actions = {
  revoke: async (event) => {
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
    if (handled.result.ok && handled.result.redirect?.startsWith('/')) redirect(303, handled.result.redirect)
    if (handled.result.outcome === 'unknown') return fail(handled.status, { result: handled.result })
    redirect(303, `${list}?notice=revoke-failed`)
  },
  others: async (event) => {
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
    if (handled.result.ok && handled.result.redirect?.startsWith('/')) redirect(303, handled.result.redirect)
    // Исход неизвестен (коммит начался) — не глухой редирект: форма получает
    // результат и статус, экран рисует ошибку. Прочий отказ — notice на списке.
    if (handled.result.outcome === 'unknown') return fail(handled.status, { result: handled.result })
    redirect(303, `${list}?notice=revoke-failed`)
  },
}
