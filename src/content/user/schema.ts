/**
 * Модель пользователя — ДВЕ таблицы и поля формы из ОДНОГО объявления
 * (прецедент: `posts.ts`, «правила — только здесь»). Файл читают сервер
 * (будущий gateway модуля) и формы профиля (валидаторы через `formParams`),
 * поэтому он общий, а не в `lib/server`: ни соединения, ни секретов — только
 * поля, права и порядок.
 *
 * Персональные данные (§4 плана) — минимум: профиль держит только никнейм и
 * адрес аватара; таблица авторизации — технические поля. Ни email, ни имени,
 * ни IP. Удаление аккаунта уносит профиль по цепочке (`references.chain`).
 */
import { defineResource, f, field, policy, s } from '#lib/db/index.js'

/**
 * seed — публичная половина связки ключей (base64url ed25519: 32 байта →
 * 43 символа). Публичный, но называется просто seed: это и есть «логин» юзера.
 * Генерация связки — `keys.ts` (изоморфно, у клиента с JS — в браузере).
 */
const SEED = s.text({ min: 43, max: 44 })

/** Таблица авторизации: технические поля, никакой личной информации. */
export const auth = defineResource({
  key: 'demo.auth.v1',
  table: 'public.demo_auth',
  primaryKey: 'id',
  fields: {
    // DEFAULT есть и у колонки, и у createValue — как у `posts.ts`.
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, db: { default: 'gen_random_uuid()' } }),
    seed: field(SEED, {
      read: () => true, create: () => true, update: () => false, required: true,
      orderable: true, filters: ['eq'],
      db: { unique: true }, // один аккаунт на связку ключей
    }),
    /**
     * Дополнительная защита (2fa, пароль) — резерв: массив создаётся пустым,
     * писать его из запросов нельзя (`[]` — «никому»); права и форму завести
     * вместе с первой защитой. Сейчас — только место в схеме.
     */
    security: field(s.array(s.json(), { max: 8 }), {
      read: () => true, create: [], update: [],
      db: { default: "'{}'::jsonb[]" },
    }),
    // Отметка активности: обновит `noteActivity`; сам IP не хранится (§4).
    last_seen_at: f.timestamp({ read: () => true, nullable: true }),
    // «Выйти со всех устройств»: `logoutEverywhere` инкрементирует.
    token_version: field(s.integer({ min: 0, max: 1_000_000 }), {
      read: () => true, create: () => true, update: () => true, required: true,
      db: { default: '0' },
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  policy: {
    // Читает и правит владелец строки; создаёт сервер (регистрация, вход).
    // Ключи доступа приходят из сессии (README lib/db §7).
    select: policy.ownerOrRoles('id', ['admin']),
    insert: policy.roles(['server']),
    update: policy.ownerOrRoles('id', ['admin']),
    delete: policy.ownerOrRoles('id', ['admin']),
  },
  order: [['created_at', 'desc']],
})

/** Таблица профиля: персональные данные — ровно названные владельцем два поля. */
const NICKNAME = s.text({ min: 2, max: 32 })
const AVATAR_URL = s.custom((value) => {
  if (value === null || value === undefined) return // пусто — колонка nullable
  if (typeof value === 'string' && /^https?:\/\/\S{1,2040}$/i.test(value)) return value
  return 'profile.avatar_url: ожидается адрес http(s)://…'
})

export const profile = defineResource({
  key: 'demo.profile.v1',
  table: 'public.demo_profile',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, db: { default: 'gen_random_uuid()' } }),
    /**
     * Владелец профиля — строка auth (не id этой строки). Одна строка профиля
     * на аккаунт (`unique`); удаление аккаунта уносит профиль: `chain: true`
     * (цепочка удаления lib/db) — право на удаление исполняется целиком.
     */
    auth_id: field(s.uuid(), {
      read: () => true, create: () => true, update: () => false, required: true,
      immutable: true, filters: ['eq'],
      db: { unique: true, references: { resource: () => auth, chain: true } },
    }),
    nickname: field(NICKNAME, {
      read: () => true, create: () => true, update: () => true, required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      orderable: true, filters: ['eq', 'icontains'],
    }),
    // Адрес аватара — внешняя ссылка (http/https), файлы проекта не хранит.
    avatar_url: field(AVATAR_URL, {
      read: () => true, create: () => true, update: () => true, nullable: true,
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  policy: {
    // Владелец профиля определяется по auth_id.
    select: policy.ownerOrRoles('auth_id', ['admin']),
    insert: policy.roles(['server']), // регистрация создаёт пустой профиль
    update: policy.ownerOrRoles('auth_id', ['admin']),
    delete: policy.ownerOrRoles('auth_id', ['admin']),
  },
  order: [['created_at', 'desc']],
})

/** Поля формы профиля — правила из схемы (валидаторы выведет `formParams`). */
export const profileFields = {
  nickname: NICKNAME,
  avatar_url: AVATAR_URL,
} as const
