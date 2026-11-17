/**
 * Модель «Диска» (`plan-drive.md` §4.2): одна самореферентная таблица узлов и
 * таблица выданных доступов.
 *
 * Модель не умеет наследовать доступ вверх по дереву: это делает
 * `service/access.ts` обходом предков, поэтому чтение чужих строк через модель
 * закрыто (`server`), а сервис проверяет право до того, как читать. Паролей и
 * `visibility` на узлах нет — главное упрощение относительно старой модели
 * `cloud_node`.
 */
import { defineAcl, defineResource, f, field, policy, s, type Resource } from '#core/lib/db/index.js'
import { normalizeDriveName } from '#core/lib/drive/index.js'
import { auth } from '#modules/user/base/model/schema.js'
import { checkNodeValues, DRIVE_KINDS, DRIVE_SHARE_ROLES } from './checks.js'

/**
 * Права узлов. Владелец читает своё; роль `drive.read` видит всё (аудит),
 * `drive.write` правит чужое (модерация), `admin` — полный круг. Создаёт
 * строки только сервис от имени `server`: вставка из запроса не должна
 * подставлять чужого владельца.
 */
export const DRIVE_ACL = defineAcl({
  owner: { field: 'owner_id', can: ['read'] },
  read: ['drive.read', 'admin', 'server'],
  insert: ['server'],
  update: ['drive.write', 'admin', 'server'],
  // Мягкое удаление у «Диска» своё (`trashed_at`), поэтому `softDelete`/
  // `deleted` из ACL не используются: корзина — обычное поле, а не `deleted_at`.
  edit: ['admin', 'server'],
})

const SERVER_WRITE = ['server'] as const
/** Правка полей: сервис и роли, которым ACL разрешает `update`. */
const DRIVE_WRITE = ['server', 'drive.write', 'admin'] as const

/**
 * Узел дерева. `size` — логический размер (квота считается по нему, даже если
 * физические части общие); `file_id` есть только у файла.
 */
export const driveNode: Resource = defineResource({
  key: 'drive.node.v1',
  table: 'public.drive_node',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
      orderable: true, filters: ['eq', 'in'], db: { default: 'gen_random_uuid()' },
    }),
    owner_id: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq', 'in'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    parent_id: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
      filters: ['eq', 'isNull', 'isNotNull'],
    }),
    kind: field(s.enum(DRIVE_KINDS), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    name: field(s.text({ min: 1, max: 255 }), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], required: true,
      normalize: (value) => (typeof value === 'string' ? normalizeDriveName(value) : value),
      orderable: true, filters: ['eq', 'icontains', 'startsWith'],
    }),
    // Логический путь байтов (`drive/<owner>/<node>`); у папки всегда пусто.
    file_id: field(s.text({ min: 1, max: 512 }), {
      read: () => true, create: [...SERVER_WRITE], nullable: true, immutable: true,
      filters: ['eq', 'isNull', 'isNotNull'],
    }),
    // bigint в модели — строка цифр; сервис приводит к числу в проекции.
    size: f.bigint({
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE],
      db: { default: '0' },
    }),
    content_type: field(s.text({ min: 1, max: 255 }), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
    }),
    hash: field(s.text({ min: 1, max: 128 }), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
      filters: ['eq'],
    }),
    starred: f.boolean({
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE],
      filters: ['eq'], db: { default: 'false' },
    }),
    // Мягкое удаление «Диска» — собственное поле, не `deleted_at`: корзина
    // должна оставаться видимой своему владельцу.
    trashed_at: f.timestamp({
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
      filters: ['isNull', 'isNotNull', 'gt', 'lte'],
    }),
    trashed_from: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
      filters: ['eq', 'isNull', 'isNotNull'],
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  acl: DRIVE_ACL,
  checks: (event) => checkNodeValues(event.values, event.operation === 'insert' ? 'insert' : 'update'),
  order: [['name', 'asc']],
  db: {
    indexes: [
      ['owner_id', 'parent_id'],
      ['owner_id', 'starred'],
    ],
  },
})

/**
 * Выданный доступ: `viewer` читает узел и всё под ним, `editor` ещё и меняет.
 * Строка — разрешение, а не роль аккаунта; отзыв удаляет строку.
 */
export const driveShare: Resource = defineResource({
  key: 'drive.share.v1',
  table: 'public.drive_share',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
      orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' },
    }),
    node_id: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq', 'in'],
      db: { references: { resource: () => driveNode, chain: true } },
    }),
    uid: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq', 'in'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    role: field(s.enum(DRIVE_SHARE_ROLES), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], required: true,
      filters: ['eq'],
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  // Доступ нельзя ни прочитать, ни выдать напрямую: наследование считает
  // сервис, и он же решает, кто вправе выдать доступ.
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['created_at', 'asc']],
  // Индекс по `uid` создаёт цепочка удаления ссылки на аккаунт; отдельный
  // `indexes: [['uid']]` дал бы второй такой же индекс с тем же именем.
  db: { unique: [['node_id', 'uid']] },
})

/**
 * Пароль приложения для монтирования по WebDAV. Хранится только HMAC секрета
 * (ключ — серверный, как у `subnetHash`): перебор по дампу БД без ключа
 * бессмыслен. Сам токен показывается один раз при выдаче.
 */
export const driveDavToken: Resource = defineResource({
  key: 'drive.dav-token.v1',
  table: 'public.drive_dav_token',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true, createValue: () => crypto.randomUUID(), immutable: true,
      orderable: true, filters: ['eq'], db: { default: 'gen_random_uuid()' },
    }),
    auth_id: field(s.uuid(), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
      db: { references: { resource: () => auth, chain: true } },
    }),
    label: field(s.text({ min: 1, max: 80 }), {
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], required: true,
      orderable: true, filters: ['eq', 'icontains'],
    }),
    prefix: field(s.text({ min: 8, max: 32 }), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    secret_hash: field(s.text({ min: 64, max: 64 }), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    last_used_at: f.timestamp({
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
    }),
    revoked_at: f.timestamp({
      read: () => true, create: [...SERVER_WRITE], update: [...DRIVE_WRITE], nullable: true,
      filters: ['isNull', 'isNotNull'],
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['created_at', 'desc']],
  db: { unique: [['prefix']] },
})

/**
 * Общая (межинстансная) блокировка WebDAV (`LOCK`/`UNLOCK`, Class 2). Хранится в БД,
 * чтобы два инстанса приложения видели одну и ту же блокировку.
 */
export const driveDavLock: Resource = defineResource({
  key: 'drive.dav-lock.v1',
  table: 'public.drive_dav_lock',
  primaryKey: 'token',
  fields: {
    token: field(s.text({ min: 1, max: 128 }), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'], orderable: true,
    }),
    path: field(s.text({ min: 0, max: 1024 }), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    scope: field(s.enum(['exclusive', 'shared']), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    depth: field(s.enum(['0', 'infinity']), {
      read: () => true, create: [...SERVER_WRITE], required: true, immutable: true,
      filters: ['eq'],
    }),
    owner: field(s.text({ min: 1, max: 255 }), {
      read: () => true, create: [...SERVER_WRITE], nullable: true,
    }),
    timeout_seconds: f.integer({
      read: () => true, create: [...SERVER_WRITE], required: true,
      db: { default: '3600' },
    }),
    expires_at: f.timestamp({
      read: () => true, create: [...SERVER_WRITE], required: true, orderable: true,
    }),
  },
  policy: {
    select: policy.roles(['server']),
    insert: policy.roles(['server']),
    update: policy.roles(['server']),
    delete: policy.roles(['server']),
  },
  order: [['expires_at', 'asc']],
})
