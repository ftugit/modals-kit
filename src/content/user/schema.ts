/**
 * Модель пользователя — четыре таблицы (пользовательская система — фундамент, не
 * демо: имена без «demo») и поля формы из ОДНОГО объявления (прецедент:
 * `posts.ts`). Файл общий: его читают сервер и формы (валидаторы через
 * `formParams`); ни соединения, ни секретов.
 *
 * Персональные данные — минимум (§4): никнейм и адрес аватара юзер вносит сам;
 * таблицы auth/session — технические. Права ключами доступа — README lib/db §7;
 * приходят от компонента, вызвавшего api (общего вызова на приложение нет).
 */
import { defineAcl, defineResource, f, field, policy, s, type Filter, type Resource } from '#lib/db/index.js'
import { isBlockScope } from './spec-block.js'
import { VISIBILITY_KEY } from './spec-config.js'

/**
 * seed — публичная половина связки ключей (base64url ed25519: 32 байта → 43
 * символа); «логин» юзера. Связку генерирует приложение (`keys.ts`); приватный
 * (secret) не хранится нигде. Nullable: при конечной смерти аккаунта
 * исполнитель стирает seed — строка-надгробие остаётся (id, времена).
 */
const SEED = s.text({ min: 43, max: 44 })

/**
 * Профиль: создаётся при ПЕРВОМ заполнении личных данных; нет строки — юзер
 * аноним, показываем значения по умолчанию. Никнейм НЕуникальный: можно любой,
 * кроме списка запрещённых (`nicknameForbidden` в config.ts — проверит api).
 */
