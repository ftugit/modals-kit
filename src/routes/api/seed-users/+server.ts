/**
 * GET /api/seed-users?page=2&size=10 — догрузка порций списка seed-юзеров.
 *
 * Тонкий HTTP-слой над тем же доменным вызовом, что кормит `load` роута
 * `/users` (`auth(event).listSeedUsers`): страница, модалка и догрузка не могут
 * разойтись по правам или форме ответа. Отказ приходит кодом домена и HTTP-
 * статусом (`toHttpStatus`), а не пустым списком: пагинатор читает пустой
 * список как «данных нет», и это другое состояние.
 */
import type { RequestHandler } from './$types'
import { auth, toHttpStatus } from '#content/user/gateway.server.js'
import { AUTH_MESSAGES } from '#content/user/messages.js'
import { SEED_USERS_PAGE_SIZE } from '#content/user/ui/seed-users/source.js'

const num = (raw: string | null, fallback: number, min: number, max: number): number => {
  if (raw === null || raw === '') return fallback
  const v = Number(raw)
  return Number.isFinite(v) ? Math.min(max, Math.max(min, Math.trunc(v))) : fallback
}

const HEADERS = { 'cache-control': 'private, no-store' } as const

export const GET: RequestHandler = async (event) => {
  const u = auth(event)
  if (!u.enabled) {
    return Response.json(
      { error: AUTH_MESSAGES['auth.disabled'] ?? 'Вход временно отключён', code: 'auth.disabled', status: 503 },
      { status: 503, headers: HEADERS },
    )
  }
  const r = await u.listSeedUsers({
    page: num(event.url.searchParams.get('page'), 1, 1, 10_000),
    pageSize: num(event.url.searchParams.get('size'), SEED_USERS_PAGE_SIZE, 1, 50),
  })
  if (!r.ok) {
    const status = toHttpStatus(r)
    return Response.json(
      { error: AUTH_MESSAGES[r.fact.code] ?? 'Не удалось загрузить список', code: r.fact.code, status },
      { status, headers: HEADERS },
    )
  }
  return Response.json(r.value, { headers: HEADERS })
}
