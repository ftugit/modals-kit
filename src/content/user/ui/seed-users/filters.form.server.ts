// POST фильтров seed-юзеров. Адрес собирает адаптер из `from` в теле, не из
// адреса страницы: на `/users/filters` текущий URL — страница фильтров.
import type { FormError } from '#lib/form/index.js'
import { listHref } from '#lib/paginate/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import {
  SEED_FILTER_MESSAGES,
  SEED_USERS_FILTERS_FORM_ID,
  applySeedFilters,
  seedUsersFiltersForm,
} from './filters-form.js'
import { SEED_USERS_NAME, SEED_USERS_PAGE_PARAM, ensureSeedUsersPaginator } from './source.js'

function refuse(path: string, code: keyof typeof SEED_FILTER_MESSAGES): FormError {
  return {
    id: `${path}:${code}`,
    path,
    code,
    message: SEED_FILTER_MESSAGES[code],
    origin: 'server',
  }
}

registerComponentForm({
  id: SEED_USERS_FILTERS_FORM_ID,
  description: seedUsersFiltersForm,
  execute: async ({ values, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    const probe = await u.listSeedUsers({ page: 1, pageSize: 1 })
    if (!probe.ok) return fail(instruction(probe.fact))
    ensureSeedUsersPaginator()
    const applied = applySeedFilters(values, {
      canSeeDeleted: probe.value.canSeeDeleted,
      canSeeNickname: probe.value.canSeeNickname,
    })
    if (!applied.ok) return fail([refuse(applied.path, applied.code as keyof typeof SEED_FILTER_MESSAGES)])
    if (String(values.paginator ?? '') !== SEED_USERS_NAME) return fail([refuse('paginator', 'filters.no-address')])
    if (String(values.page_param ?? '') !== SEED_USERS_PAGE_PARAM) return fail([refuse('page_param', 'filters.no-address')])
    const href = listHref(SEED_USERS_NAME, String(values.from ?? ''), applied.patch, applied.pageSize)
    if (!href) return fail([refuse('from', 'filters.no-address')])
    commit()
    return { data: { href } }
  },
  redirectOnSuccess: (_event, result) => {
    const href = (result.data as { href?: unknown } | undefined)?.href
    return typeof href === 'string' ? href : null
  },
})
