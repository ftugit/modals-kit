// POST фильтров списка устройств. База search — путь списка из тела (`from`),
// не URL страницы `/user/sessions/filters`.
import type { FormError } from '#lib/form/index.js'
import { listHref } from '#lib/paginate/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import {
  SESSIONS_FILTER_MESSAGES,
  SESSIONS_FILTERS_FORM_ID,
  applySessionsFilters,
  sessionsFiltersForm,
} from './filters-form.js'
import { SESSIONS_NAME, SESSIONS_PAGE_PARAM, ensureSessionsPaginator } from './source.js'

function refuse(path: string, code: keyof typeof SESSIONS_FILTER_MESSAGES): FormError {
  return {
    id: `${path}:${code}`,
    path,
    code,
    message: SESSIONS_FILTER_MESSAGES[code],
    origin: 'server',
  }
}

// Пункты стран серверу не нужны: `decode` множественного выбора значения с
// пунктами не сверяет, а допустимость кода проверяет `applySessionsFilters`.
registerComponentForm({
  id: SESSIONS_FILTERS_FORM_ID,
  description: sessionsFiltersForm(),
  execute: async ({ values, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    const from = String(values.from ?? '')
    // Права читает домен: то же правило, что рисует пункты формы.
    const probe = await u.listSessionsPage({ page: 1, pageSize: 1 })
    if (!probe.ok) return fail(instruction(probe.fact))
    ensureSessionsPaginator()
    const applied = applySessionsFilters(values, { canSeeDeleted: probe.value.canSeeDeleted })
    if (!applied.ok) {
      return fail([refuse(applied.path, applied.code as keyof typeof SESSIONS_FILTER_MESSAGES)])
    }
    if (String(values.paginator ?? '') !== SESSIONS_NAME) return fail([refuse('paginator', 'filters.no-address')])
    if (String(values.page_param ?? '') !== SESSIONS_PAGE_PARAM) {
      return fail([refuse('page_param', 'filters.no-address')])
    }
    const href = listHref(SESSIONS_NAME, from, applied.patch, applied.pageSize)
    if (!href) return fail([refuse('from', 'filters.no-address')])
    commit()
    return { data: { href } }
  },
  redirectOnSuccess: (_event, result) => {
    const href = (result.data as { href?: unknown } | undefined)?.href
    return typeof href === 'string' ? href : null
  },
})
