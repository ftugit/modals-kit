/**
 * Модель записей демо — единственное место, где описаны правила полей таблицы. Её читают
 * сервер (`#lib/server/db.ts`: соединение, схема БД) и описание формы (`routes/(site)/(app)/db-demo/description.ts`:
 * валидаторы через `formParams`), поэтому файл общий, а не в `lib/server`: в нём нет ни
 * соединения, ни секретов — только поля, права и порядок.
 */
import { defineResource, f, field, policy, s } from '#lib/db/index.js'

/** Адрес записи из заголовка: буквы и цифры любого алфавита, остальное — дефис. */
export function slugOf(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '')
  return slug || undefined
}

export const posts = defineResource({
  key: 'demo.post.v1',
  table: 'public.demo_post',
  primaryKey: 'id',
  fields: {
    // DEFAULT есть и у колонки, и у createValue: ресурс подставляет uuid сам, а прямой
    // SQL (сид в db.ts) остаётся валидным.
    id: f.uuid({ read: () => true, createValue: () => crypto.randomUUID(), immutable: true, orderable: true, filters: ['eq', 'in'], db: { default: 'gen_random_uuid()' } }),
    // Правила заголовка — только здесь: из них же валидаторы формы (`formParams`) и CHECK
    // колонки. Значение, помеченное формой «проверено», второй раз не проверяется.
    title: field(s.text({ min: 3, max: 120 }), {
      read: () => true,
      create: () => true,
      update: () => true,
      required: true,
      normalize: (v) => (typeof v === 'string' ? v.trim() : v),
      filters: ['eq', 'contains', 'startsWith'],
      orderable: true,
    }),
    // Адрес записи: заполняется сам из заголовка (`fill`), передать его нельзя — маски
    // `[]` («никому»; без маски — всем). У старых записей (сид) адреса нет: колонка допускает NULL.
    slug: field(s.text({ max: 80 }), {
      create: [],
      update: [],
      nullable: true,
      fill: (values) => slugOf(values.title),
    }),
    // Автор: ставит сервер из того, кто пишет (`createValue`), передать нельзя. Входа в демо
    // нет — у гостя id нет, и у его записей автора нет (NULL). Ключом доступа (`access`) поле
    // станет, когда появится вход: без id вставка с ключом «владелец» невозможна.
    author_id: f.text({ createValue: (ctx) => ctx.principal.id ?? null, nullable: true }),
  },
  // Системные поля: время ставит база. `deleted_at` — мягкое удаление: форма удаления
  // ставит метку, список её скрывает; удалённые видит только админ (его пока нет —
  // `readDeleted` не задан, значит никто). `updated_at`/`deleted_at` нужны опросу
  // изменений (`liveCapabilities`, docs/design/live-update.md §5).
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at', deletedAt: 'deleted_at' },
  policy: {
    select: policy.publicRows(),
    insert: policy.roles(['author']),
    update: policy.ownerOrRoles('author_id', ['editor']),
    // deny() для delete дал бы не 403, а not_found: строка, скрытая политикой,
    // неотличима от отсутствующей — так не протекает факт существования.
    delete: policy.roles(['author']),
  },
  order: [['created_at', 'desc']],
})
