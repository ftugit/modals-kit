/**
 * POST фильтров «Диска» (`plan-drive-repair.md` §6.3). Адрес списка собирает
 * адаптер пагинатора из `from` в теле, а не из адреса страницы: на
 * `/drive/filters` текущий URL — страница фильтров.
 */
import type { FormError } from '#core/lib/form/index.js'
import { localPath } from '#core/lib/address/index.js'
import { listHref } from '#core/lib/paginate/index.js'
import { registerComponentForm } from '#core/hooks/component-form/registry.js'
import { auth } from '#modules/user/base/service/gateway.server.js'
import { DRIVE_FILTERS_FORM_ID, applyDriveFilters, driveFiltersForm } from '../../filters-form.js'
import { DRIVE_FILTER_MESSAGES } from '../../filters-form.js'
import { DRIVE_MESSAGES } from '../../messages.js'
import {
  DRIVE_NAME,
  DRIVE_PAGE_DEFAULT,
  DRIVE_PAGE_PARAM,
  ensureDrivePaginator,
} from '../../source.js'

function messageOf(code: string): string {
  return (
    (DRIVE_FILTER_MESSAGES as Record<string, string>)[code] ??
    (DRIVE_MESSAGES as Record<string, string>)[code] ??
    code
  )
}

function refuse(path: string, code: string): FormError {
  return {
    id: `${path}:${code}`,
    path,
    code,
    message: messageOf(code),
    origin: 'server',
  }
}

// Реестр конфигураций общий для всех форм; init выполняется до любого POST.
ensureDrivePaginator()

registerComponentForm({
  id: DRIVE_FILTERS_FORM_ID,
  description: () => driveFiltersForm,
  execute: async ({ values, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail([refuse('from', 'auth.disabled')])
    const who = await u.actor()
    if (!who.ok) return fail([refuse('from', who.fact.code)])

    if (String(values.paginator ?? '') !== DRIVE_NAME) {
      return fail([refuse('paginator', 'filters.no-address')])
    }
    if (String(values.page_param ?? '') !== DRIVE_PAGE_PARAM) {
      return fail([refuse('page_param', 'filters.no-address')])
    }

    const from = localPath(typeof values.from === 'string' ? values.from : null)
    if (!from) return fail([refuse('from', 'filters.no-address')])

    const applied = applyDriveFilters(values as Record<string, unknown>)
    if (!applied.ok) return fail([refuse(applied.path, applied.code)])

    const href = listHref(DRIVE_NAME, from, applied.patch, applied.pageSize || DRIVE_PAGE_DEFAULT)
    if (!href) return fail([refuse('from', 'filters.no-address')])

    commit()
    return { data: { href } }
  },
  redirectOnSuccess: (_event, result) => {
    const href = (result.data as { href?: unknown } | undefined)?.href
    return typeof href === 'string' ? href : null
  },
})
