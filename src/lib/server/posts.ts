/**
 * Модель записей демо. Отдельно от `db.ts` (соединение, окружение): её читают и
 * composition root, и тесты — без переменных окружения.
 */
import { defineResource, f, field, policy } from '#lib/db/index.js'
import { fieldSchema } from '#lib/form/index.js'
import { dbCreate } from '#lib/demo/db-form/description.js'

export const posts = defineResource({
  key: 'demo.post.v1',
  table: 'public.demo_post',
  primaryKey: 'id',
  fields: {
    // DEFAULT есть и у колонки, и у createValue: ресурс подставляет uuid сам, а прямой
    // SQL (сид ниже) остаётся валидным.
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq', 'in'], db: { default: 'gen_random_uuid()' } }),
    // Поле описано один раз — в форме (`dbCreate`): те же правила проверяют форму, запись
    // и становятся CHECK колонки. Значение с меткой формы второй раз не проверяется.
    title: field(fieldSchema<string>(dbCreate, 'title'), {
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      filters: ['eq', 'contains', 'startsWith'],
      orderable: true,
    }),
    created_at: f.timestamp({ read: () => true, generated: true, orderable: true, filters: ['gt', 'gte', 'lt', 'lte'], db: { default: 'clock_timestamp()' } }),
  },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(['author']),
    update: policy.ownerOrRoles('id', ['editor']),
    // deny() для delete дал бы не 403, а not_found: строка, скрытая политикой,
    // неотличима от отсутствующей — так не протекает факт существования.
    delete: policy.roles(['author']),
  },
  order: [['created_at', 'desc']],
})
