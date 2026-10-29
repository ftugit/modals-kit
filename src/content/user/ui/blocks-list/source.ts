/**
 * Источник и регистрация пагинатора списка блокировок (`user.block`).
 *
 * Поддерживает два режима одного компонента `BlocksList`:
 *  - глобальный (`/blocks`): все блокировки с фильтрацией по сферам,
 *    состоянию и выбранным пользователям (`blocks.uids`);
 *  - персональный (`/user/[id]/blocks`): блокировки конкретного пользователя
 *    (`_uid` хранится во внутреннем `extra` снапшота и не засоряет URL).
 */
import { preloadData } from '$app/navigation'
import {
  createUrlAdapter,
  definePaginator,
  defineSource,
  extraField,
  hasPaginator,
  type ExtraSearchSpec,
  type PageResponse,
  type PaginatorState,
} from '#lib/paginate/index.js'
import type { AuthErrorCode } from '../../error.js'
import { AUTH_MESSAGES } from '../../messages.js'
import { BLOCK_SCOPES, isBlockScope } from '../../spec-block.js'
import type { BlocksOrder, BlocksPage, BlocksState, BlockView } from '../../types.js'

export const BLOCKS_NAME = 'user-blocks'
export const BLOCKS_PAGE_SIZE = 30
export const BLOCKS_PAGE_SIZES: readonly number[] = Array.from({ length: 71 }, (_, i) => i + 30)
export const BLOCKS_PAGE_PARAM = 'blocks'

export const BLOCKS_FILTER_KEYS = ['ord', 'state', 'scopes', 'uids'] as const
export const BLOCKS_INTERNAL_UID_KEY = '_uid'

export const BLOCKS_ORDERS: readonly BlocksOrder[] = [
  'created-desc',
  'created-asc',
  'until-asc',
  'until-desc',
  'scope-asc',
  'scope-desc',
  'deleted-desc',
  'deleted-asc',
]

export const BLOCKS_STATES: readonly BlocksState[] = ['all', 'active', 'expired', 'deleted']

export const BLOCKS_EXTRA_SEARCH: ExtraSearchSpec = {
  ord: extraField('text', (v) => BLOCKS_ORDERS.includes(v as BlocksOrder)),
  state: extraField('text', (v) => BLOCKS_STATES.includes(v as BlocksState)),
  scopes: extraField('text', (v) => {
    if (typeof v !== 'string' || v.length > 400) return false
    const parts = v.split(',').filter(Boolean)
    return parts.length > 0 && parts.every(isBlockScope)
  }),
  uids: extraField('text', (v) => typeof v === 'string' && /^[0-9a-f,-]{1,4000}$/i.test(v)),
}

export const BLOCKS_EXTRA_DEFAULTS = {
  ord: 'created-desc',
  state: 'all',
  scopes: '',
  uids: '',
} as const

export interface BlocksRouteData {
  snapshot: PaginatorState<BlockView> | null
  fact: AuthErrorCode | null
  enabled: boolean
  uid: string | null
  canSeeDeleted: boolean
  canSeeLive: boolean
  canPickUsers: boolean
  canCreate: boolean
  assignableScopes: readonly string[]
}

/** Разбор сфер блокировок из query-параметров (`blocks.scopes` и no-JS `blocks.sc.<key>`). */
export function parseBlocksScopesFromSearch(sp: URLSearchParams): string[] {
  const out = new Set<string>()
  const csv = sp.get(`${BLOCKS_PAGE_PARAM}.scopes`) ?? ''
  for (const part of csv.split(',')) {
    const trimmed = part.trim()
    if (isBlockScope(trimmed)) out.add(trimmed)
  }
  for (const key of Object.keys(BLOCK_SCOPES)) {
    const flag = sp.get(`${BLOCKS_PAGE_PARAM}.sc.${key}`)
    if (flag === '1' || flag === 'on' || flag === 'true') out.add(key)
  }
  return [...out]
}

