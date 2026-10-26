// Список seed-юзеров по адресу (`/users`). Данные и отказ — ОДНА функция
// `load` для двух носителей: страницы и модалки `user.list` (модалка берёт их
// через `preloadData` по `route`, своего `loader` у неё нет).
//
// Отказ приходит ДАННЫМИ, а не броском (как у профиля `/user/[id]`): брошенный
// `error(403)` оставил бы модалку в состоянии `status: 'error'`, её компонент
// не смонтировался бы и экран `Acl` о правах показать было бы некому.
//
// Здесь `load` приносит только первую порцию — снапшот пагинатора. Ключи адреса
// (`?users`, `?users.size`) принадлежат адаптеру пагинатора; `load` читает их
// теми же именами и умолчаниями, что объявила регистрация (`source.ts`), —
// второго разбора адреса у экрана нет. Поиск и фильтры этапа 1 — те же ключи
// (`?users.q`, `?users.ord`, `?users.state`, `?users.cfrom/cto/dfrom/dto`):
// SSR, модалка и догрузка обязаны видеть один срез, поэтому разбирает их
// только здесь, валидацию значений делает домен.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import type { SeedUsersOrder, SeedUsersState } from '#content/user/index.js'
import {
  SEED_USERS_ORDERS,
  SEED_USERS_PAGE_PARAM,
  SEED_USERS_PAGE_SIZE,
  SEED_USERS_STATES,
  seedUsersSnapshot,
  type SeedUsersScreenData,
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

const ORDERS = SEED_USERS_ORDERS
const STATES = SEED_USERS_STATES

export const load: PageServerLoad = async (event): Promise<SeedUsersScreenData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const key = (k: string) => sp.get(`${SEED_USERS_PAGE_PARAM}.${k}`)

  const page = num(sp.get(SEED_USERS_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = num(key('size'), SEED_USERS_PAGE_SIZE, 1, 50)
  const ord = key('ord')
  const state = key('state')

  const u = auth(event)
  const r = await u.listSeedUsers({
    page,
    pageSize,
    search: key('q') ?? undefined,
    order: ORDERS.includes(ord as SeedUsersOrder) ? (ord as SeedUsersOrder) : undefined,
    state: STATES.includes(state as SeedUsersState) ? (state as SeedUsersState) : undefined,
    createdFrom: dateMs(key('cfrom')),
    createdTo: dateMs(key('cto')),
    deletedFrom: dateMs(key('dfrom')),
    deletedTo: dateMs(key('dto')),
  })

  return {
    snapshot: r.ok ? seedUsersSnapshot(r.value) : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
  }
}
