/**
 * Профильный api модуля user: публичные данные аккаунта (никнейм, адрес
 * аватара). Отдельно от `auth.ts` — у auth профильных функций нет (чек-лист
 * §6: «откуда у auth profile?»); права здесь те же — сессия (`guard`).
 */
import { checkGrants, forOwner, grants } from '#lib/db/index.js'
import { SERVER, blocksOf, fail, guard, ok, principalOfRow, type UserResult } from './auth.js'
import { getEffective, setUserKey } from './config-api.js'
import { auth as authResource, block as blockResource, profile as profileResource } from './schema.js'
import { VISIBILITY_KEY } from './spec-config.js'
import { activeBlock, longestFullBlock } from './spec-block.js'
import type { AuthPorts } from './ports.js'
import type { ProfileRead, ProfileView, PublicProfileView, VisibilityLevel } from './types.js'

const gProfile = grants(profileResource)
const gBlock = grants(blockResource)
const gAuth = grants(authResource)

/** Ключ конфига приватности профиля (этап 8): переопределение за юзером поверх глобального. */

const VISIBILITY_LEVELS: readonly string[] = ['all', 'users', 'nobody']

/** Эффективный уровень цели строкой уровня; чужое значение конфига — как `nobody`. */
async function visibilityOf(ports: AuthPorts, target: string): Promise<VisibilityLevel> {
  const v = await getEffective(ports, target, VISIBILITY_KEY)
  return v === 'all' || v === 'users' ? v : 'nobody'
}

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
  // `subject` — чужой профиль: видимость решает модель (`defineAcl`), а не эта функция
  const target = subject?.trim() || g.sub
  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  const scoped = checkGrants(
    actor,
    {
      canReadProfile: forOwner(target, gProfile.select),
      canEdit: forOwner(target, gProfile.update),
      canDeleteProfileRole: forOwner(target, gProfile.delete),
      // `user.auth` пока не переведена на `defineAcl` (решение №3): домен учитывает `account.edit` поверх `gAuth.delete`.
      canDeleteSeedRole: forOwner(target, gAuth.delete),
      canKnowReason: forOwner(target, gAuth.select),
      // Глобальный круг чтения/записи блокировок (без `owner` цели — чтобы раздел в профиле открывался модерации/чтению).
      canReadBlocks: gBlock.select,
      canBlock: gBlock.insert,
    },
  )
  // Возможности удаления по цели (этап 6): право И нет активного запрета
  // из каталога сфер на самой цели — запрет сильнее владельца и админа.
  const now = ports.clock.now()
  const blocked = await blocksOf(ports, target)
  const canDeleteProfile =
    scoped.canDeleteProfileRole && !activeBlock(blocked, 'profile.delete', now)
  const canDeleteSeed =
    (scoped.canDeleteSeedRole || g.perms.includes('account.edit')) &&
    !activeBlock(blocked, 'account.delete', now)
  // Полная блокировка цели — факт для показа в профиле; причину и срок
  // знают владелец, `admin` и читающие аккаунты, остальные — только факт.
  const full = longestFullBlock(blocked, now)
  const canKnowReason = scoped.canKnowReason
  const fullBlock = full
    ? {
        reason: canKnowReason ? full.reason : null,
        until: canKnowReason ? (full.until ?? null) : null,
      }
    : null
  // Кнопка «Блокировки» в профиле: пагинированный список подгружается по требованию
  // в `user.blocks` (`/user/[id]/blocks`), без лишнего запроса при каждом чтении профиля.
  const caps = {
    canEdit: scoped.canEdit,
    canDeleteProfile,
    canDeleteSeed,
    fullBlock,
    blocks: [],
    canReadBlocks: scoped.canReadBlocks,
    canBlock: scoped.canBlock,
    isOwn: target === g.sub,
    visibility: await visibilityOf(ports, target),
  }
  const row = await ports.profiles.get(principalOfRow({ id: g.sub, permissions: g.perms }), target)
  if (row) return ok({ profile: row, notCreated: false, ...caps })
  return ok({ profile: null, notCreated: scoped.canReadProfile, ...caps })
}

