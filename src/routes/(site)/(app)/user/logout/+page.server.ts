// Выход (`/user/logout`) — носитель пары `user.logout`: страница-fallback
// модалки и её же адрес. Экшены общие с компонентом: набор уходит в `?/exit`,
// локальный выход — в `?/local`.
//
// Данные выхода обязаны быть приватными: у `load` нет ни одного заголовка
// по умолчанию.
import { redirect } from '@sveltejs/kit'
import { auth } from '#content/user/gateway.server.js'
import { runBulkExit, runLocalExit } from '#content/user/sessions-exit.server.js'
import { sessionBulkExitForm } from '#content/user/sessions.form.js'
import { logoutLocalForm } from '#content/user/ui/logout/form.js'
import type { LogoutRouteData } from '#content/user/types.js'
import type { FormError } from '#lib/form/index.js'
import { createFormHandler } from '#lib/form/server.js'
import { createIpThrottle } from '#server/client-ip.server.js'
import { SECURITY_LAYERS } from '#server/form-security.server.js'
import type { Actions, PageServerLoad } from './$types'

// Выход не чаще соседа по частоте — отзыв сессий (`user-sessions-revoke`).
const exitThrottle = createIpThrottle('user-sessions-revoke', 30, 60_000)

const error = (code: string, message: string): FormError => ({
  id: `*:${code}:0`,
  code,
  message,
  origin: 'server',
})

export const load: PageServerLoad = async (event): Promise<LogoutRouteData> => {
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

export const actions: Actions = {
  exit: async (event) => {
    const here = '/user/logout'
    const handled = await createFormHandler({
      description: sessionBulkExitForm({ spread: true }),
      order: SECURITY_LAYERS,
      throttle: exitThrottle,
      async execute({ values, commit, fail }) {
        const r = await runBulkExit(
          event,
          values,
          { selfHref: here, doneHref: '/user/auth' },
          (message) => error('auth.unavailable', message),
        )
        if (!r.ok) return fail([r.error ?? error('auth.unavailable', 'Не удалось завершить сессии')])
        commit()
        return { redirect: r.redirect }
      },
    })(event.request, 'action', event)
    redirect(
      303,
      handled.result.ok && handled.result.redirect?.startsWith('/')
        ? handled.result.redirect
        : `${here}?notice=revoke-failed`,
    )
  },
  local: async (event) => {
    const handled = await createFormHandler({
      description: logoutLocalForm,
      order: SECURITY_LAYERS,
      throttle: exitThrottle,
      async execute({ commit }) {
        const r = await runLocalExit(event)
        commit()
        return { redirect: r.ok ? r.redirect : '/user/logout' }
      },
    })(event.request, 'action', event)
    redirect(303, handled.result.redirect?.startsWith('/') ? handled.result.redirect : '/')
  },
}
