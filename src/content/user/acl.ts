/**
 * Экраны и правила UI ACL модуля пользователя.
 *
 * Покрывает оба источника срабатывания доступа в приложении:
 *   1. Статус авторизации и аккаунта (`allow: 'guest' | 'user' | readonly string[]`,
 *      выключенный вход `enabled: false`, истёкшая/отозванная сессия, бан `scope: 'auth'`,
 *      ограничения отдельных сфер `restrictions`, ожидание удаления `deleted`);
 *   2. Срабатывание модели БД (`DbFailure` / `KitErrorBody` / `FailureKind` из `#lib/db`:
 *      `forbidden`, `not_found`, `conflict`, `validation`, `cursor`, `transaction`,
 *      `unavailable`, `schema_pending`, `unsupported`, `post_commit`, `database`,
 *      `payload_too_large`).
 */
import type { DbFailure, FailureKind } from '#lib/db/errors.js'
import type { KitErrorBody } from '#lib/db/sveltekit/errors.js'
import type { AuthErrorCode } from './error.js'
import type { Blocked } from './types.js'

/** Требование к субъекту у компонента/вьюхи. */
export type AclAllow = 'guest' | 'user' | readonly string[]

/** Коды срабатывания модели БД (все `FailureKind` + `payload_too_large` из `toKitError`). */
export type AclModelCode = FailureKind | 'payload_too_large'

/** Все возможные коды экранов UI ACL. */
export type AclScreenCode =
  | 'auth_disabled'
  | 'guest_only'
  | 'auth_required'
  | 'session_expired'
  | 'session_revoked'
  | 'role_forbidden'
  | 'account_blocked'
  | 'account_restricted'
  | 'account_deleted'
  | AclModelCode

/** Подсказка целевого действия на экране ACL. */
export type AclActionKind = 'login' | 'restore' | 'back' | 'none'

/** Готовое описание экрана ACL для рендера в `Acl.svelte`. */
export interface AclScreen {
  readonly code: AclScreenCode
  readonly source: 'auth' | 'model'
  readonly tone: 'neutral' | 'warning' | 'destructive'
  readonly title: string
  readonly description: string
  readonly details?: readonly string[]
  readonly untilMs?: number | null
  readonly action: AclActionKind
}

/** Принимаемый вид ошибки модели: `DbFailure`, ответ `toKitError`, либо сам код. */
export type AclModelInput = DbFailure | KitErrorBody | AclModelCode | { readonly code: string; readonly errors?: readonly { message: string }[] } | null | undefined

/** Входные факты для вычисления экрана ACL. */
export interface AclInput {
  /** Кто может видеть содержимое (`'guest'`, `'user'` или список ролей). */
  allow?: AclAllow
  /** Текущий статус авторизации (true — залогинен, false — гость). */
  authorized?: boolean
  /** Роли текущего субъекта (для `allow: readonly string[]`). */
  roles?: readonly string[]
  /** Включена ли подсистема авторизации на сервере (`AUTH_SEAL_SECRET`). */
  enabled?: boolean
  /** Явный доменный код статуса сессии/аккаунта (`AuthErrorCode` или `'restrictions'`). */
  status?: AuthErrorCode | 'restrictions' | null
  /** Данные полного бана аккаунта (`scope: 'auth'`). */
  blocked?: { readonly reason: string; readonly untilMs: number | null } | null
  /** Активные ограничения отдельных действий у авторизованного пользователя. */
  restrictions?: readonly Blocked[] | null
  /** Срабатывание модели БД (`DbFailure` / `KitErrorBody` / `FailureKind`). */
  model?: AclModelInput
}

const MODEL_CODES = new Set<string>([
  'validation',
  'forbidden',
  'not_found',
  'unsupported',
  'conflict',
  'database',
  'unavailable',
  'cursor',
  'transaction',
  'post_commit',
  'schema_pending',
  'payload_too_large',
])

const SCREENS: Record<
  AclScreenCode,
  Omit<AclScreen, 'code' | 'details' | 'untilMs' | 'action'> & { defaultAction: AclActionKind }
