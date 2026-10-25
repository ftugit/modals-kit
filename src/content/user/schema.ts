/**
 * Модель пользователя — три таблицы (пользовательская система — фундамент, не
 * демо: имена без «demo») и поля формы из ОДНОГО объявления (прецедент:
 * `posts.ts`). Файл общий: его читают сервер и формы (валидаторы через
 * `formParams`); ни соединения, ни секретов.
 *
 * Персональные данные — минимум (§4): никнейм и адрес аватара юзер вносит сам;
 * таблицы auth/session — технические. Права ключами доступа — README lib/db §7;
 * приходят от компонента, вызвавшего api (общего вызова на приложение нет).
 */
import { defineResource, f, field, policy, s } from '#lib/db/index.js'

/**
 * seed — публичная половина связки ключей (base64url ed25519: 32 байта → 43
 * символа); «логин» юзера. Связку генерирует приложение (`keys.ts`); приватный
 * (secret) не хранится нигде. Nullable: при конечной смерти аккаунта
 * исполнитель стирает seed — строка-надгробие остаётся (id, времена).
 */
const SEED = s.text({ min: 43, max: 44 })

/** Таблица авторизации: носитель безопасности аккаунта. Личного — ничего. */
export const auth = defineResource({
  key: 'user.auth.v1',
  table: 'public.user_auth',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' } }),
    seed: field(SEED, {
      read: () => true, create: () => true,
      // стирает только исполнитель удаления (сервер); юзерских update нет
      update: ['server', 'admin'], required: true, nullable: true,
      orderable: true, filters: ['eq'],
      db: { unique: true }, // один аккаунт на связку; NULL-ов может быть много
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
     * Блокировки — текущее поле, многофункциональное: условные записи
     * {scope, until?, reason} (тип `Blocked`); бан авторизации — сфера 'auth',
     * отдельные действия — своими сферами. Пишет блокировщик (роли ещё нет —
     * запись закрыта), проверяют login и фаервол в api.
     */
        blocked: field(s.array(s.json(), { max: 8 }), { read: () => true, create: [], update: [], db: { default: "'{}'::jsonb[]" } }),
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
    // заявку на удаление видят и снимают сервер/админ (шаг восстановления)
    deletedAt: { field: 'deleted_at', readDeleted: ['server', 'admin'] },
  },
  policy: {
    // Читает и правит владелец; создаёт сервер (вход). Фаервол в api решает,
    // что с блокировкой и удалением.
    select: policy.ownerOrRoles('id', ['admin']),
    insert: policy.roles(['server']),
    update: policy.ownerOrRoles('id', ['admin']),
    delete: policy.ownerOrRoles('id', ['admin']),
  },
  order: [['created_at', 'desc']],
})

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

export const profile = defineResource({
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
  policy: {
    select: policy.ownerOrRoles('auth_id', ['admin']),
    insert: policy.roles(['server']),
    update: policy.ownerOrRoles('auth_id', ['admin']),
    delete: policy.ownerOrRoles('auth_id', ['admin']),
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
    select: policy.ownerOrRoles('auth_id', ['admin']),
    insert: policy.roles(['server']),
    update: policy.roles(['server', 'admin']),
    delete: policy.roles(['server', 'admin']),
  },
  order: [['created_at', 'desc']],
})

/** Поля формы профиля — правила из схемы (валидаторы выведет `formParams`). */
export const profileFields = {
  nickname: NICKNAME,
  avatar_url: AVATAR_URL,
} as const