async function fetchBlocksPage(
  page: number,
  pageSize: number,
  input?: { q?: string; filters?: Readonly<Record<string, string>> },
): Promise<PageResponse<BlockView>> {
  const filters = input?.filters ?? {}
  const fixedUid = filters[BLOCKS_INTERNAL_UID_KEY]?.trim() || ''
  const q = new URLSearchParams({
    [BLOCKS_PAGE_PARAM]: String(page),
    [`${BLOCKS_PAGE_PARAM}.size`]: String(pageSize),
  })
  for (const k of BLOCKS_FILTER_KEYS) {
    const v = filters[k]
    if (v) q.set(`${BLOCKS_PAGE_PARAM}.${k}`, v)
  }
  const basePath = fixedUid ? `/user/${encodeURIComponent(fixedUid)}/blocks` : '/blocks'
  const r = await preloadData(`${basePath}?${q}`)
  if (r.type !== 'loaded') {
    const err = new Error('Не удалось загрузить блокировки') as Error & { code: string }
    err.code = r.type === 'redirect' ? 'auth.expired' : 'load.error'
    throw err
  }
  const data = r.data as BlocksRouteData
  if (data.fact) {
    const err = new Error(AUTH_MESSAGES[data.fact] ?? 'Не удалось загрузить блокировки') as Error & {
      code: string
    }
    err.code = data.fact
    throw err
  }
  const snap = data.snapshot
  if (!snap) throw new Error('Не удалось загрузить блокировки')
  return {
    items: snap.pages[page] ?? [],
    totalItems: snap.totalItems ?? undefined,
    totalPages: snap.totalPages ?? undefined,
    hasNext: snap.hasNext ?? false,
  }
}

export const blocksSource = defineSource<BlockView>({
  name: 'user_blocks',
  record: {
    id: (r) => r.id,
    title: (r) => `${r.scope}: ${r.reason}`,
    texts: (r) => [r.scope, r.reason, r.authId],
  },
  filters: [...BLOCKS_FILTER_KEYS, BLOCKS_INTERNAL_UID_KEY],
  totals: true,
  data: (look, input) => fetchBlocksPage(look.page, look.pageSize, input),
})

export function ensureBlocksPaginator(): string {
  if (!hasPaginator(BLOCKS_NAME)) {
    definePaginator({
      name: BLOCKS_NAME,
      reloadKeys: [...BLOCKS_FILTER_KEYS, BLOCKS_INTERNAL_UID_KEY],
      adapter: createUrlAdapter({
        name: BLOCKS_NAME,
        source: blocksSource,
        pageSize: BLOCKS_PAGE_SIZE,
        pageSizes: BLOCKS_PAGE_SIZES,
        pageParam: BLOCKS_PAGE_PARAM,
        extraSearch: BLOCKS_EXTRA_SEARCH,
        extraDefaults: BLOCKS_EXTRA_DEFAULTS,
      }),
    })
  }
  return BLOCKS_NAME
}

export function blocksSnapshot(
  p: BlocksPage,
  extra?: {
    ord?: string
    state?: string
    scopes?: string
    uids?: string
  },
): PaginatorState<BlockView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  const snapExtra: Record<string, string> = {}
  if (p.uid) snapExtra[BLOCKS_INTERNAL_UID_KEY] = p.uid
  if (extra?.ord && extra.ord !== BLOCKS_EXTRA_DEFAULTS.ord) snapExtra.ord = extra.ord
  if (extra?.state && extra.state !== BLOCKS_EXTRA_DEFAULTS.state) snapExtra.state = extra.state
  if (extra?.scopes) snapExtra.scopes = extra.scopes
  if (!p.uid && extra?.uids) snapExtra.uids = extra.uids

  return {
    name: BLOCKS_NAME,
    page: p.page,
    pageSize: p.pageSize,
    totalItems: p.total,
    totalPages,
    extra: snapExtra,
    loadedPages: [p.page],
    pages: { [p.page]: p.items },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: p.page < totalPages,
    hasPrev: p.page > 1,
    reqId: 0,
    capabilities: blocksSource.capabilitiesFor({}),
  }
}
