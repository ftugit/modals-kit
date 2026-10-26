/**
 * Список seed-юзеров — чтение таблицы `user_auth` порциями для экрана списка.
 * Отдельно от `auth.ts` (вход/сессии) и `profile.ts` (профиль человека): это
 * служебный экран аккаунтов, а не часть потока входа.
 *
 * Право на список — `admin` или `account.read`. Проверка двойная, как у выдачи
 * прав (`admin.ts`): здесь — доменный отказ `auth.forbidden` (экран покажет
 * человеку «нет прав», а не пустой список), в модели — `policy.select`, которая
 * без права отдала бы вызывающему только его собственную строку. Чтение идёт от
 * `principalOfRow` вызывающего: «только данные после ACL» — свойство этого
 * вызова, а не надежда на адаптер.
 */
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { ADMIN_ROLE } from './permissions.js'
import type { AuthPorts, SeedAccountRow } from './ports.js'
import type { SeedUserView, SeedUsersPage } from './types.js'

/** Потолок порции: экран догружает понемногу, выгрузка таблицы целиком не нужна. */
export const SEED_USERS_MAX_PAGE_SIZE = 50

const viewOf = (r: SeedAccountRow): SeedUserView => ({
  id: r.id,
  seed: r.seed,
  permissions: [...r.permissions],
  blocked: r.blocked,
  createdAt: r.createdAt,
  deletedAt: r.deletedAt,
})

/**
 * Порция списка аккаунтов: страница (с 1), размер и полное число строк.
 * Порядок выдачи — порядок модели (`created_at desc`), домен его не навязывает.
 */
export async function listSeedUsers(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { page?: number; pageSize?: number } = {},
): Promise<UserResult<SeedUsersPage>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  if (!g.perms.includes(ADMIN_ROLE) && !g.perms.includes('account.read'))
    return fail({ code: 'auth.forbidden' })

  const page = Math.max(1, Math.trunc(args.page ?? 1) || 1)
  const pageSize = Math.min(
    SEED_USERS_MAX_PAGE_SIZE,
    Math.max(1, Math.trunc(args.pageSize ?? 10) || 10),
  )

  const { rows, total } = await ports.auths.listPage(
    principalOfRow({ id: g.sub, permissions: g.perms }),
    { page, pageSize },
  )
  return ok({ items: rows.map(viewOf), total, page, pageSize })
}
