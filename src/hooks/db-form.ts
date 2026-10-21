/**
 * Модель БД → параметры полей формы `#lib/form`. Переходник между двумя
 * библиотеками, поэтому живёт здесь, в `src/hooks`, а не в одной из них:
 * ядро `lib/db` форму не импортирует, ядро `lib/form` базу не импортирует —
 * соединяет их приложение в этой папке.
 *
 * ```ts
 * import { formParams } from '#hooks/db-form.js'
 *
 * const post = formParams(posts)
 * export const dbCreate = defineForm({
 *   id: 'db_demo_create',
 *   fields: post.fields({
 *     title: field.text({ label: 'Заголовок', ...post.title }),        // правила — из модели
 *     agree: field.checkbox({ label: 'Согласен', validate: [v.required()] }), // только форма
 *   }),
 * })
 * ```
 *
 * Правила поля живут в модели (`s.text({ min: 3, max: 120 })`, `required: true`), форма
 * получает из них валидаторы и ничего не пишет руками. Свой валидатор — рядом с
 * выданными: `validate: [...post.title.validate, v.email()]`.
 *
 * Метка «проверено» (`rulesFrom`): если правила схемы переведены в валидаторы формы
 * целиком, `pick` на сервере формы помечает значение, и запись не повторяет правила
 * схемы. Целиком переводятся `s.text` без `pattern`, `s.integer`, `s.enum`, `s.boolean`.
 * Остальные схемы (свой предикат, zod, даты) дают то, что известно (длина, границы,
 * набор значений), но без метки — БД проверит сама.
 *
 * Слов здесь нет: подписи и тексты ошибок — в описании формы и её словаре.
 */
import { DEV } from "esm-env";
import { v, type FieldDraft, type RulesFrom, type ValidatorRef } from "#lib/form/index.js";
import { columnMeta } from "#lib/db/schema.js";
import type { Field, Fields, Resource } from "#lib/db/index.js";

/** Что модель даёт одному полю формы. `validate` есть всегда — его удобно дополнять. */
export interface DbFieldParams {
  readonly validate: readonly ValidatorRef[];
  /** Откуда правила: схема поля модели (ставит метку `pick`). Нет — БД проверит сама. */
  readonly rulesFrom?: RulesFrom;
}

export type DbFormParams<F extends Fields = Fields> = {
  /**
   * Обёртка `fields` описания: развёртка чужого ключа (`slug: field.text({ ...post.title })`)
   * в разработке даёт предупреждение. Возвращает поля как есть.
   */
  fields<D extends Record<string, FieldDraft<any>>>(drafts: D): D;
} & { readonly [K in keyof F]: DbFieldParams };

/** Схемы `s.*`, чьи правила переводятся в валидаторы формы без остатка. */
const COMPLETE = new Set(["kit-db/text", "kit-db/integer", "kit-db/enum", "kit-db/boolean"]);

/** Поле обязано прийти от человека: обязательно и ничем не заполняется само. */
const mustCome = (f: Field) => !!f.required && !f.fill && !f.createValue && !f.generated;

function paramsOf(f: Field): DbFieldParams {
  const rules: ValidatorRef[] = [];
  if (mustCome(f)) rules.push(v.required());
  const meta = columnMeta(f.schema);
  if (meta?.length?.min !== undefined) rules.push(v.minLength(meta.length.min));
  if (meta?.length?.max !== undefined) rules.push(v.maxLength(meta.length.max));
  if (meta?.type === "integer") rules.push(v.integer());
  if (meta?.range?.min !== undefined) rules.push(v.minValue(meta.range.min));
  if (meta?.range?.max !== undefined) rules.push(v.maxValue(meta.range.max));
  if (meta?.values) rules.push(v.oneOf(meta.values));
  const vendor = (f.schema as { "~standard"?: { vendor?: unknown } })["~standard"]?.vendor;
  // Пустое необязательное поле форма не проверяет на длину (пусто ≠ «короче трёх»), а
  // схема БД пустую строку отклонит: обещать «проверено» здесь нельзя.
  const emptyGap = !mustCome(f) && (meta?.length?.min ?? 0) > 0;
  const complete = typeof vendor === "string" && COMPLETE.has(vendor) && !!meta && !meta.partial && !emptyGap;
  const validate = Object.freeze(rules);
  return Object.freeze({
    validate,
    ...(complete ? { rulesFrom: Object.freeze({ schema: f.schema, rules: validate }) } : {}),
  });
}

const cache = new WeakMap<object, DbFormParams>();

/**
 * Параметры полей формы из модели. Один объект на ресурс: повторный вызов отдаёт те
 * же валидаторы (метка сверяет их по ссылке).
 * @param resource Ресурс `defineResource`.
 */
export function formParams<F extends Fields>(resource: Resource<F>): DbFormParams<F> {
  const hit = cache.get(resource);
  if (hit) return hit as DbFormParams<F>;
  if (Object.prototype.hasOwnProperty.call(resource.fields, "fields"))
    throw new Error(`[db] formParams(${resource.key}): поле «fields» занято обёрткой — переименуйте поле модели`);
  const byField: Record<string, DbFieldParams> = {};
  const issuedBy = new Map<ValidatorRef, string>();
  for (const [name, f] of Object.entries(resource.fields)) {
    byField[name] = paramsOf(f);
    for (const r of byField[name]!.validate) issuedBy.set(r, name);
  }
  function fields<D extends Record<string, FieldDraft<any>>>(drafts: D): D {
    if (DEV)
      for (const [name, draft] of Object.entries(drafts))
        for (const r of draft.validators ?? []) {
          const owner = issuedBy.get(r);
          if (owner && owner !== name)
            console.warn(`[db] formParams(${resource.key}): поле формы «${name}» развернуло параметры «${owner}»`);
        }
    return drafts;
  }
  const out = Object.freeze({ ...byField, fields }) as unknown as DbFormParams<F>;
  cache.set(resource, out as DbFormParams);
  return out;
}
