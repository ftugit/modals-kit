/**
 * Выдача прав аккаунту — единственная операция, которая пишет
 * `user_auth.permissions`.
 *
 * Правило: пользоваться может только администратор (`admin` в собственных
 * правах). Проверка двойная — здесь (доменный отказ `auth.forbidden`, чтобы
 * пользователь увидел внятное «нужны права администратора») и в модели
 * (маска поля `update: ['admin']`, которая сработает, даже если кто-то
 * вызовет адаптер в обход этой функции).
 *
 * Чего функция не делает: не выдаёт права самому себе. Иначе один неверный
 * вызов оставляет систему без администратора навсегда — вернуть права будет
 * некому. Снять их с себя можно только чужими руками.
 */
import { fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { ADMIN_ROLE, isPermission } from './permissions.js'
import type { AuthPorts } from './ports.js'

/** Что вернулось: чьи права и какими они стали. */
export interface PermissionsView {
  readonly id: string
  readonly permissions: readonly string[]
}

/**
 * Новый список прав целиком (не «добавить/убрать»): порядок и повтор не важны,
 * неизвестные строки отбрасываются с отказом, а не молча.
 */
export async function setPermissions(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { targetId: string; permissions: readonly string[] },
): Promise<UserResult<PermissionsView>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)

  // Право выдавать права — только у администратора.
  if (!g.perms.includes(ADMIN_ROLE)) return fail({ code: 'auth.forbidden' })

  const targetId = String(args.targetId ?? '').trim()
  if (!targetId) return fail({ code: 'auth.identity-unknown' })
  if (targetId === g.sub) return fail({ code: 'permissions.self' })

  const list = [...new Set((args.permissions ?? []).map((p) => String(p).trim()))].filter(Boolean)
  const unknown = list.find((p) => p !== ADMIN_ROLE && !isPermission(p))
  if (unknown !== undefined) return fail({ code: 'permissions.unknown', args: { value: unknown } })

  const target = await ports.auths.get(targetId)
  if (!target) return fail({ code: 'auth.identity-unknown' })

  // Запись — от имени администратора: маска поля проверяет роль ещё раз.
  await ports.auths.setPermissions(principalOfRow({ id: g.sub, permissions: g.perms }), targetId, list)

  return ok({ id: targetId, permissions: list })
}