> = {
  auth_disabled: {
    source: 'auth',
    tone: 'neutral',
    title: 'Вход выключен',
    description: 'На сервере не настроен секрет сессий — авторизация временно недоступна.',
    defaultAction: 'back',
  },
  guest_only: {
    source: 'auth',
    tone: 'neutral',
    title: 'Раздел только для гостей',
    description: 'Вы уже вошли в аккаунт — эта форма доступна только до авторизации.',
    defaultAction: 'back',
  },
  auth_required: {
    source: 'auth',
    tone: 'neutral',
    title: 'Требуется вход в аккаунт',
    description: 'Этот раздел доступен только авторизованным пользователям.',
    defaultAction: 'login',
  },
  session_expired: {
    source: 'auth',
    tone: 'warning',
    title: 'Сессия завершена',
    description: 'Срок действия сессии истёк. Войдите снова, чтобы продолжить.',
    defaultAction: 'login',
  },
  session_revoked: {
    source: 'auth',
    tone: 'warning',
    title: 'Устройство отключено',
    description: 'Эта сессия была отозвана. Войдите в аккаунт заново.',
    defaultAction: 'login',
  },
  role_forbidden: {
    source: 'auth',
    tone: 'destructive',
    title: 'Недостаточно прав',
    description: 'У вашего аккаунта нет роли, необходимой для доступа к этому разделу.',
    defaultAction: 'back',
  },
  account_blocked: {
    source: 'auth',
    tone: 'destructive',
    title: 'Аккаунт заблокирован',
    description: 'Доступ к аккаунту закрыт.',
    defaultAction: 'none',
  },
  account_restricted: {
    source: 'auth',
    tone: 'warning',
    title: 'Ограничения аккаунта',
    description: 'Для вашего аккаунта временно ограничены отдельные действия.',
    defaultAction: 'none',
  },
  account_deleted: {
    source: 'auth',
    tone: 'warning',
    title: 'Аккаунт ожидает удаления',
    description: 'Работа под выданными правами приостановлена. Отмените удаление при входе, чтобы продолжить.',
    defaultAction: 'restore',
  },
  forbidden: {
    source: 'model',
    tone: 'destructive',
    title: 'Доступ запрещён',
    description: 'Правила модели не разрешают выполнить это действие.',
    defaultAction: 'back',
  },
  not_found: {
    source: 'model',
    tone: 'neutral',
    title: 'Запись не найдена',
    description: 'Объект удалён, не существует или скрыт настройками видимости.',
    defaultAction: 'back',
  },
  conflict: {
    source: 'model',
    tone: 'warning',
    title: 'Конфликт данных',
    description: 'Запись с такими данными уже существует либо связана с другими записями.',
    defaultAction: 'back',
  },
  validation: {
    source: 'model',
    tone: 'warning',
    title: 'Данные отклонены моделью',
    description: 'Переданные параметры не прошли проверку схемы.',
    defaultAction: 'back',
  },
  cursor: {
    source: 'model',
    tone: 'neutral',
    title: 'Закладка списка устарела',
    description: 'Позиция выборки просрочена или повреждена. Откройте список с начала.',
    defaultAction: 'back',
  },
  transaction: {
    source: 'model',
    tone: 'warning',
    title: 'Данные изменились параллельно',
    description: 'Запрос прерван из-за одновременного обновления записи. Повторите действие.',
    defaultAction: 'back',
  },
  unavailable: {
    source: 'model',
    tone: 'warning',
    title: 'База данных временно недоступна',
    description: 'Соединение с хранилищем прервано или перегружено. Попробуйте чуть позже.',
    defaultAction: 'back',
  },
  schema_pending: {
    source: 'model',
    tone: 'destructive',
    title: 'Требуется обновление схемы базы',
    description: 'Структура таблиц отстаёт от моделей приложения — раздел закрыт до применения миграции. Отчёт и кнопка переноса — на странице /schema.',
    defaultAction: 'none',
  },
  unsupported: {
    source: 'model',
    tone: 'neutral',
    title: 'Операция не поддерживается',
    description: 'Выбранное действие недоступно для этой модели или драйвера.',
    defaultAction: 'back',
  },
  post_commit: {
    source: 'model',
    tone: 'warning',
    title: 'Изменения сохранены частично',
    description: 'Данные записаны в базу, но уведомление об обновлении не завершилось. Обновите страницу.',
    defaultAction: 'back',
  },
  database: {
    source: 'model',
    tone: 'destructive',
    title: 'Ошибка базы данных',
    description: 'Не удалось выполнить обращение к хранилищу.',
    defaultAction: 'back',
  },
  payload_too_large: {
    source: 'model',
    tone: 'warning',
    title: 'Слишком большой запрос',
    description: 'Объём переданных данных превышает допустимый предел.',
    defaultAction: 'back',
  },
}

