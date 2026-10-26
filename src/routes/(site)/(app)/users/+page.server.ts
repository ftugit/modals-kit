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
// второго разбора адреса у экрана нет.
import type { PageServerLoad } from './$types'
import { auth } from '#content/user/gateway.server.js'
import {
  SEED_USERS_PAGE_PARAM,
  SEED_USERS_PAGE_SIZE,
  seedUsersSnapshot,
  type SeedUsersScreenData,
} from '#content/user/ui/seed-users/source.js'

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

export const load: PageServerLoad = async (event): Promise<SeedUsersScreenData> => {
  // Данные приватные: у `load` нет ни одного заголовка по умолчанию.
  event.setHeaders({ 'cache-control': 'private, no-store' })

  const page = num(event.url.searchParams.get(SEED_USERS_PAGE_PARAM), 1, 1, 10_000)
  const pageSize = num(event.url.searchParams.get(`${SEED_USERS_PAGE_PARAM}.size`), SEED_USERS_PAGE_SIZE, 1, 50)

  const u = auth(event)
  const r = await u.listSeedUsers({ page, pageSize })

  return {
    snapshot: r.ok ? seedUsersSnapshot(r.value) : null,
    fact: r.ok ? null : r.fact.code,
    enabled: u.enabled,
  }
}
