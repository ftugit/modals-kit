import type { AuthErrorCode } from './error.js'
import type { PageCaps, SessionSliceCaps } from './caps.js'

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
  /** Выданные аккаунту права на момент выпуска короткого токена. */
  perms?: readonly string[]
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

/**
 * Challenge входа: запечатанный токен вместо серверного nonce. Сервер
 * ничего не хранит (stateless — работает между инстансами): срок жизни
 * несёт само запечатывание (iron ttl), `field` привязывает токен к полю,
 * чья подпись доказывает владение (`seed`), `n` — случайная соль выпуска.
 * Клиент токен видит — это не секрет: подделать или продлить его без
 * серверного ключа нельзя, а подписывает его по-прежнему секрет seed,
 * которого в токене нет.
 */
export type ChallengePayload = {
  /** Дискриминант: challenge входа. */
  k: 'challenge'
  /** Поле, к которому привязан токен (`seed`). */
  field: string
  /** Случайная соль выпуска. */
  n: string
}

/** Сведения о подсети в истории сессии (полный IP и маска не хранятся). */
export type SubnetEntry = { hash: string; country: string | null; at: number }

/**
 * Строка сессии = устройство. Единственное хранимое состояние входов;
 * «заблокировать устройство» = софт-удаление (deletedAt), отдельных банов нет.
 */
