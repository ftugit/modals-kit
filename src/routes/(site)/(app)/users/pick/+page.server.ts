// Страница выбора пользователей (`/users/pick`) — fallback модалки `user.picker`
// для no-JS и прямых переходов. Принимает `from` (куда вернуться), `param`
// (какой query-параметр в `from` заполнить выбранными UUID), `mode`
// (`single` | `multiple`) и `picked` (стартовый набор UUID).
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import type { AuthErrorCode, SeedUsersOrder, SeedUsersState } from '#content/user/index.js'
import {
  SEED_USERS_ORDERS,
  SEED_USERS_PAGE_PARAM,
  SEED_USERS_PAGE_SIZE,
  SEED_USERS_STATES,
  seedUsersSnapshot,
  type SeedUsersRouteData,
} from '#content/user/ui/seed-users/source.js'

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

const dateMs = (raw: string | null): number | null => {
  if (!raw) return null
  const v = Date.parse(raw)
  return Number.isFinite(v) ? v : null
}

export interface UserPickerPageData {
  mode: 'single' | 'multiple'
  picked: string[]
  fromHref: string
  targetParam: string
  initialUsers: SeedUsersRouteData
  fact: AuthErrorCode | null
  enabled: boolean
}

export const load: PageServerLoad = async (event): Promise<UserPickerPageData> => {
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const fromHref = localPath(sp.get('from')) ?? '/blocks'
  const mode = sp.get('mode') === 'single' ? 'single' : 'multiple'
  const rawParam = (sp.get('param') ?? 'blocks.uids').trim()
  const targetParam = /^[a-z0-9._-]{1,40}$/i.test(rawParam) ? rawParam : 'blocks.uids'
  const picked = (sp.get('picked') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 500)

  const key = (k: string) => sp.get(`${SEED_USERS_PAGE_PARAM}.${k}`)
  const page = num(sp.get(SEED_USERS_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = num(key('size'), SEED_USERS_PAGE_SIZE, 30, 100)
  const ord = key('ord')
  const state = key('state')
  const ids = (key('ids') ?? '').split(',').filter(Boolean).slice(0, 500)

  const u = auth(event)
  const r = await u.listSeedUsers({
    page,
    pageSize,
    search: key('q') ?? undefined,
    order: SEED_USERS_ORDERS.includes(ord as SeedUsersOrder) ? (ord as SeedUsersOrder) : undefined,
    state: SEED_USERS_STATES.includes(state as SeedUsersState) ? (state as SeedUsersState) : undefined,
    createdFrom: dateMs(key('cfrom')),
    createdTo: dateMs(key('cto')),
    deletedFrom: dateMs(key('dfrom')),
    deletedTo: dateMs(key('dto')),
    nickname: key('nick') === '1' || key('nick') === 'on',
    ids,
  })

  const initialUsers: SeedUsersRouteData = {
    snapshot: r.ok ? seedUsersSnapshot(r.value, ids.join(',') || undefined) : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeNickname: r.ok ? r.value.canSeeNickname : false,
  }

  return {
    mode,
    picked: mode === 'single' ? picked.slice(0, 1) : picked,
    fromHref,
    targetParam,
    initialUsers,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
  }
}
