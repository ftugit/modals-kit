// Устройства выбранного аккаунта (`/user/<uuid>/sessions`). Тот же загрузчик,
// что у своих: цель — параметр пути, как у блокировок (`/user/[id]/blocks`).
// Экшены повторяют пару `/user/sessions` — по образцу пар блокировок; цель
// отзыва оба берут из пути, а не из тела формы.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { sessionBulkExitForm } from '#content/user/sessions.form.js'
import { runBulkExit } from '#content/user/sessions-exit.server.js'
import { loadSessionsRouteData, sessionsListHref, sessionsTargetOf } from '#content/user/ui/sessions-list/load.server.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

const revokeThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

const error = (code: string, message: string, path?: string): FormError => ({
  id: `${path ?? '*'}:${code}:0`,
  code,
  message,
  ...(path ? { path } : {}),
  origin: 'server',
})

export const load: PageServerLoad = async (event) => loadSessionsRouteData(event, event.params.id)

export const actions: Actions = {
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
          (message) => error('auth.revoke', message),
        )
        if (!r.ok) return fail([r.error ?? error('auth.revoke', 'Не удалось завершить сессии')])
        commit()
        return { redirect: r.redirect }
      },
    })(event.request, 'action', event)
    redirect(
      303,
      handled.result.ok && handled.result.redirect?.startsWith('/')
        ? handled.result.redirect
        : `${list}?notice=revoke-failed`,
    )
  },
}
