// Страница выбора пользователей (`/users/pick`) — fallback модалки `user.picker`
// для no-JS и прямых переходов. Принимает `from` (куда вернуться), `param`
// (какой query-параметр в `from` заполнить выбранными UUID), `mode`
// (`single` | `multiple`) и `picked` (стартовый набор UUID).
import type { PageServerLoad } from './$types'
import { localPath } from '#lib/address/index.js'
import { auth } from '#content/user/gateway.server.js'
import { parsePickedIds, parsePickerStep } from '#content/user/ui/user-picker-query.js'
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
  // Тот же разбор, что у компонента: предел и форма id общие.
  const rawPicked = parsePickedIds(sp.get('picked'))
  const picked = mode === 'single' ? rawPicked.slice(0, 1) : rawPicked
  const step = parsePickerStep(sp.get('upicks'))

  const key = (k: string) => sp.get(`${SEED_USERS_PAGE_PARAM}.${k}`)
  const requestedPage = num(sp.get(SEED_USERS_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = num(key('size'), SEED_USERS_PAGE_SIZE, 30, 100)
  const q = key('q')
  const ordRaw = key('ord')
  const stateRaw = key('state')
  const order = SEED_USERS_ORDERS.includes(ordRaw as SeedUsersOrder)
    ? (ordRaw as SeedUsersOrder)
    : undefined
  const state = SEED_USERS_STATES.includes(stateRaw as SeedUsersState)
    ? (stateRaw as SeedUsersState)
    : undefined
  const cfrom = key('cfrom')
  const cto = key('cto')
  const dfrom = key('dfrom')
  const dto = key('dto')
  const createdFrom = dateMs(cfrom)
  const createdTo = dateMs(cto)
  const deletedFrom = dateMs(dfrom)
  const deletedTo = dateMs(dto)
  const nickname = key('nick') === '1' || key('nick') === 'on'

  const u = auth(event)

  // На шаге `chosen` показываются ТОЛЬКО выбранные UUID (`picked`). Если ничего
  // не выбрано — проверяем право одним лёгким запросом и отдаём пустой срез.
  if (step === 'chosen' && picked.length === 0) {
    const probe = await u.listSeedUsers({ page: 1, pageSize: 1 })
    const initialUsers: SeedUsersRouteData = {
      snapshot: probe.ok
        ? seedUsersSnapshot(
            {
              items: [],
              total: 0,
              page: 1,
              pageSize,
              canSeeDeleted: probe.value.canSeeDeleted,
              canSeeNickname: probe.value.canSeeNickname,
              canReadSessions: probe.value.canReadSessions,
            },
            {
              q: q || null,
              ord: order ?? null,
              state: state ?? null,
              cfrom: createdFrom !== null ? cfrom : null,
              cto: createdTo !== null ? cto : null,
              dfrom: deletedFrom !== null && probe.value.canSeeDeleted ? dfrom : null,
              dto: deletedTo !== null && probe.value.canSeeDeleted ? dto : null,
              nick: nickname && probe.value.canSeeNickname,
            },
          )
        : null,
      fact: probe.ok ? null : probe.fact.code,
      enabled: u.enabled,
      canSeeDeleted: probe.ok ? probe.value.canSeeDeleted : false,
      canSeeNickname: probe.ok ? probe.value.canSeeNickname : false,
      canReadSessions: probe.ok ? probe.value.canReadSessions : false,
    }
    return {
      mode,
      picked,
      fromHref,
      targetParam,
      initialUsers,
      fact: probe.ok ? null : probe.fact.code,
      enabled: u.enabled,
    }
  }

  const ids = step === 'chosen' ? picked : []
  let r = await u.listSeedUsers({
    page: requestedPage,
    pageSize,
    search: q ?? undefined,
    order,
    state,
    createdFrom,
    createdTo,
    deletedFrom,
    deletedTo,
    nickname,
    ids,
  })
  // Если без JS переключились в `chosen` с 2+ страницы общего списка, а выбранных
  // меньше одной порции — откатываем страницу к последней доступной.
  if (r.ok && step === 'chosen' && r.value.items.length === 0 && r.value.total > 0 && requestedPage > 1) {
    const clampedPage = Math.max(1, Math.ceil(r.value.total / pageSize))
    r = await u.listSeedUsers({
      page: clampedPage,
      pageSize,
      search: q ?? undefined,
      order,
      state,
      createdFrom,
      createdTo,
      deletedFrom,
      deletedTo,
      nickname,
      ids,
    })
  }

  const initialUsers: SeedUsersRouteData = {
    snapshot: r.ok
      ? seedUsersSnapshot(r.value, {
          q: q || null,
          ord: order ?? null,
          state: state ?? null,
          cfrom: createdFrom !== null ? cfrom : null,
          cto: createdTo !== null ? cto : null,
          dfrom: deletedFrom !== null && r.value.canSeeDeleted ? dfrom : null,
          dto: deletedTo !== null && r.value.canSeeDeleted ? dto : null,
          nick: nickname && r.value.canSeeNickname,
          ids: ids.join(',') || null,
        })
      : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeNickname: r.ok ? r.value.canSeeNickname : false,
    canReadSessions: r.ok ? r.value.canReadSessions : false,
  }

  return {
    mode,
    picked,
    fromHref,
    targetParam,
    initialUsers,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
  }
}
