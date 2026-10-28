/**
 * Профильный api модуля user: публичные данные аккаунта (никнейм, адрес
 * аватара). Отдельно от `auth.ts` — у auth профильных функций нет (чек-лист
 * §6: «откуда у auth profile?»); права здесь те же — сессия (`guard`).
 */
import { SERVER, fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { ADMIN_ROLE } from './permissions.js'
import { activeBlock, longestFullBlock } from './spec-block.js'
import type { AuthPorts } from './ports.js'
import type { ProfileRead, ProfileView } from './types.js'

/**
 * Права чтения профиля — тот же список, что политика модели
 * (`ownerOrRoles('auth_id', …)` в `schema.ts`) и флаг `canSeeNickname`
 * списка. Домен сверяется с ним, чтобы различить «профиля нет» и «нельзя»:
 * сама модель этих случаев не различает.
 */
const PROFILE_READ_ROLES = ['admin', 'profile.read', 'profile.edit'] as const

/**
 * Профиль для чтения: есть строка — её значения. Строки нет: владелец и
 * держатели прав чтения получают `notCreated` (экран-заглушка «профиль не
 * создан»), остальные — `profile: null` без флага (экран отказа: снаружи
 * «нет строки» и «не видна» по-прежнему неразличимы).
 */
export async function profile(
  ports: AuthPorts,
  accessToken: string | undefined,
  subject?: string,
): Promise<UserResult<ProfileRead>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  // `subject` — чужой профиль: видимость решает модель (`ownerOrRoles`), а не эта функция
  const target = subject?.trim() || g.sub
  // Правка: владелец или `profile.edit`/`admin` (та же пара, что политика
  // `update` модели). Флаг нужен показу (кнопка) и гейтам редактирования.
  const canEdit =
    target === g.sub || g.perms.includes(ADMIN_ROLE) || g.perms.includes('profile.edit')
  // Возможности удаления по цели (этап 6): право И нет активного запрета
  // из каталога сфер на самой цели — запрет сильнее владельца и админа.
  const now = ports.clock.now()
  const authRow = await ports.auths.get(target)
  const blocked = authRow?.blocked ?? []
  const canDeleteProfile =
    (target === g.sub || g.perms.includes(ADMIN_ROLE) || g.perms.includes('profile.edit')) &&
    !activeBlock(blocked, 'profile.delete', now)
  const canDeleteSeed =
    (target === g.sub || g.perms.includes(ADMIN_ROLE) || g.perms.includes('account.edit')) &&
    !activeBlock(blocked, 'account.delete', now)
  // Полная блокировка цели — факт для показа в профиле; причину и срок
  // знают владелец, `admin` и читающие аккаунты, остальные — только факт.
  const full = longestFullBlock(blocked, now)
  const canKnowReason =
    target === g.sub || g.perms.includes(ADMIN_ROLE) || g.perms.includes('account.read')
  const fullBlock = full
    ? {
        reason: canKnowReason ? full.reason : null,
        until: canKnowReason ? (full.until ?? null) : null,
      }
    : null
  const caps = { canEdit, canDeleteProfile, canDeleteSeed, fullBlock }
  const row = await ports.profiles.get(principalOfRow({ id: g.sub, permissions: g.perms }), target)
  if (row) return ok({ profile: row, notCreated: false, ...caps })
  const canRead =
    target === g.sub || PROFILE_READ_ROLES.some((role) => g.perms.includes(role))
  return ok({ profile: null, notCreated: canRead, ...caps })
}

/**
 * Сохранить профиль. ПЕРВОЕ заполнение создаёт строку. Никнейм проверяется на
 * запрещённые (`config.nicknameForbidden`). Картинку домен не разбирает: её
 * проверяет и приводит роут по параметрам спеки (`specAvatar`) ДО вызова, и
 * сюда приходит готовый `avatarUrl`. Правила длины/вида значений — на записи
 * проверит схема (`lib/db`), здесь — доменные запреты.
 */
export async function updateProfile(
  ports: AuthPorts,
  accessToken: string | undefined,
  args: { nickname?: string; avatarUrl?: string | null },
  subject?: string,
): Promise<UserResult<ProfileView>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  // Чужой профиль правит тот, у кого есть `profile.edit`/`admin`: решает модель,
  // а не эта функция — для владельца строка своя, для остальных закрыта.
  const target = subject?.trim() || g.sub

  let nickname: string | undefined
  if (args.nickname !== undefined) {
    nickname = args.nickname.trim()
    if (nickname.length < 2 || nickname.length > 32)
      return fail({ code: 'profile.nickname-forbidden' })
    const forbidden = await ports.config.get('nicknameForbidden')
    const lower = nickname.toLowerCase()
    if (forbidden.some((n) => n.toLowerCase() === lower))
      return fail({ code: 'profile.nickname-forbidden' })
  }

  const avatarUrl: string | null | undefined = args.avatarUrl

  // Чтение и правка — от владельца: правила видят его `id` и права.
  const owner = principalOfRow({ id: g.sub, permissions: g.perms })
  const existing = await ports.profiles.get(owner, target)
  if (!existing) {
    // Создание строки — не право человека (`insert: roles(['server'])`):
    // профиль заводит сервер — себе по первому заполнению, другому по поручению.
    await ports.profiles.create(SERVER, target, {
      ...(nickname !== undefined ? { nickname } : {}),
      ...(avatarUrl !== undefined && avatarUrl !== null ? { avatarUrl } : {}),
    })
  } else {
    await ports.profiles.update(owner, target, {
      ...(nickname !== undefined ? { nickname } : {}),
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    })
  }
  const row = await ports.profiles.get(owner, target)
  return ok(row as ProfileView)
}
