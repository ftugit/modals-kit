/**
 * Схема данных пользователя и его формы — из ОДНОГО объявления (прецедент:
 * `content/posts.ts`, «правила заголовка — только здесь»: из схемы выводятся
 * и CHECK-пределы БД, и валидаторы формы через `formParams`).
 *
 * Храним только псевдоним (приватность §4 плана): публичный ключ, момент
 * создания, версия токенов. Ни email, ни имени, ни IP.
 */
import { defineResource, f, field, policy, s } from '#lib/db/index.js'

/** Публичный ключ: base64 ed25519 (32 байта). Псевдоним юзера, не секрет. */
const PUBKEY = s.text({ min: 43, max: 44 })

export const identity = defineResource({
  key: 'demo.identity.v1',
  table: 'public.demo_identity',
  primaryKey: 'id',
  fields: {
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
                 orderable: true, db: { default: 'gen_random_uuid()' } }),
    pubkey: field(PUBKEY, {
      read: () => true, create: () => true, update: () => false, required: true,
      orderable: true, filters: ['eq'],
    }),
    created_at: f.timestamp({ read: () => true, generated: true,
                              db: { default: 'clock_timestamp()' }, orderable: true }),
    token_version: field(s.integer({ min: 0, max: 1_000_000 }), {
      read: () => true, create: () => true, update: () => true, required: true,
      db: { default: '0' },
    }),
  },
  policy: {
    // Читает владелец строки; создаёт только сервер (вход); правит только
    // token_version; удаляет владелец. Ключи доступа приходят из сессии.
    select: policy.ownerOrRoles('id', ['admin']),
    insert: policy.roles(['server']),
    update: policy.ownerOrRoles('id', ['admin']),
    delete: policy.ownerOrRoles('id', ['admin']),
  },
  order: [['created_at', 'desc']],
})

/** Поля формы юзера — те же правила схемы (валидаторы выведет `formParams`). */
export const userFields = {
  pubkey: PUBKEY,
} as const
