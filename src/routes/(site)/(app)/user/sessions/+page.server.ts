// Свои устройства (`/user/sessions`) — тот же `load`, что у модалки
// `user.sessions`: одна дверь данных для страницы, модалки и догрузки порций.
// Адресные ключи — `sessions.*` (объявлены в `ui/sessions-list/source.ts`).
// Чужой аккаунт живёт отдельным путём (`/user/<uuid>/sessions`): цель —
// параметр пути, а не query-ключ. Экшены у пары роутов свои, как у блокировок.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { runBulkExit } from '#content/user/sessions-exit.server.js'
import { sessionBulkExitForm, sessionRevokeForm } from '#content/user/sessions.form.js'
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
        if (!r.ok) return fail([error('auth.revoke', 'Не удалось заблокировать сессию', 'id')])
        commit()
        return { redirect: r.value.current ? '/user/auth' : list }
      },
    })(event.request, 'action', event)
    redirect(
      303,
      handled.result.ok && handled.result.redirect?.startsWith('/')
        ? handled.result.redirect
        : `${list}?notice=revoke-failed`,
    )
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
