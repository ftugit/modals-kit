// Список seed-юзеров по адресу (`/users`). Данные и отказ — ОДНА функция
// `load` для всех носителей: страница отдаёт результат компоненту списка
// пропсом, остальные носители (модалка, шаг админки) ничего не приносят —
// компонент при показе сам зовёт `preloadData` этого же роута. Одна точка
// доступа к данным на все формы показа.
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

const ORDERS = SEED_USERS_ORDERS
const STATES = SEED_USERS_STATES

export const load: PageServerLoad = async (event): Promise<SeedUsersRouteData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const sp = event.url.searchParams
  const key = (k: string) => sp.get(`${SEED_USERS_PAGE_PARAM}.${k}`)

  const page = num(sp.get(SEED_USERS_PAGE_PARAM), 1, 1, 10_000)
  // Размер порции из адреса: пользовательский диапазон 30..100.
  const pageSize = num(key('size'), SEED_USERS_PAGE_SIZE, 30, 100)
  const q = key('q')
  const ordRaw = key('ord')
  const stateRaw = key('state')
  const order = ORDERS.includes(ordRaw as SeedUsersOrder) ? (ordRaw as SeedUsersOrder) : undefined
  const state = STATES.includes(stateRaw as SeedUsersState) ? (stateRaw as SeedUsersState) : undefined
  const cfrom = key('cfrom')
  const cto = key('cto')
  const dfrom = key('dfrom')
  const dto = key('dto')
  const createdFrom = dateMs(cfrom)
  const createdTo = dateMs(cto)
  const deletedFrom = dateMs(dfrom)
  const deletedTo = dateMs(dto)
  const nickname = key('nick') === '1' || key('nick') === 'on'
  const idsList = (key('ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 500)

  const u = auth(event)
  const r = await u.listSeedUsers({
    page,
    pageSize,
    search: q ?? undefined,
    order,
    state,
    createdFrom,
    createdTo,
    deletedFrom,
    deletedTo,
    // Параметр никнейма (этап 2): действует только с правом на профили —
    // гейтит домен, роут лишь пропускает адресное значение. '1' пишет
    // модальный путь пагинатора, 'on' — нативный чекбокс no-JS формы.
    nickname,
    // Ограничение по списку id (`users.ids`): шаг подтверждения выбора
    // показывает тем же списком только выбранных юзеров.
    ids: idsList,
  })

  return {
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
          ids: idsList.join(',') || null,
        })
      : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
    canSeeDeleted: r.ok ? r.value.canSeeDeleted : false,
    canSeeNickname: r.ok ? r.value.canSeeNickname : false,
  }
}