const NICKNAME = s.text({ min: 2, max: 32 })
const AVATAR_URL = s.custom((value) => {
  // контракт s.custom: строка = текст ошибки, успех — не-строка (true)
  if (value === null || value === undefined) return true // пусто — колонка nullable
  if (typeof value === 'string' && /^https?:\/\/\S{1,2040}$/i.test(value)) return true
  // `avatar_url` — ссылка на картинку, а не сам файл: сегодня это base64
  // dataURL (его готовит примитив поля или сервер по спеке), с `lib/storage`
  // сюда же ляжет http(s)-URL. Схему интересует вид строки; содержимое
  // (формат по заголовкам, вес, кадр по спеке) проверяет роут ДО записи.
  // Потолок длины — последний рубеж против мегабайтов в text-колонке.
  if (
    typeof value === 'string' &&
    value.length <= 1_500_000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return true
  return 'profile.avatar_url: ожидается адрес http(s)://… или data:image/…;base64'
})

const PROFILE_ACL = defineAcl({
  owner: { field: 'auth_id', can: ['read', 'edit'] },
  read: ['profile.read'],
  insert: ['server'],
  edit: ['profile.edit', 'admin', 'server'],
  // Публичная видимость из конфига (этап 8): строка видна любому, если за её
  // владельцем ключ `profile.visibility` = `all`, и любому вошедшему — если
  // `users`. Узел `exists` по модели конфига с `policy: false`: видимость
  // профиля — правило самого профиля, а не чтения конфига.
  extend: {
    select: (base, ctx) => {
      const visible = (value: string): Filter => ({
        exists: {
          from: config,
          on: [['auth_id', 'auth_id']],
          where: {
            and: [
              { field: 'key', op: 'eq', value: VISIBILITY_KEY },
              { field: 'value', op: 'eq', value },
            ],
          },
          policy: false,
        },
      })
      return { or: [base, visible('all'), ...(ctx.principal.id ? [visible('users')] : [])] }
    },
  },
})

export const profile: Resource = defineResource({
  key: 'user.profile.v1',
  table: 'public.user_profile',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    // Владелец профиля — строка auth. Одна строка на аккаунт; конечная смерть
    // аккаунта уносит профиль (цепочка удаления lib/db).
    auth_id: field(s.uuid(), {
      read: () => true, create: () => true, required: true,
      immutable: true, filters: ['eq'],
      db: { unique: true, references: { resource: () => auth, chain: true } },
    }),
    nickname: field(NICKNAME, {
      read: () => true, create: () => true, update: () => true, nullable: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      orderable: true, filters: ['eq', 'icontains'],
    }),
    avatar_url: field(AVATAR_URL, {
      read: () => true, create: () => true, update: () => true, nullable: true,
      // валидатор свой (`s.custom`) — тип колонки слой сам не выведет
      db: { type: 'text' },
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  acl: PROFILE_ACL,
  order: [['created_at', 'desc']],
})

/** Таблица авторизации: носитель безопасности аккаунта. Личного — ничего. */
export const auth: Resource = defineResource({
  key: 'user.auth.v1',
  table: 'public.user_auth',
  primaryKey: 'id',
  // Профиль аккаунта: связь для include и сортировки по связанным полям
  // (слой: foreignField — уникальное поле цели, `auth_id` уникален).
  relations: { profile: { resource: profile, localField: 'id', foreignField: 'auth_id' } },
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq', 'in', 'icontains'], db: { default: 'gen_random_uuid()' } }),
    seed: field(SEED, {
      read: () => true, create: () => true,
      // стирает только исполнитель удаления (сервер); юзерских update нет
      update: ['server', 'admin'], required: true, nullable: true,
      orderable: true, filters: ['eq', 'icontains'],
      db: { unique: true }, // один аккаунт на связку; NULL-ов может быть много
    }),
    /**
     * Права аккаунта — строки каталога `permissions.ts` (`profile.read`,
     * `profile.edit`, …). Лежат рядом с seed: это часть строки безопасности,
     * а не личных данных. Пусто — обычный пользователь, видит только своё.
     * Роль `admin` в списке не дублируется: правила узнают её отдельным именем.
     */
    permissions: field(s.array(s.text({ min: 1, max: 40 }), { max: 16 }), {
      // создаёт только серверный код — им заводится первый администратор
      // (`#server/admin-bootstrap`); дальше пишет администратор (`admin.ts`)
      read: () => true, create: ['server'], update: ['admin'],
      db: { default: "'{}'::text[]" },
    }),
    /**
     * Резерв дополнительной защиты (2fa, пароль): создаётся пустым, писать из
     * запросов нельзя (`[]` — «никому»); заведём вместе с первой защитой.
     */
    security: field(s.array(s.json(), { max: 8 }), {
      read: () => true, create: [], update: [],
      db: { default: "'{}'::jsonb[]" },
    }),
    /**
     * Соль для хэшей подсетей сессий — на аккаунт: между юзерами связать
     * записи нельзя, внутри истории одного — сравнение работает. Ставит
     * сервер при создании, передать нельзя.
     */
    subnet_salt: f.text({ read: () => true, createValue: () => crypto.randomUUID().replaceAll('-', '') }),
  },
  // `deleted_at` — заявка на удаление; по истечении срока (настройка сервера)
  // исполнитель стирает seed/security. Метка НЕ закрывает вход: он ведёт на
  // шаг восстановления (решение владельца, как в ВК).
  timestamps: {
    createdAt: 'created_at', updatedAt: 'updated_at',
    // заявку на удаление видят и снимают сервер/админ (шаг восстановления);
    // удалённые строки — модификатор `account.readDeleted` поверх `policy.select`
    // (`account.read` + `account.readDeleted`): сам по себе чтение живых или
    // удалённых строк он не даёт.
    deletedAt: { field: 'deleted_at', readDeleted: ['server', 'admin', 'account.readDeleted'] },
  },
  policy: {
    // Читает и мягко удаляет свою строку владелец; создаёт и зачищает сервер.
    // `user.auth` и `user.session` управляются доменными функциями и пока не
    // переведены на `defineAcl` (до проектирования прав гостевой записи auth и
    // сессионного read/revoke).
    select: policy.ownerOrRoles('id', ['server', 'admin', 'account.read']),
    insert: policy.roles(['server']),
    update: policy.roles(['server', 'admin']),
    delete: policy.ownerOrRoles('id', ['server', 'admin']),
  },
  order: [['created_at', 'desc']],
})

/**
 * Сессии = устройства (строка на устройство; публичный токен продления —
 * `jti`). Единственное хранимое состояние входов: «заблокировать устройство» =
 * софт-удаление строки (`deleted_at`), отдельной структуры банов нет.
 * Активность — здесь, НЕ в auth (не двигает её `updated_at`).
 */
export const session = defineResource({
  key: 'user.session.v1',
  table: 'public.user_session',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    auth_id: field(s.uuid(), {
      read: () => true, create: () => true, required: true,
      immutable: true, filters: ['eq'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    // Публичный токен продления (девайс-токен): случайный id, ездит только
    // в HttpOnly-куке; по нему guard узнаёт сессию (ok/revoked/expired/unknown).
    jti: field(s.text({ min: 21, max: 64 }), {
      read: () => true, create: () => true, required: true,
      immutable: true, filters: ['eq'],
      db: { unique: true },
    }),
    // пишет сервер (адаптер api), юзерских update через ресурс нет
    device_name: f.text({ read: () => true, nullable: true, create: () => true, update: () => true }),
    // Текущая подсеть: ХЭШ с солью аккаунта, полный IP и маска не хранятся.
    subnet_hash: f.text({ read: () => true, nullable: true, create: () => true, update: () => true }),
    country: f.text({ read: () => true, nullable: true, create: () => true, update: () => true }),
    // История прежних подсетей/стран: [{hash, country, at}] — пишет api при
    // пересоздании сессии (режим 'update'), а не «только текущее».
    subnet_history: f.json({ read: () => true, nullable: true, create: () => true, update: () => true, db: { default: "'[]'::jsonb" } }),
        // Версия продления: кукa продления несёт версию строки; совпала — ротация,
        // меньше — «усыновление» (кто-то продлил раньше). Отзыв — по-прежнему
        // софт-удаление; tokenVersion аккаунта нет.
        version: field(s.integer({ min: 0, max: 2_147_483_647 }), {
          read: () => true, create: () => true, update: () => true,
          db: { default: '0' },
        }),
    last_seen_at: f.timestamp({ read: () => true, nullable: true, create: () => true, update: () => true }),
    // Срок жизни сессии — из настроек (config.deviceTtlSec); ставит сервер.
    expires_at: f.timestamp({ read: () => true, create: () => true, required: true }),
  },
  // `deleted_at` = отзыв сессии (выход, отзыв устройства, «выйти со всех»).
  timestamps: {
    createdAt: 'created_at', updatedAt: 'updated_at',
    deletedAt: { field: 'deleted_at', readDeleted: ['server', 'admin'] },
  },
  policy: {
    // Сессиями юзер управляет только через api (сервер): правит и гасит сервер.
    select: policy.ownerOrRoles('auth_id', ['server', 'admin']),
    insert: policy.roles(['server']),
    update: policy.roles(['server', 'admin']),
    delete: policy.roles(['server', 'admin']),
  },
  order: [['created_at', 'desc']],
})

/**
 * Конфиг: «ключ — значение — юзер» одной моделью (этап 10 плана
 * seed-списка). Строка с `auth_id = NULL` — умолчание (глобальный ключ),
 * её поле `schema` несёт полную схему прав ключа (`editDefault` /
 * `assign` / `editUser` / `deleteUser` — роли каталога и `owner`); строка
 * юзера — переопределение, её `schema` — только упрощённая схема
 * редактирования именно этой строки. Работу ведёт конфиг-API
 * (`config-api.ts`) от системы; политики ниже — консервативный запасной
 * уровень для случаев без схемы: напрямую модель пишет только
 * сервер/админ, новый ключ умолчания заводит роль `insert`.
 * Уникальность `(auth_id, key)` — два частичных индекса ручным SQL
 * (`db.server.ts`): обычный unique NULL-дыру глобальных строк не закрывает.
 */
const CONFIG_ACL = defineAcl({
  owner: { field: 'auth_id', can: ['read'] },
  read: ['config.read'],
  insert: ['admin', 'server'],
  edit: ['admin', 'server'],
})

export const config: Resource = defineResource({
  key: 'user.config',
  table: 'public.user_config',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    auth_id: field(s.uuid(), {
      read: () => true, create: [...CONFIG_ACL.roles.insert], nullable: true,
      immutable: true, filters: ['eq', 'isNull', 'isNotNull'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    key: field(s.text({ min: 1, max: 80 }), {
      read: () => true, create: [...CONFIG_ACL.roles.insert], required: true,
      immutable: true, filters: ['eq'], orderable: true,
    }),
    value: f.json({ read: () => true, create: [...CONFIG_ACL.roles.insert], update: [...CONFIG_ACL.roles.update], nullable: true }),
    schema: f.json({ read: () => true, create: [...CONFIG_ACL.roles.insert], update: [...CONFIG_ACL.roles.update], nullable: true }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  acl: CONFIG_ACL,
  order: [['key', 'asc']],
})

/**
 * ACL модели блокировок (`defineAcl`):
 * - `owner` (`auth_id`): видит свои живые блокировки;
 * - `block.read`: читает живые блокировки;
 * - `moderator` (подотчётный исполнитель): создаёт, снимает (`until`) и мягко
 *   удаляет записи, но НЕ правит `reason` и НЕ стирает записи физически
 *   (`hard: true`), даже в паре с `block.readDeleted` — в БД всегда остаётся
 *   след на случай злоупотребления;
 * - `block.edit` и `admin`: полный цикл правки (включая `reason`), а в связке
 *   с `block.readDeleted` — восстановление и окончательное удаление (`hard`).
 */
const BLOCK_ACL = defineAcl({
  owner: { field: 'auth_id', can: ['read'] },
  read: ['block.read'],
  insert: ['moderator', 'block.edit', 'admin'],
  update: ['moderator'],
  softDelete: ['moderator'],
  edit: ['block.edit', 'admin', 'server'],
  deleted: ['block.readDeleted', 'admin', 'server'],
})

/**
 * Блокировки аккаунта (этап 9): запись = одна строка истории. Исполнение
 * нативно моделью контекстом актора — отдельного API и системной роли
 * у записи нет: круг держат маски и `acl`, содержательные правила
 * (не себе, сфера из каталога) — `checks` слоя.
 */
export const block: Resource = defineResource({
  key: 'user.block',
  table: 'public.user_block',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    auth_id: field(s.uuid(), {
      read: () => true, create: [...BLOCK_ACL.roles.insert], required: true,
      immutable: true, filters: ['eq', 'in'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    scope: field(s.text({ min: 1, max: 40 }), {
      read: () => true, create: [...BLOCK_ACL.roles.insert], required: true,
      immutable: true, orderable: true, filters: ['eq', 'in'],
    }),
    // Причина: при создании указывает весь круг записи, после — только
    // `edit` (`block.edit`, `admin`); модератор причину не правит.
    reason: field(s.text({ min: 1, max: 200 }), {
      read: () => true, create: [...BLOCK_ACL.roles.insert], update: [...BLOCK_ACL.roles.edit], required: true,
      filters: ['eq'],
    }),
    // Снятие блокировки — правка истории: until = момент снятия.
    until: f.timestamp({ read: () => true, create: [...BLOCK_ACL.roles.insert], update: [...BLOCK_ACL.roles.update], nullable: true, orderable: true, filters: ['eq', 'isNull', 'isNotNull', 'gt', 'lte'] }),
    // Кто наложил: без FK — история переживает удаление аккаунта наложившего.
    by: field(s.uuid(), {
      read: () => true, create: [...BLOCK_ACL.roles.insert], required: true,
      immutable: true, filters: ['eq'],
    }),
  },
  timestamps: {
    createdAt: 'created_at', updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  },
  acl: BLOCK_ACL,
  checks: (event) => {
    if (event.operation !== 'insert') return
    const issues = []
    const v = event.values
    if (typeof v.auth_id === 'string' && event.ctx.principal.id && v.auth_id === event.ctx.principal.id)
      issues.push({ field: 'auth_id', code: 'auth.forbidden', message: 'Нельзя заблокировать самого себя' })
    if (typeof v.scope === 'string' && !isBlockScope(v.scope))
      issues.push({ field: 'scope', code: 'permissions.unknown', message: 'Неизвестная сфера блокировки' })
    if (typeof v.by === 'string' && event.ctx.principal.id && v.by !== event.ctx.principal.id)
      issues.push({ field: 'by', code: 'auth.forbidden', message: 'Блокировку накладывает сам актор' })
    return issues
  },
  order: [['created_at', 'desc']],
})

/** Поля формы профиля — правила из схемы (валидаторы выведет `formParams`). */
export const profileFields = {
  nickname: NICKNAME,
  avatar_url: AVATAR_URL,
} as const
