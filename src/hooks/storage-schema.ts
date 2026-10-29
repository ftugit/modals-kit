import { defineAcl, defineResource, f } from '#lib/db/index.js'

/**
 * ACL таблицы серверов боевого хранилища (`STORAGE_ACL`):
 * - `storage.read` — просмотр пула серверов, квот, приоритетов и режима работы;
 * - `storage.edit`, `admin`, `server` — создание, обновление и удаление серверов.
 * Поле `sealed_config` доступно на чтение исключительно `['server']`.
 */
export const STORAGE_ACL = defineAcl({
  read: ['storage.read'],
  insert: ['storage.edit', 'admin', 'server'],
  edit: ['storage.edit', 'admin', 'server'],
})

/**
 * Таблица подключённых серверов боевого хранилища приложения (`public.storage_server`).
 * Учётные данные S3 / WebDAV лежат запечатанными в `sealed_config` (`read: ['server']`),
 * а публичные замаскированные сводки и квоты — в `meta`.
 *
 * Вынесена в отдельный модуль без импорта `#lib/storage` (по образцу `schema-route.ts`),
 * чтобы клиентские компоненты (`MenuBody`, `StorageServersEntry`) читали `grants(storageServer)`
 * без затягивания движка хранилища в клиентский бандл страниц.
 */
export const storageServer = defineResource({
  key: 'storage.server.v1',
  table: 'public.storage_server',
  primaryKey: 'id',
  fields: {
    id: f.uuid({
      read: () => true,
      createValue: () => crypto.randomUUID(),
      immutable: true,
      orderable: true,
      filters: ['eq'],
      db: { default: 'gen_random_uuid()' },
    }),
    slot: f.text({
      read: () => true,
      create: [...STORAGE_ACL.roles.insert],
      required: true,
      immutable: true,
      orderable: true,
      filters: ['eq'],
      db: { unique: true },
    }),
    sealed_config: f.text({
      read: ['server'],
      create: [...STORAGE_ACL.roles.insert],
      update: [...STORAGE_ACL.roles.update],
      required: true,
    }),
    meta: f.json({
      read: () => true,
      create: [...STORAGE_ACL.roles.insert],
      update: [...STORAGE_ACL.roles.update],
      required: true,
    }),
    priority: f.integer({
      read: () => true,
      create: [...STORAGE_ACL.roles.insert],
      update: [...STORAGE_ACL.roles.update],
      required: true,
      orderable: true,
      filters: ['eq'],
    }),
  },
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  acl: STORAGE_ACL,
  order: [
    ['priority', 'asc'],
    ['slot', 'asc'],
  ],
})
