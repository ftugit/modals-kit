/** Правила строк и присваивания служебных меток — общие для модели и цепочки удаления. */
import { fail } from "./errors";
import { originOf } from "./clone";
import { col, filterSQL, ident, Sql, table } from "./query/sql";
import { own, policyBoolean, timestampField, validateField } from "./validation";
import type { AccessKey, DataContext, Database, Filter, Limits, Resource } from "./types";

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

/* ── ключи доступа (`access`, model-automation.md §14) ─────────────────── */

/** Ключи доступа модели; у сырого экземпляра их нет. */
export const accessKeys = (m: Resource): [string, AccessKey][] => (m.access && !originOf(m).raw ? Object.entries(m.access) : []);
const target = (m: Resource, k: string) => m.fields[k].db!.references!.resource();
/** Имя подзапроса цели: внутри него колонки цели, снаружи — модели, даже у ссылки на себя. */
const ALIAS = "kit_link";

/** SQL: строка цели с ключом `value` жива и проходит её `select` и правило `name`. */
async function linkSQL(t: Resource, name: string, ctx: DataContext, s: Sql, limits: Limits, value: string): Promise<string> {
  const named = t.policy?.[name];
  if (name !== "select" && !named) fail("validation", undefined, [`access: у модели ${t.key} нет правила policy.${name}`]);
  const alias = { ...t, table: ALIAS } as Resource;
  const parts = [`${col(alias, t.primaryKey)} = ${value}`];
  if (t.softDelete) parts.push(`${col(alias, t.softDelete.field)} IS NULL`);
  parts.push(await filterSQL(alias, ctx, rule(t, "select", ctx), s, limits, true));
  if (named && name !== "select") parts.push(await filterSQL(alias, ctx, named(ctx), s, limits, true));
  return `EXISTS (SELECT 1 FROM ${table(t)} AS ${ident(ALIAS)} WHERE ${parts.map((x) => `(${x})`).join(" AND ")})`;
}

/** Значение «владельца» — текущий пользователь, приведённый к типу поля; нет или не подходит — `undefined`. */
async function me(m: Resource, k: string, ctx: DataContext): Promise<unknown> {
  if (ctx.principal.id === undefined) return undefined;
  try {
    return await validateField(m.fields[k], ctx.principal.id, k);
  } catch {
    return undefined;
  }
}

/**
 * Изменение и удаление по id: ключи берутся из строки, достаточно одного разрешающего
 * операцию. Модель без ключей — `TRUE`; ни один ключ операцию не разрешает — `FALSE`.
 */
export async function accessSQL(m: Resource, op: "update" | "delete", ctx: DataContext, s: Sql, limits: Limits): Promise<string> {
  const keys = accessKeys(m);
  if (!keys.length) return "TRUE";
  const any: string[] = [];
  for (const [k, key] of keys)
    if (key.kind === "owner") {
      const v = key.ops.includes(op) ? await me(m, k, ctx) : undefined;
      if (v !== undefined) any.push(`${col(m, k)} = ${s.fieldParam(m.fields[k], v)}`);
    } else if (key.rules[op]) any.push(await linkSQL(target(m, k), key.rules[op]!, ctx, s, limits, col(m, k)));
  return any.length ? any.map((x) => `(${x})`).join(" OR ") : "FALSE";
}

/** Ключи, переданные в фильтре чтения: `eq`/`in` со значениями, кроме веток под `not`. */
export function filterKeys(m: Resource, filter: unknown, out = new Map<string, unknown[]>()): Map<string, unknown[]> {
  if (!m.access || !filter || typeof filter !== "object") return out;
  const node = filter as Record<string, unknown>;
  for (const branch of [node.and, node.or]) if (Array.isArray(branch)) for (const x of branch) filterKeys(m, x, out);
  const k = node.field;
  if (typeof k === "string" && own(m.access, k)) {
    const values = node.op === "eq" ? [node.value] : node.op === "in" && Array.isArray(node.value) ? node.value : [];
    const kept = values.filter((v) => v != null);
    if (kept.length) out.set(k, [...(out.get(k) ?? []), ...kept]);
  }
  return out;
}

/**
 * Проверить значения ключей для чтения (переданные в фильтре) или вставки (все ключи).
 * Каждое значение каждого ключа обязано пройти; нет — `forbidden` с полем ключа.
 */
export async function checkKeys(
  db: Database,
  m: Resource,
  op: "select" | "insert",
  ctx: DataContext,
  values: Map<string, readonly unknown[]>,
): Promise<void> {
  const s = new Sql();
  const asks: { k: string; sql: string }[] = [];
  for (const [k, list] of values) {
    const key = m.access![k]!;
    const distinct = [...new Map(list.map((v) => [JSON.stringify(v), v])).values()];
    if (!distinct.length || distinct.some((v) => v == null)) fail("forbidden", k);
    if (key.kind === "owner") {
      const v = key.ops.includes(op) ? await me(m, k, ctx) : undefined;
      if (v === undefined) fail("forbidden", k);
      for (const x of distinct) if (JSON.stringify(await validateField(m.fields[k], x, k)) !== JSON.stringify(v)) fail("forbidden", k);
      continue;
    }
    const name = key.rules[op];
    if (!name) fail("forbidden", k);
    for (const x of distinct) {
      const v = await validateField(m.fields[k], x, k);
      asks.push({ k, sql: await linkSQL(target(m, k), name, ctx, s, db.limits, s.fieldParam(m.fields[k], v)) });
    }
  }
  if (!asks.length) return;
  const row = (await db.query(s.statement(`SELECT ${asks.map((a, i) => `(${a.sql}) AS ${ident(`k${i}`)}`).join(", ")}`))).rows[0]!;
  const denied = asks.findIndex((_, i) => row[`k${i}`] !== true);
  if (denied >= 0) fail("forbidden", asks[denied]!.k);
}
