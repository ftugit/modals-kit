// POST фильтров блокировок. База search — путь списка из тела (`from`),
// не URL страницы `/blocks/filters`.
import type { FormError } from '#lib/form/index.js'
import { localPath } from '#lib/address/index.js'
import { listHref } from '#lib/paginate/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import { auth } from '../../gateway.server.js'
import { instruction } from '../../index.js'
import {
  BLOCKS_FILTER_MESSAGES,
  BLOCKS_FILTERS_FORM_ID,
  applyBlocksFilters,
  blocksFiltersForm,
} from './filters-form.js'
import { BLOCKS_NAME, BLOCKS_PAGE_PARAM, ensureBlocksPaginator } from './source.js'

function refuse(path: string, code: keyof typeof BLOCKS_FILTER_MESSAGES): FormError {
  return {
    id: `${path}:${code}`,
    path,
    code,
    message: BLOCKS_FILTER_MESSAGES[code],
    origin: 'server',
  }
}

function uidOf(from: string): string | null {
  const path = localPath(from)
  if (!path) return null
  const url = new URL(path, 'http://local.invalid')
  const match = /^\/user\/([0-9a-f-]{36})\/blocks(?:\/|$)/i.exec(url.pathname)
  return match?.[1] ?? null
}

// Реестр конфигураций общий для всех форм; init выполняется до любого POST.
ensureBlocksPaginator()

registerComponentForm({
  id: BLOCKS_FILTERS_FORM_ID,
  description: blocksFiltersForm,
  execute: async ({ values, commit, fail }, event) => {
    const u = auth(event)
    if (!u.enabled) return fail(instruction({ code: 'auth.disabled' }))
    const from = String(values.from ?? '')
    const uid = uidOf(from)
    const probe = await u.listBlocksPage({ uid, page: 1, pageSize: 1 })
    if (!probe.ok) return fail(instruction(probe.fact))
    ensureBlocksPaginator()
    const applied = applyBlocksFilters(values, {
      canSeeDeleted: probe.value.canSeeDeleted,
      canSeeLive: probe.value.canSeeLive,
      canPickUsers: probe.value.canPickUsers,
      uid,
    })
    if (!applied.ok) return fail([refuse(applied.path, applied.code as keyof typeof BLOCKS_FILTER_MESSAGES)])
    if (String(values.paginator ?? '') !== BLOCKS_NAME) return fail([refuse('paginator', 'filters.no-address')])
    if (String(values.page_param ?? '') !== BLOCKS_PAGE_PARAM) return fail([refuse('page_param', 'filters.no-address')])
    const href = listHref(BLOCKS_NAME, from, applied.patch, applied.pageSize)
    if (!href) return fail([refuse('from', 'filters.no-address')])
    commit()
    return { data: { href } }
  },
  redirectOnSuccess: (_event, result) => {
    const href = (result.data as { href?: unknown } | undefined)?.href
    return typeof href === 'string' ? href : null
  },
})
