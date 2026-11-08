// POST поиска списка. Хук форм бежит до инициализации страницы, поэтому
// пагинатор регистрируется здесь, до `linkFor`. Новый список с поиском
// нужно добавить в `ensure` — иначе без JS адрес не из чего собрать.
import type { FormError } from '#lib/form/index.js'
import { getPaginator, hasPaginator, listHref } from '#lib/paginate/index.js'
import { normalizeSearchQuery } from '#lib/paginate/search/index.js'
import { registerComponentForm } from '#hooks/component-form/registry.js'
import {
  PAGINATOR_SEARCH_MAX,
  paginatorSearchForm,
} from '#components/paginator/search-form.js'
import { ensureBlocksPaginator, BLOCKS_NAME } from './blocks-list/source.js'
import { ensureSeedUsersPaginator, SEED_USERS_NAME } from './seed-users/source.js'

function ensure(name: string) {
  if (name === SEED_USERS_NAME) ensureSeedUsersPaginator()
  else if (name === BLOCKS_NAME) ensureBlocksPaginator()
}

function refuse(path: string): FormError {
  return {
    id: `${path}:search.no-address`,
    path,
    code: 'search.no-address',
    message: 'У этого списка нет адреса для применения без JS.',
    origin: 'server',
  }
}

registerComponentForm({
  description: paginatorSearchForm,
  execute: ({ values, commit, fail }) => {
    const name = String(values.paginator ?? '')
    ensure(name)
    if (!hasPaginator(name)) return fail([refuse('paginator')])
    const adapter = getPaginator(name).adapter
    const keys = adapter.extraKeys?.() ?? []
    if (!keys.includes('q')) return fail([refuse('q')])
    const declared = adapter.fieldName?.('q')
    const pageParam = String(values.page_param ?? '')
    if (!declared || declared !== `${pageParam}.q`) return fail([refuse('page_param')])
    const q = normalizeSearchQuery(String(values.q ?? ''), PAGINATOR_SEARCH_MAX)
    const href = listHref(name, String(values.from ?? ''), { q: q || undefined })
    if (!href) return fail([refuse('from')])
    commit()
    return { data: { href } }
  },
  redirectOnSuccess: (_event, result) => {
    const href = (result.data as { href?: unknown } | undefined)?.href
    return typeof href === 'string' ? href : null
  },
})
