import { defineAcl, defineResource, f, field, policy, registerRelation, s, type Filter, type Resource } from '#core/lib/db/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import { config } from '#modules/user/base/model/schema.js'
import { VISIBILITY_KEY } from '#modules/user/base/service/spec-config.js'

const NICKNAME = s.text({ min: 2, max: 32 })
const AVATAR_URL = s.custom((value) => {
  // контракт s.custom: строка = текст ошибки, успех — не-строка (true)
  if (value === null || value === undefined) return true // пусто — колонка nullable
  if (typeof value === 'string' && /^https?:\/\/\S{1,2040}$/i.test(value)) return true
  if (typeof value === 'string' && /^\/(?!\/)\S{1,2040}$/.test(value)) return true
  // Обратная совместимость со старыми строками dataURL в БД.
  if (
    typeof value === 'string' &&
    value.length <= 1_500_000 &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
  )
    return true
  return 'profile.avatar_url: ожидается адрес /api/storage/…, http(s)://… или data:image/…;base64'
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

export const profileFields = {
  nickname: NICKNAME,
  avatar_url: AVATAR_URL,
} as const

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

// Обратная связь базовой модели: профиль опционален, поэтому объявляет её сам, а
// не `user/base` (иначе база зависела бы от субмодуля). Пока модуль установлен,
// работают `include: ['profile']` и сортировка `profile.nickname`; без модуля
// связи нет — и потребителей связи тоже нет.
registerRelation(auth, 'profile', {
  resource: profile,
  localField: 'id',
  foreignField: 'auth_id',
})