function buildScreen(
  code: AclScreenCode,
  extra?: {
    description?: string
    details?: readonly string[]
    untilMs?: number | null
    action?: AclActionKind
  },
): AclScreen {
  const base = SCREENS[code]
  return {
    code,
    source: base.source,
    tone: base.tone,
    title: base.title,
    description: extra?.description ?? base.description,
    ...(extra?.details?.length ? { details: extra.details } : {}),
    ...(extra?.untilMs !== undefined ? { untilMs: extra.untilMs } : {}),
    action: extra?.action ?? base.defaultAction,
  }
}

function resolveModelScreen(model: AclModelInput, authorized: boolean): AclScreen | null {
  if (!model) return null
  if (typeof model === 'string') {
    const code = MODEL_CODES.has(model) ? (model as AclModelCode) : 'database'
    return buildScreen(code, {
      action: code === 'forbidden' && !authorized ? 'login' : SCREENS[code].defaultAction,
    })
  }
  if ('kind' in model) {
    const kind = MODEL_CODES.has(model.kind) ? (model.kind as AclModelCode) : 'database'
    const details = model.details.errors?.map((e) => e.message)
    return buildScreen(kind, {
      details,
      action: kind === 'forbidden' && !authorized ? 'login' : SCREENS[kind].defaultAction,
    })
  }
  const code = MODEL_CODES.has(model.code) ? (model.code as AclModelCode) : 'database'
  const details = model.errors?.map((e) => e.message)
  return buildScreen(code, {
    details,
    action: code === 'forbidden' && !authorized ? 'login' : SCREENS[code].defaultAction,
  })
}

function resolveStatusCode(status: AuthErrorCode | 'restrictions'): AclScreenCode | null {
  switch (status) {
    case 'auth.disabled':
      return 'auth_disabled'
    case 'auth.blocked':
      return 'account_blocked'
    case 'restrictions':
      return 'account_restricted'
    case 'auth.deleted':
    case 'auth.delete-pending':
      return 'account_deleted'
    case 'auth.revoked':
      return 'session_revoked'
    case 'auth.expired':
    case 'auth.token':
    case 'auth.kid-unknown':
    case 'auth.session-unknown':
      return 'session_expired'
    default:
      return null
  }
}

/**
 * Вычисляет экран отказа/статуса ACL.
 * Возвращает `null`, если все проверки пройдены и нужно рендерить содержимое.
 */
export function resolveAcl(input: AclInput): AclScreen | null {
  const authorized = Boolean(input.authorized)

  // 1. Выключенная подсистема авторизации на сервере (конвенция хода 256).
  if (input.enabled === false || input.status === 'auth.disabled') {
    return buildScreen('auth_disabled')
  }

  // 2. Проверка субъекта (`allow`: 'guest' | 'user' | роли) ПЕРЕД доменным экраном:
  //    например, экран бана (`allow="guest"`) не должен открываться у юзера, а экран
  //    ограничений (`allow="user"`) не должен открываться у гостя.
  if (input.allow === 'guest' && authorized) {
    return buildScreen('guest_only')
  }
  if (input.allow === 'user' && !authorized) {
    if (input.status) {
      const statusScreen = resolveStatusCode(input.status)
      if (statusScreen) return buildScreen(statusScreen)
    }
    return buildScreen('auth_required')
  }
  if (Array.isArray(input.allow)) {
    if (!authorized) return buildScreen('auth_required')
    const userRoles = input.roles ?? []
    if (!input.allow.some((role) => userRoles.includes(role))) {
      return buildScreen('role_forbidden')
    }
  }

  // 3. Явные доменные состояния аккаунта (бан, частичные ограничения, удаление, отзыв сессии).
  if (input.blocked) {
    return buildScreen('account_blocked', {
      description: input.blocked.reason,
      untilMs: input.blocked.untilMs,
    })
  }
  if (input.restrictions && input.restrictions.length > 0) {
    return buildScreen('account_restricted', {
      details: input.restrictions.map((r) =>
        r.until ? `${r.reason} — до ${new Date(r.until).toLocaleString()}` : r.reason,
      ),
    })
  }
  if (input.status) {
    const mapped = resolveStatusCode(input.status)
    if (mapped) return buildScreen(mapped)
  }

  // 4. Срабатывание модели БД (`DbFailure` / `KitErrorBody` / `FailureKind`).
  const modelScreen = resolveModelScreen(input.model, authorized)
  if (modelScreen) return modelScreen

  return null
}
