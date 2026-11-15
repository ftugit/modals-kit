import { preloadData } from '$app/navigation'
import {
  createUrlAdapter,
  defineListExtras,
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
import type { ProfileView } from '../../types.js'
import type { ProfilesPage } from '../../profile.js'

export const PROFILES_NAME = 'profiles'
export const PROFILES_PAGE_SIZE = 30
export const PROFILES_PAGE_SIZES: readonly number[] = [30, 50, 100]
export const PROFILES_PAGE_PARAM = 'profiles'

export const PROFILES_EXTRA_SEARCH: ExtraSearchSpec = {
  q: extraField('text', (v) => typeof v === 'string' && v.length <= 120),
}

export const PROFILES_EXTRA_DEFAULTS = { q: '' } as const

export const PROFILES_EXTRAS = defineListExtras({
  searchable: PROFILES_EXTRA_SEARCH,
  defaults: PROFILES_EXTRA_DEFAULTS,
})

export interface ProfilesRouteData {
  snapshot: PaginatorState<ProfileView> | null
  fact: AuthErrorCode | null
  enabled: boolean
}

async function fetchProfilesPage(
  page: number,
  pageSize: number,
  input?: { q?: string },
): Promise<PageResponse<ProfileView>> {
  const q = new URLSearchParams({
    [PROFILES_PAGE_PARAM]: String(page),
    [`${PROFILES_PAGE_PARAM}.size`]: String(pageSize),
  })
  if (input?.q) q.set(`${PROFILES_PAGE_PARAM}.q`, input.q)
  const r = await preloadData(`/profiles?${q}`)
  if (r.type !== 'loaded') {
    const err = new Error('Не удалось загрузить список') as Error & { code: string }
    err.code = r.type === 'redirect' ? 'auth.expired' : 'load.error'
    throw err
  }
  const data = r.data as ProfilesRouteData
  if (data.fact) {
    const err = new Error(AUTH_MESSAGES[data.fact] ?? 'Не удалось загрузить список') as Error & { code: string }
    err.code = data.fact
    throw err
  }
  const snap = data.snapshot
  if (!snap) throw new Error('Не удалось загрузить список')
  return {
    items: snap.pages[page] ?? [],
    totalItems: snap.totalItems ?? undefined,
    totalPages: snap.totalPages ?? undefined,
    hasNext: snap.hasNext ?? false,
  }
}

export const profilesSource = defineSource<ProfileView>({
  name: 'profiles',
  record: {
    id: (r) => r.id,
    title: (r) => r.nickname ?? r.id,
    texts: (r) => [r.nickname ?? '', r.id],
  },
  search: { minLength: 2 },
  filters: [],
  totals: true,
  data: (look, input) => fetchProfilesPage(look.page, look.pageSize, input),
})

export function ensureProfilesPaginator(): string {
  if (!hasPaginator(PROFILES_NAME)) {
    definePaginator({
      name: PROFILES_NAME,
      reloadKeys: [...PROFILES_EXTRAS.reloadKeys],
      pageSize: PROFILES_PAGE_SIZE,
      adapter: createUrlAdapter({
        name: PROFILES_NAME,
        source: profilesSource,
        pageSize: PROFILES_PAGE_SIZE,
        pageSizes: PROFILES_PAGE_SIZES,
        pageParam: PROFILES_PAGE_PARAM,
        extraSearch: PROFILES_EXTRA_SEARCH,
        extraDefaults: PROFILES_EXTRA_DEFAULTS,
      }),
    })
  }
  return PROFILES_NAME
}

export function profilesSnapshot(
  p: ProfilesPage,
  extra?: { q?: string | null },
): PaginatorState<ProfileView> {
  const totalPages = Math.max(1, Math.ceil(p.total / p.pageSize))
  const ex: Record<string, string> = {}
  if (extra?.q) ex.q = extra.q
  return {
    name: PROFILES_NAME,
    page: p.page,
    pageSize: p.pageSize,
    totalItems: p.total,
    totalPages,
    extra: ex,
    loadedPages: [p.page],
    pages: { [p.page]: p.items },
    status: 'idle',
    error: null,
    errorCode: null,
    pending: null,
    hasNext: p.page < totalPages,
    hasPrev: p.page > 1,
    reqId: 0,
    capabilities: profilesSource.capabilitiesFor({}),
  }
}