export type SessionRecord = {
  /** Первичный ключ строки. Наружу человеку уходит он, не `jti`. */
  id: string
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

/**
 * Схема прав ключа конфига (модель `user.config`): роли каталога
 * `permissions.ts` и специальное `owner` (владелец строки юзера). У строки
 * умолчания схема полная; у строки юзера осмысленны только `editUser` /
 * `deleteUser` (упрощённая схема редактирования именно этой строки).
 */
export interface ConfigKeySchema {
  /** Кто меняет значение и схему умолчания. */
  editDefault?: readonly string[]
  /** Кто создаёт такой ключ за юзером. */
  assign?: readonly string[]
  /** Кто меняет закреплённый за юзером ключ. */
  editUser?: readonly string[]
  /** Кто снимает закреплённый ключ. */
  deleteUser?: readonly string[]
}

/** Строка конфига портом: `authId = null` — умолчание (глобальный ключ). */
export interface ConfigKeyRow {
  id: string
  authId: string | null
  key: string
  /** `null` — значение не задано: действует бутстрап кода потребителя. */
  value: unknown
  schema: ConfigKeySchema | null
}

/** Сфера блокировки аккаунта (запись модели `user.block`, этап 9). */
export type Blocked = {  /** Что закрыто: сферы каталога `spec-block.ts`; `auth` — вход целиком. */
  scope: string
  reason: string
  at: number
  /** До какого времени; нет — бессрочно. Истёкшая остаётся историей. */
  until?: number
  /** id аккаунта, наложившего блокировку (история и аудит). */
  by?: string
}

/**
 * Устройство глазами человека. `jti` и `version` сюда не входят: их читает только сервер.
 * Времена — миллисекунды.
 */
export type SessionDeviceView = {
  readonly id: string
  readonly authId: string
  readonly deviceName: string | null
  readonly subnetHash: string | null
  readonly country: string | null
  readonly history: SubnetEntry[]
  readonly createdAt: number
  readonly expiresAt: number
  readonly lastSeenAt: number | null
  readonly deletedAt: number | null
  /** Это сессия текущего запроса (`actor.sessionId`). */
  readonly current: boolean
}

/**
 * Пустая страна в фильтре: `country IS NULL`. Значение адреса — `none`,
 * кода страны из него не собирается. Константа живёт здесь, а не в
 * `sessions.server.ts`: её читают и клиентские файлы списка.
 */
export const SESSIONS_COUNTRY_NONE = 'none'

/** Состояние списка устройств: живые, истёкшие, все не отозванные, отозванные. */
export type SessionsState = 'active' | 'expired' | 'all' | 'revoked'

/**
 * Носители `/user/sessions` и модалки `user.sessions`.
 *
 * `snapshot` — первая порция в форме окна `#lib/paginate` (список живёт на
 * `Listing`, а не на своём рендере). `countries` — коды стран среза без
 * фильтра страны: из них форма строит пункты выбора.
 */
/**
 * Выход (`/user/logout`). `sessionId` — своя текущая сессия: без неё набор
 * собрать нельзя, поэтому экрану остаётся локальный выход (куки без отзыва).
 * `total` — сколько активных сессий у аккаунта: им решается удержание.
 */
export type LogoutRouteData = {
  enabled: boolean
  sessionId: string | null
  total: number
  /** `true` — актор известен и набор выхода выразим. */
  canRevoke: boolean
}

/** Цель списка сессий: один источник истины, без пары `uid`+`journal`. */
export type SessionsTarget =
  | { kind: 'own' }
  | { kind: 'account'; uid: string }
  | { kind: 'journal' }

/**
 * Объявление списка устройств после действия. `revoke-failed` — отзыв не
 * удался; `bulk-exit-partial` — серверный набор закрыт не целиком: `requested`
 * строк попало в срез до удаления, `revoked` реально погашено (часть закрыли
 * между счётом и отзывом). Расхождение показывается, только когда оно есть.
 */
export type SessionsListNotice =
  | { kind: 'revoke-failed' }
  | { kind: 'bulk-exit-partial'; requested: number; revoked: number }

export type SessionsRouteData = {
  enabled: boolean
  fact: AuthErrorCode | null
  /** Цель среза: свои устройства, аккаунт или общий журнал. */
  target: SessionsTarget
  /** Читает ли зритель чужие устройства — вход в журнал и в чужие карточки. */
  canReadOthers: boolean
  snapshot: import('#lib/paginate/index.js').PaginatorState<SessionDeviceView> | null
  countries: readonly string[]
  notice: SessionsListNotice | null
  // Флаги среза — из той же карты, что производит домен (`capsOf`, P2-3).
} & SessionSliceCaps

/** Порция списка устройств и флаги зрителя на этот срез. */
export type SessionsPage = {
  items: SessionDeviceView[]
  total: number
  page: number
  pageSize: number
  /** Аккаунт среза; `null` — общий журнал. */
  authId: string | null
  journal: boolean
  /** Зритель вправе читать чужие устройства (круг журнала). */
  canReadOthers: boolean
  state: SessionsState
  /** Коды стран среза без фильтра страны (`SESSIONS_COUNTRY_NONE` — без страны). */
  countries: readonly string[]
} & SessionSliceCaps

/** Одна строка устройства и права на неё. */
export type SessionDetail = {
  session: SessionDeviceView
} & Pick<PageCaps<'sessions'>, 'canRename' | 'canRevoke' | 'canHardDelete'>

/** Итог отзыва одной строки. `current` — обработчик должен снять куки. */
export type SessionRevokeResult = {
  id: string
  current: boolean
  hard: boolean
}

/** Поля среза списка: один источник для чтения и для серверного набора отзыва. */
export type SessionsWhereArgs = {
  state?: SessionsState
  /** Коды стран (`SESSIONS_COUNTRY_NONE` — строки без страны). Пусто — фильтра нет. */
  country?: readonly string[]
  /** «Сеть менялась»: в истории строки есть прежние подсети. */
  subnetChanged?: boolean
  createdFrom?: number | null
  createdTo?: number | null
  seenFrom?: number | null
  seenTo?: number | null
}

/**
 * Предел исключений серверного набора: одно объявление на домен и форму.
 * 500 — порядок величины URL-списков, которые режутся `.slice(0, 500)`
 * (`users/+page.server.ts`, `ui/blocks-list/load.server.ts`,
 * `blocks/filters/+page.server.ts`). Пикер режет `parsePickedIds`
 * (`USER_PICKER_IDS_MAX`), а не load `/users/pick`; здесь предел — отказ,
 * не усечение: обрезанный `except` закрыл бы строки, которые просили оставить.
 */
export const SESSIONS_BULK_IDS_LIMIT = 500

/** Итог пакетного отзыва. `current` — среди погашенных была сессия запроса. */
export type SessionBulkRevokeResult = {
  revoked: number
  current: boolean
  /**
   * Сколько строк попало в серверный срез до удаления (`count` по тому же
   * фильтру). Вызывающий сверяет с `revoked`: расхождение значит, что часть
   * строк закрыли между счётом и отзывом.
   */
  requested: number
}

/** Строка блокировки глазами домена и показа (этап 9): времена — миллисекунды. */
export interface BlockView {
  readonly id: string
  readonly authId: string
  readonly scope: string
  readonly reason: string
  readonly at: number
  readonly until: number | null
  readonly by: string | null
  /** Метка мягкого удаления записи (заполнена при чтении с `includeDeleted`). */
  readonly deletedAt?: number | null
}

/** Состояние записей в фильтре списка блокировок. */
export type BlocksState = 'all' | 'active' | 'expired' | 'deleted'

/** Порядок сортировки списка блокировок (`deleted-*` — только с `canSeeDeleted`). */
export type BlocksOrder =
  | 'created-desc'
  | 'created-asc'
  | 'until-asc'
  | 'until-desc'
  | 'scope-asc'
  | 'scope-desc'
  | 'deleted-desc'
  | 'deleted-asc'

/** Одна порция пагинированного списка блокировок и флаги возможностей зрителя. */
export type BlocksPage = {
  items: BlockView[]
  total: number
  page: number
  pageSize: number
  /** Фиксированный id пользователя списка (`null` — глобальный список). */
  uid: string | null
  /** Зрителю доступны удалённые записи (`block.readDeleted` / `admin`). */
  canSeeDeleted: boolean
  /** Зрителю доступны живые записи (`moderator` / `block.read` / `block.edit` / `admin` / владелец). */
  canSeeLive: boolean
  /** Доступен выбор пользователей из списка seed-юзеров (`!uid && (account.read || admin)`). */
  canPickUsers: boolean
  /** Сферы, которые вызывающий может назначать при создании. */
  assignableScopes: readonly string[]
  /** Можно ли показать кнопку «Добавить блокировку». */
  canCreate: boolean
}

/** Детальное чтение одной записи блокировки для экрана редактирования / просмотра / удаления. */
export type BlockDetailView = {
  block: BlockView
  /** Доступна ли отправка формы правок (нет у `block.read`, `block.readDeleted` и у удалённых записей). */
  canSubmit: boolean
  /** Можно ли править причину (`block.edit` / `admin` на живой записи). */
  canEditReason: boolean
  /** Можно ли править срок / снимать (`moderator` / `block.edit` / `admin` на живой записи). */
  canEditUntil: boolean
  /** Положена ли кнопка «Удалить» для этой записи. */
  canDelete: boolean
  /** Положен ли чекбокс полного удаления (`admin` или связка записи + `block.readDeleted`). */
  canHardDelete: boolean
  /** Доступные сферы каталога (для отображения `<select>`). */
  assignableScopes: readonly string[]
}

/** Данные носителей создания блокировки (`/blocks/new`, `/user/[id]/blocks/new` и модалки). */
export type BlockCreateRouteData = {
  uid: string | null
  enabled: boolean
  canCreate: boolean
  canPickUsers: boolean
  assignableScopes: readonly string[]
  holdSeconds?: number
  fact: AuthErrorCode | null
}

/** Данные носителей редактирования / просмотра записи блокировки. */
export type BlockEditRouteData = {
  /** Контекстный `uid` из маршрута `/user/[id]/blocks/...` (`null` при открытии из глобального `/blocks/...`). */
  contextUid: string | null
  blockId: string
  enabled: boolean
  detail: BlockDetailView | null
  fact: AuthErrorCode | null
}

/** Данные носителей удаления записи блокировки. */
export type BlockDeleteRouteData = {
  contextUid: string | null
  blockId: string
  enabled: boolean
  detail: BlockDetailView | null
  holdSeconds: number
  fact: AuthErrorCode | null
}

/** Доверенный principal — из содержимого временного токена без похода в БД. */
export type Principal = { id: string }

/** Ответы API — данные без ошибок; ошибки (код+путь) — `error.ts`. */
export type Challenge = { token: string; expiresAt: number }

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

/** Уровень видимости профиля (ключ конфига `profile.visibility`). */
export type VisibilityLevel = 'all' | 'users' | 'nobody'

/**
 * Публичная проекция профиля для чужих и гостей: только то, что владелец
 * разрешил уровнем видимости. `id`/`authId`/`updatedAt` сюда не входят.
 */
export type PublicProfileView = {
  nickname: string | null
  avatarUrl: string | null
  createdAt: number
}

/** Итог чтения профиля доменом: строка (если видна) и признак «не создан». */
export type ProfileRead = {
  profile: ProfileView | null
  /** Эффективный уровень видимости цели (конфиг: юзер → умолчание → бутстрап). */
  visibility: VisibilityLevel
  /**
   * Строки нет, но вызывающий вправе её видеть (владелец или права чтения):
   * экран покажет заглушку «профиль не создан», а не отказ. Без прав
   * `profile === null` и `notCreated === false` — снаружи это отказ.
   */
  notCreated: boolean
  /**
   * Активная полная блокировка цели — для показа в профиле. Причина и
   * срок (`reason`/`until`) заполнены только тем, кому их можно знать
   * (владелец, `admin`, `account.read`); остальные видят сам факт.
   */
  fullBlock: { reason: string | null; until: number | null } | null
  /**
   * Раздел блокировок (этап 9): записи цели — только кругу чтения
   * (moderator/`block.read`/`block.edit`/`admin`); остальным — пустой
   * список, компонента раздела в разметке нет.
   */
  blocks: BlockView[]
  // Флаги прав зрителя — из той же карты, что производит домен (`profile()`,
  // P2-3): canEdit/canDeleteProfile/canDeleteSeed/canReadBlocks/canBlock/
  // canReadSessions/canOpenConfig/isOwn. Расхождение с доменом не компилируется.
} & PageCaps<'profile'>

/**
 * Данные `load` маршрута `/user/[id]` — единственный источник показа
 * профиля. Страница отдаёт их компоненту профиля пропсом, модалка
 * получает тот же объект через `preloadData` в самом компоненте,
 * поэтому разойтись формы показа не могут.
 *
 * `fact` — отказ (нет входа, истёк, бан) доменным кодом, а не брошенной
 * ошибкой: брошенный `error(403)` оставил бы модалку в `status: 'error'`, её
 * компонент не смонтировался бы и экран отказа показать было бы некому.
 * `profile === null` при `fact === null` — строки нет ИЛИ она не видна.
 */
export type ProfileRouteData = {
  /** id аккаунта из адреса. */
  uid: string
  profile: ProfileView | null
  /** Публичная проекция, если обычное чтение недоступно, а уровень видимости разрешает показ. */
  publicProfile: PublicProfileView | null
  /** Эффективный уровень видимости цели. */
  visibility: VisibilityLevel
  /** Профиля нет, но смотреть можно: заглушка «не создан» вместо отказа. */
  notCreated: boolean
  /** Раздел блокировок (этап 9): записи цели и право операции для компонента. */
  blocks: BlockView[]
  /** Активная полная блокировка цели для показа (причина — за правами). */
  fullBlock: { reason: string | null; until: number | null } | null
  fact: AuthErrorCode | null
  /** Вход включён на сервере (иначе форма скрыта). */
  enabled: boolean
  /** Ограничения экрана: те же, что у формы (`ProfileLimits`). */
  limits: { readonly nicknameForbidden: readonly string[] }
  // Флаги прав зрителя — из карты домена (`profile()`, P2-3). Обязательные
  // (кроме canOpenConfig): забытая фикстура без флага не проходит `check` (P0-5).
} & PageCaps<'profile'>

/**
 * Данные носителей удаления (`/user/[id]/delete` и модалка
 * `user.profile.delete`): гейт показа — `canDeleteProfile` чтения
 * профиля; форма при отправке права и запреты перепроверяет.
 */
export type ProfileDeleteRouteData = {
  uid: string
  enabled: boolean
  /** Право на профиль цели и нет запрета `profile.delete`: показ удаления. */
  canDeleteProfile: boolean
  /** Право на seed цели и нет запрета `account.delete`: чекбокс в форме. */
  canDeleteSeed: boolean
  /** Секунд удержания кнопки подтверждения (конфиг модуля). */
  holdSeconds: number
  fact: AuthErrorCode | null
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
  /**
   * Никнейм из профиля — только когда параметр никнейма включён и у
   * вызывающего есть право читать профили: без флага поля в выдаче нет
   * вовсе (не `null`), чтобы никнеймы не утекали зрителю без прав.
   * `null` при включённом параметре — ника нет или нет профиля.
   */
  nickname?: string | null
}

/** Одна порция списка seed-юзеров и её место в выдаче. */
export type SeedUsersPage = {
  items: SeedUserView[]
  total: number
  page: number
  pageSize: number
  /** Вызывающему видны удалённые строки (`readDeleted`): UI решает по этому флагу, а не по именам прав. */
  canSeeDeleted: boolean
  /** Вызывающему доступны никнеймы (политика чтения профиля): параметр никнейма в фильтрах и столбец. */
  canSeeNickname: boolean
  /** Вызывающий читает чужие устройства (круг журнала): вход в журнал из списка аккаунтов. */
  canReadSessions: boolean
}

/** Состояние удалённости в фильтре списка: действующие / все / только удалённые. */
export type SeedUsersState = 'active' | 'all' | 'deleted'

/** Порядок списка: поле и направление (`deleted` — по дате удаления, только с `canSeeDeleted`). */
export type SeedUsersOrder =
  | 'created-desc'
  | 'created-asc'
  | 'deleted-desc'
  | 'deleted-asc'
  | 'id-asc'
  | 'id-desc'
  /** По никнейму профиля; только при включённом параметре никнейма (иначе домен сбрасывает на `created-desc`). */
  | 'nickname-asc'
  | 'nickname-desc'

/** Статус сессии глазами фаервола (один PK-lookup; эмуляция session-status). */
export type SessionStatus = 'ok' | 'revoked' | 'expired' | 'unknown'

/** Один видимый параметр каталога `CONFIG_KEYS` для экрана настроек пользователя (`UserConfig`). */
export type UserConfigItem = {
  /** Ключ модели `user.config` (`profile.visibility`, `session.ipLock`, ...). */
  key: string
  /** Имя поля HTML-формы (`snake_case` по политике `#lib/form`). */
  fieldName: string
  /** Ключ группы настроек (`profile`, `security`, ...). */
  group: 'profile' | 'security'
  /** Представление поля формы. */
  kind: 'select' | 'checkbox'
  title: string
  description: string
  /** Эффективное значение параметра у целевого пользователя. */
  value: unknown
  /** Эффективное умолчание параметра (строка умолчания БД либо `bootstrap`). */
  defaultValue: unknown
  /** Есть ли персональное переопределение в `user.config` (не равно умолчанию). */
  overridden: boolean
  /** Вправе ли текущий актор менять значение этого параметра (`assign` / `editUser`). */
  editable: boolean
  /** Вправе ли текущий актор сбросить переопределение к умолчанию (`deleteUser`). */
  deletable: boolean
}

/** Срез настроек целевого пользователя для `UserConfig`. */
export type UserConfigSlice = {
  uid: string
  isOwn: boolean
  /** Есть ли хотя бы одно редактируемое поле (кнопка «Сохранить»). */
  canSave: boolean
  items: readonly UserConfigItem[]
}

/** Данные носителей `/user/config`, `/user/[id]/config` и модалки `user.config.edit`. */
export type UserConfigRouteData = {
  uid: string | null
  enabled: boolean
  slice: UserConfigSlice | null
  fact: AuthErrorCode | null
}
