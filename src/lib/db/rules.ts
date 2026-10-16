/** Правила строк и присваивания служебных меток — общие для модели и цепочки удаления. */
import { ident, type Sql } from "./query/sql";
import { policyBoolean, timestampField, validateField } from "./validation";
import type { DataContext, Filter, Resource } from "./types";

/**
 * Правило строк операции. Нет `policy` или правила — без ограничения; `restore` без своего
 * правила — как `delete`.
 */
export function rule(x: Resource, op: 'select' | 'update' | 'delete' | 'restore', ctx: DataContext): Filter {
  const p = x.policy;
  const fn = op === 'restore' ? (p?.restore ?? p?.delete) : p?.[op];
  return fn ? fn(ctx) : true;
}
/** Право вставки: нет правила — можно. */
export const insertAllowed = (x: Resource, ctx: DataContext): boolean => !x.policy?.insert || policyBoolean(x.policy.insert(ctx));
/** Колонка поля в SQL присваивания (`SET <колонка> = …`). */
export const assignee = (x: Resource, k: string) => ident(x.fields[k].column ?? k);
/**
 * Присваивание метки мягкого удаления. Метка из `timestamps.deletedAt` — время базы
 * (`clock_timestamp()`): часы приложения не участвуют. Ручной `softDelete` — его `value`.
 */
export async function softDeleteAssignment(x: Resource, s: Sql, ctx: DataContext): Promise<string> {
  const k = x.softDelete!.field;
  if (timestampField(x, 'deletedAt') === k) return `${assignee(x, k)} = clock_timestamp()`;
  const value = await validateField(x.fields[k], x.softDelete!.value(ctx), k);
  return `${assignee(x, k)} = ${s.fieldParam(x.fields[k], value)}`;
}
