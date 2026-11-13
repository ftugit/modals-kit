// Устройства выбранного аккаунта (`/user/<uuid>/sessions`). Тот же загрузчик,
// что у своих: цель — параметр пути, как у блокировок (`/user/[id]/blocks`).
// Экшены повторяют пару `/user/sessions` — по образцу пар блокировок; цель
// отзыва оба берут из пути, а не из тела формы.
import { fail, redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { sessionBulkExitForm, sessionRevokeForm } from '#content/user/sessions.form.js'
import { runBulkExit, sessionFormError } from '#content/user/sessions-exit.server.js'
import { loadSessionsRouteData, sessionsListHref, sessionsTargetOf } from '#content/user/ui/sessions-list/load.server.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

const revokeThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

export const load: PageServerLoad = async (event) => loadSessionsRouteData(event, event.params.id)

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
        // Набор собирает форма, а не имя экшена: цель — аккаунт из пути.
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
