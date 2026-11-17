// Регистрация модалок сессий. Подхватывается glob'ом `modules/**/modals.ts`
// в layout сайта: без субмодуля нет ни модалок, ни битых ссылок.
import { registerModal } from '#core/lib/modals/index.js'
import { lazy } from '#core/lib/modals/svelte/index.js'
import { parseSessionDeleteVariant } from '#modules/user/base/model/session-delete.js'
import {
  sessionsJournalRoute,
  userAccountSessionRoute,
  userAccountSessionsDeleteRoute,
  userAccountSessionsRoute,
  userSessionRoute,
  userSessionsDeleteRoute,
  userSessionsFiltersRoute,
  userSessionsRoute,
} from '#modules/user/base/routes.js'

// Устройства аккаунта: один компонент на свои и чужие. `id` аккаунта задаёт
// и цель внутри списка, и страницу-fallback без JS (`/user/[id]/sessions`).
registerModal({
  name: 'user.sessions',
  component: lazy(() => import('#modules/user/sessions/svelte/SessionsModal.svelte')),
  route: (p: { id?: string }) =>
    p?.id ? userAccountSessionsRoute.href({ id: String(p.id) }) : userSessionsRoute.href(),
  size: { width: 560, height: 600 },
})
// Журнал сессий (`/sessions`) — свой роут и свой ключ модалки.
registerModal({
  name: 'user.sessions.journal',
  component: lazy(() => import('#modules/user/sessions/svelte/SessionsJournalModal.svelte')),
  route: sessionsJournalRoute.href,
  size: { width: 560, height: 600 },
})
// Фильтры списка устройств: `uid` — цель среза, `journal` — режим журнала.
registerModal({
  name: 'user.sessions.filters',
  component: lazy(() => import('#modules/user/sessions/svelte/SessionsFiltersModal.svelte')),
  defaultParams: { uid: '', journal: '' },
  route: (p: { uid?: string; journal?: string }) =>
    userSessionsFiltersRoute.href({
      uid: p?.uid ? String(p.uid) : null,
      journal: p?.journal === '1' || p?.journal === 'true' ? '1' : null,
    }),
  size: { width: 440, height: 600 },
})
// Карточка устройства (переименование и отзыв).
registerModal({
  name: 'user.session',
  component: lazy(() => import('#modules/user/sessions/svelte/SessionModal.svelte')),
  route: (p: { id?: string; uid?: string }) => {
    const uid = p?.uid ? String(p.uid) : null
    const id = p?.id ? String(p.id) : null
    if (uid && id) return userAccountSessionRoute.href({ id: uid, sessionId: id })
    if (id) return userSessionRoute.href({ id })
    return uid ? userAccountSessionsRoute.href({ id: uid }) : userSessionsRoute.href()
  },
  size: { width: 480, height: 560 },
})
// Закрытие набора устройств — один ключ и два адреса (свои / чужой аккаунт).
registerModal({
  name: 'user.session.delete',
  component: lazy(() => import('#modules/user/sessions/svelte/SessionDeleteModal.svelte')),
  defaultParams: { ids: '', variant: 'delete', filters: '' },
  route: (p: { ids?: string; variant?: string; uid?: string; filters?: Record<string, string> | string }) => {
    const ids = p?.ids ? String(p.ids).trim() : null
    const variant = parseSessionDeleteVariant(p?.variant)
    const filterParams: Record<string, string> = {}
    const raw = p?.filters
    if (raw && typeof raw === 'object') {
      for (const [key, value] of Object.entries(raw)) {
        if (typeof value === 'string' && value.trim() !== '') filterParams[key] = value.trim()
      }
    }
    return p?.uid
      ? userAccountSessionsDeleteRoute.href({ id: String(p.uid) }, { ids, variant, ...filterParams })
      : userSessionsDeleteRoute.href({ ids, variant, ...filterParams })
  },
  size: { width: 460, height: 440 },
})
