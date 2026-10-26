import type { AuthErrorCode } from './error.js'

/**
 * Типы модуля пользователя. Ядро (`auth.ts`) не знает ни Request/Response,
 * ни SvelteKit: голые данные на входе, голый факт на выходе — перевод в HTTP
 * делает gateway, в ошибки формы — инструкции (`error.ts`).
 */

/**
 * Содержимое временного токена — запечатанная строка (iron-webcrypto), которую
 * юзер носит сам. Короткая; сервер НИЧЕГО о ней не хранит.
 */
export type AccessTokenPayload = {
  /** Дискриминант: временный токен. */
  k: 'access'
  /** Чей токен — id строки auth. */
  sub: string
  /** Девайс-токен (jti строки сессии) — по нему guard узнаёт сессию. */
  dt: string
  /** Витрина профиля из последнего продления/сохранения. */
  prof: { nickname: string | null; avatarUrl: string | null }
  iat: number
  exp: number
}

/** Токен продления: строка сессии и её версия ротации. */
export type RenewalPayload = {
  /** Дискриминант: токен продления. */
  k: 'renewal'
  jti: string
  version: number
}

/** Сведения о подсети в истории сессии (полный IP и маска не хранятся). */
export type SubnetEntry = { hash: string; country: string | null; at: number }

/**
 * Строка сессии = устройство. Единственное хранимое состояние входов;
 * «заблокировать устройство» = софт-удаление (deletedAt), отдельных банов нет.
 */
export type SessionRecord = {
  jti: string
  authId: string
  deviceName: string | null
  /** Хэш текущей подсети (с солью аккаунта) — полный IP не храним. */
  subnetHash: string | null
  country: string | null
  /** Прежние подсети/страны — складируются в режиме 'update' конфига. */
  history: SubnetEntry[]
  createdAt: number
  expiresAt: number
  /**
   * Версия продления: кукa продления несёт версию строки. Совпала — вкладка
   * владелец, ротация (версия +1, новый срок); меньше — «усыновление» (кто-то
   * продлил раньше, вкладка просто берёт свежий доступ). Отзыв — софт-удаление.
   */
  version: number
  /** Софт-удаление = отзыв сессии. */
  deletedAt: number | null
  lastSeenAt: number | null
}

/** Сфера блокировки аккаунта (элемент `blocked` таблицы auth). */
export type Blocked = {
  /** Что закрыто: `auth` — вход целиком; остальное — ограничения (показываем). */
  scope: string
  reason: string
  at: number
  /** До какого времени; нет — бессрочно. */
  until?: number
}

/** Доверенный principal — из содержимого временного токена без похода в БД. */
export type Principal = { id: string }

/** Ответы API — данные без ошибок; ошибки (код+путь) — `error.ts`. */
export type Challenge = { nonce: string; expiresAt: number }

/** Значения токенов: запечатанные строки; в куки их кладёт адаптер (vault). */
export type TokenPair = {
  /** Временный токен (access) — свежий, на `accessTtlSec`. */
  access: string
  /** Токен продления: на входе и при ротации; при «усыновлении» — нет (кука уже свежая). */
  renewal?: string
}

/** Вход/продление: токены + состояние аккаунта для шагов виджета. */
export type LoginOutcome = TokenPair & {
  /** Активные сферы ограничений (не `auth`): виджет показывает после каждого входа. */
  restrictions: Blocked[]
}

/** Профиль: никнейм и адрес аватара, если юзер их внёс; иначе — аноним. */
export type ProfileView = {
  id: string
  authId: string
  nickname: string | null
  avatarUrl: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Данные экрана профиля: ровно то, что отдаёт `load` маршрута `/user/[id]`.
 * Одна форма на два носителя — страницу и модалку `user.profile`: модалка
 * получает тот же объект через `preloadData`, поэтому разойтись формы не могут.
 *
 * `fact` — отказ (нет входа, истёк, бан) доменным кодом, а не брошенной
 * ошибкой: брошенный `error(403)` оставил бы модалку в `status: 'error'`, её
 * компонент не смонтировался бы и экран отказа показать было бы некому.
 * `profile === null` при `fact === null` — строки нет ИЛИ она не видна.
 */
export type ProfileScreenData = {
  /** id аккаунта из адреса. */
  uid: string
  profile: ProfileView | null
  fact: AuthErrorCode | null
  /** Вход включён на сервере (иначе форма скрыта). */
  enabled: boolean
  /** Ограничения экрана: те же, что у формы (`ProfileLimits`). */
  limits: { readonly nicknameForbidden: readonly string[] }
}

/**
 * Строка списка seed-юзеров: проекция строки `user_auth`, которую отдала DB
 * после ACL вызывающего. Технические поля строки (`subnet_salt`, `security`)
 * сюда не входят: список не должен уносить их в браузер, даже если модель их
 * читает. `seed === null` — аккаунт-надгробие (исполнитель стёр креды).
 */
export type SeedUserView = {
  id: string
  seed: string | null
  permissions: readonly string[]
  blocked: Blocked[]
  createdAt: number
  deletedAt: number | null
}

/** Одна порция списка seed-юзеров и её место в выдаче. */
export type SeedUsersPage = {
  items: SeedUserView[]
  total: number
  page: number
  pageSize: number
  /** Вызывающему видны удалённые строки (`readDeleted`): UI решает по этому флагу, а не по именам прав. */
  canSeeDeleted: boolean
}

/** Состояние удалённости в фильтре списка: действующие / все / только удалённые. */
export type SeedUsersState = 'active' | 'all' | 'deleted'

/** Порядок списка: поле и направление (`deleted` — по дате удаления, только с `canSeeDeleted`). */
export type SeedUsersOrder = 'created-desc' | 'created-asc' | 'deleted-desc' | 'deleted-asc' | 'id-asc' | 'id-desc'

/** Статус сессии глазами фаервола (один PK-lookup; эмуляция session-status). */
export type SessionStatus = 'ok' | 'revoked' | 'expired' | 'unknown'