/**
 * Публичный показ профиля (этап 8): гостю и чужому — только проекция
 * (`nickname`, `avatarUrl`, `createdAt`), если уровень видимости цели
 * разрешает. Вошедший определяется токеном; битый/истёкший токен здесь —
 * гость. Неразличимость сохранена: `nobody`, нет строки и «нельзя» —
 * один факт `auth.identity-unknown`. Видимость строки на уровне модели
 * держит `exists`-ветка политики профиля; домен сверяет уровень ещё раз
 * и режет поля.
 */
export async function publicProfile(
  ports: AuthPorts,
  viewerToken: string | undefined,
  subjectId: string,
): Promise<UserResult<PublicProfileView>> {
  const level = await visibilityOf(ports, subjectId)
  if (level === 'nobody') return fail({ code: 'auth.identity-unknown' })
  const viewer = viewerToken ? await guard(ports, viewerToken) : null
  const logged = viewer !== null && !('code' in viewer) ? viewer : null
  if (level === 'users' && !logged) return fail({ code: 'auth.identity-unknown' })
  const ctx = logged
    ? principalOfRow({ id: logged.sub, permissions: logged.perms })
    : { principal: { roles: [] as string[] } }
  const row = await ports.profiles.get(ctx, subjectId)
  if (!row) return fail({ code: 'auth.identity-unknown' })
  return ok({ nickname: row.nickname, avatarUrl: row.avatarUrl, createdAt: row.createdAt })
}

/**
 * Сменить видимость СВОЕГО профиля: запись — конфиг-API (`setUserKey`),
 * значение = умолчание строку не плодит. Уровень не из каталога уровней —
 * `permissions.unknown` (прецедент «значение не из каталога»).
 */
export async function setVisibility(
  ports: AuthPorts,
  accessToken: string | undefined,
  level: string,
): Promise<UserResult<{ stored: boolean }>> {
  if (!VISIBILITY_LEVELS.includes(level)) return fail({ code: 'permissions.unknown' })
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  return setUserKey(ports, accessToken, g.sub, VISIBILITY_KEY, level)
}

/**
 * Удаление профиля цели, по желанию — вместе с seed-аккаунтом. Права те
 * же, что чтение отдаёт флагами (этап 6), и здесь перепроверяются:
 * удаление профиля — владелец/`profile.edit`/`admin`, seed —
 * владелец/`account.edit`/`admin`; активный запрет сферы на цели
 * (`profile.delete`/`account.delete`) сильнее любого права, включая
 * владельца. Профиль уходит сразу (политика `delete` модели решает за
 * вызывающего); seed — заявкой, как собственное удаление: метка и отзыв
 * сессий, физическую зачистку доделает исполнитель по грейсу.
 */
export async function deleteProfile(
  ports: AuthPorts,
  accessToken: string | undefined,
  subject: string | undefined,
  opts: { withSeed?: boolean } = {},
): Promise<UserResult<null>> {
  const g = await guard(ports, accessToken)
  if ('code' in g) return fail(g)
  const target = subject?.trim() || g.sub
  const now = ports.clock.now()
  const authRow = await ports.auths.get(target)
  if (!authRow) return fail({ code: 'auth.forbidden' })
  const blocked = await blocksOf(ports, target)
  const actor = principalOfRow({ id: g.sub, permissions: g.perms }).principal
  if (!checkGrants(actor, gProfile.delete, { ownerId: target })) {
    return fail({ code: 'auth.forbidden' })
  }
  if (activeBlock(blocked, 'profile.delete', now))
    return fail({ code: 'profile.delete-blocked' })
  if (opts.withSeed) {
    const canSeed =
      checkGrants(actor, gAuth.delete, { ownerId: target }) || g.perms.includes('account.edit')
    if (!canSeed) return fail({ code: 'auth.forbidden' })
    if (activeBlock(blocked, 'account.delete', now))
      return fail({ code: 'account.delete-blocked' })
  }
  await ports.profiles.remove(principalOfRow({ id: g.sub, permissions: g.perms }), target)
  if (opts.withSeed) {
    await ports.auths.markDeleted(target, now)
    await ports.sessions.softDeleteAllByAuth(target, now)
  }
  return ok(null)
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
