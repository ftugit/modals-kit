import { fail } from "../errors";
import { allows, own, validateField } from "../validation";
import type {
  DataContext,
  Field,
  Filter,
  Limits,
  Order,
  Resource,
  Statement,
} from "../types";
export function ident(s: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) fail("validation");
  return '"' + s + '"';
}
export function table(r: Resource): string {
  return r.table.split(".").map(ident).join(".");
}
export function col(r: Resource, key: string): string {
  if (!own(r.fields, key)) fail("validation");
  return table(r) + "." + ident(r.fields[key].column ?? key);
}
export function expr(r: Resource, key: string): string {
  const name = col(r, key),
    kind = r.fields[key].kind;
  if (kind === "timestamp")
    return `to_char(${name} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
  if (kind === "bigint" || kind === "decimal" || kind === "date")
    return name + "::text";
  return name;
}
export function projection(r: Resource, keys: readonly string[]): string {
  return keys.map((k) => expr(r, k) + " AS " + ident(k)).join(", ");
}
export class Sql {
  readonly values: unknown[] = [];
  /** Счётчик алиасов подзапросов `exists` в пределах одного запроса: несколько и вложенных узлов не сталкиваются. */
  existsSeq = 0;
  param(v: unknown): string {
    this.values.push(v);
    return "$" + this.values.length;
  }
  fieldParam(field: Field, value: unknown): string {
    // JSONB и PostgreSQL ARRAY — разные codecs. null остаётся SQL NULL.
    return this.param(
      field.kind === "json" && value !== null ? JSON.stringify(value) : value,
    );
  }
  statement(text: string): Statement {
    return { text, values: this.values };
  }
}
export function readable(
  r: Resource,
  ctx: DataContext,
  requested?: readonly string[],
): string[] {
  if (
    requested !== undefined &&
    (!Array.isArray(requested) ||
      requested.some((k) => typeof k !== "string") ||
      requested.length > Object.keys(r.fields).length + 32)
  )
    fail("validation");
  const mandatory = [
    r.primaryKey,
    ...(r.ownerField ? [r.ownerField] : []),
    ...(r.mandatoryRead ?? []),
  ];
  if (mandatory.some((k) => !allows(r.fields[k].read, ctx))) fail("forbidden");
  return [
    ...new Set([
      ...mandatory,
      ...(requested ?? Object.keys(r.fields)).filter(
        (k) => own(r.fields, k) && allows(r.fields[k].read, ctx),
      ),
    ]),
  ];
}
export function orderBy(r: Resource, ctx: DataContext, input?: Order): Order {
  const order = input ?? r.order;
  if (!Array.isArray(order) || order.length > 8) fail("validation");
  const seen = new Set<string>();
  for (const pair of order) {
    if (!Array.isArray(pair) || pair.length !== 2) fail("validation");
    const [k, d] = pair;
    if (typeof k !== "string" || !["asc", "desc"].includes(d) || seen.has(k)) fail("forbidden");
    // Путь `relation.field` — сортировка по полю связанной записи: связь и
    // поле проверяются по объявлениям схемы (связь объявлена, поле цели
    // orderable и читаемо). Сам join добавит читающий код (include по связи
    // подтянется автоматически); сортировка — по текстовому представлению
    // значения (payload->>), для текстовых полей это их естественный порядок.
    const dot = k.indexOf(".");
    if (dot === -1) {
      if (!own(r.fields, k) || !r.fields[k].orderable || !allows(r.fields[k].read, ctx))
        fail("forbidden");
    } else {
      const rel = r.relations?.[k.slice(0, dot)];
      const tf = rel?.resource.fields[k.slice(dot + 1)];
      if (!rel || !tf || !tf.orderable || !allows(tf.read, ctx) || k.slice(dot + 1).includes("."))
        fail("forbidden");
    }
    seen.add(k);
  }
  const result = [...order];
  if (!seen.has(r.primaryKey)) {
    if (
      !r.fields[r.primaryKey].orderable ||
      !allows(r.fields[r.primaryKey].read, ctx)
    )
      fail("forbidden");
    result.push([r.primaryKey, "asc"]);
  }
  return result;
}
export function orderSQL(r: Resource, order: Order): string {
  return order
    .map(([k, d]) => col(r, k) + " " + d.toUpperCase() + " NULLS LAST")
    .join(", ");
}
const scalarOps = {
  eq: "=",
  ne: "<>",
  lt: "<",
  lte: "<=",
  gt: ">",
  gte: ">=",
} as const;
export async function filterSQL(
  r: Resource,
  ctx: DataContext,
  filter: Filter | undefined,
  s: Sql,
  limits: Limits,
  trusted = false,
): Promise<string> {
  if (
    trusted &&
    (filter == null || (typeof filter === "object" && "then" in filter))
  ) {
    void Promise.resolve(filter).catch(() => {});
    fail("forbidden");
  }
  let count = 0;
  async function visit(node: Filter, depth: number, res: Resource = r): Promise<string> {
    if (++count > limits.filterNodes || depth > limits.filterDepth)
      fail("validation");
    if (typeof node === "boolean") return node ? "TRUE" : "FALSE";
    if (!node || typeof node !== "object" || Array.isArray(node))
      fail("validation");
    const keys = Object.keys(node);
    if ("and" in node || "or" in node) {
      const key = "and" in node ? "and" : "or";
      if (keys.length !== 1) fail("validation");
      const children =
        key === "and"
          ? (node as { and: Filter[] }).and
          : (node as { or: Filter[] }).or;
      if (!Array.isArray(children) || children.length > limits.filterNodes)
        fail("validation");
      if (!children.length) return key === "and" ? "TRUE" : "FALSE";
      return (
        "(" +
        (await Promise.all(children.map((n) => visit(n, depth + 1, res)))).join(
          key === "and" ? " AND " : " OR ",
        ) +
        ")"
      );
    }
    if ("not" in node) {
      if (keys.length !== 1) fail("validation");
      return "(NOT " + (await visit(node.not, depth + 1, res)) + ")";
    }
    if ("exists" in node) {
      // Серверный узел политик; в недоверенном (клиентском/доменном) фильтре —
      // только с политикой цели (policy: false запрещён) и полевыми гейтами:
      // существованием нельзя подсмотреть то, что нельзя прочитать напрямую.
      if (keys.length !== 1) fail("validation");
      const ex = (node as { exists: unknown }).exists;
      if (!ex || typeof ex !== "object" || Array.isArray(ex)) fail("validation");
      const spec = ex as { from?: unknown; on?: unknown; where?: Filter; policy?: unknown };
      if (Object.keys(ex).some((k) => !["from", "on", "where", "policy"].includes(k)))
        fail("validation");
      const from = spec.from as Resource | undefined;
      if (
        !from ||
        typeof from !== "object" ||
        typeof from.table !== "string" ||
        typeof from.primaryKey !== "string" ||
        !from.fields ||
        typeof from.fields !== "object" ||
        !own(from.fields, from.primaryKey)
      )
        fail("validation", undefined, ["exists: from — конкретная модель (ресурс)"]);
      if (spec.policy !== undefined && typeof spec.policy !== "boolean") fail("validation");
      if (!trusted && spec.policy === false) fail("forbidden");
      if (!Array.isArray(spec.on) || !spec.on.length || spec.on.length > 8) fail("validation");
      const alias = { ...from, table: "kit_exists_" + ++s.existsSeq } as Resource;
      const parts: string[] = [];
      for (const pair of spec.on) {
        if (!Array.isArray(pair) || pair.length !== 2) fail("validation");
        const [local, foreign] = pair as [unknown, unknown];
        if (typeof local !== "string" || !own(res.fields, local)) fail("forbidden");
        if (typeof foreign !== "string" || !own(from.fields, foreign)) fail("forbidden");
        if (!trusted && (!allows(res.fields[local].read, ctx) || !allows(from.fields[foreign].read, ctx)))
          fail("forbidden");
        parts.push(col(alias, foreign) + " = " + col(res, local));
      }
      if (spec.where !== undefined)
        parts.push(await visit(spec.where, depth + 1, alias));
      if (trusted ? spec.policy !== false : true) {
        const fn = from.policy?.select;
        parts.push(await filterSQL(alias, ctx, fn ? fn(ctx) : true, s, limits, true));
      }
      if (from.softDelete) parts.push(col(alias, from.softDelete.field) + " IS NULL");
      return `EXISTS (SELECT 1 FROM ${table(from)} AS ${ident(alias.table)} WHERE ${parts.map((x) => `(${x})`).join(" AND ")})`;
    }
    if (
      !("field" in node) ||
      !("op" in node) ||
      keys.some((k) => !["field", "op", "value"].includes(k))
    )
      fail("validation");
    const { field, op } = node;
    if (typeof field !== "string" || !own(res.fields, field)) fail("forbidden");
    const f = res.fields[field];
    if (!trusted && (!allows(f.read, ctx) || !f.filters?.includes(op)))
      fail("forbidden");
    const c = col(res, field);
    if (op === "isNull" || op === "isNotNull")
      return c + (op === "isNull" ? " IS NULL" : " IS NOT NULL");
    if ((op === "eq" || op === "ne") && node.value === null)
      return c + (op === "eq" ? " IS NULL" : " IS NOT NULL");
    if (op === "in" || op === "notIn") {
      if (
        !Array.isArray(node.value) ||
        node.value.length > limits.inValues ||
        node.value.some((v) => v === null)
      )
        fail("validation");
      if (!node.value.length) return op === "in" ? "FALSE" : "TRUE";
      const vals = await Promise.all(
        node.value.map((v) => validateField(f, v, field)),
      );
      return (
        c +
        (op === "in" ? " IN (" : " NOT IN (") +
        vals.map((v) => s.fieldParam(f, v)).join(",") +
        ")"
      );
    }
    const value = await validateField(f, node.value, field);
    if (op === "contains" || op === "startsWith" || op === "icontains" || op === "istartsWith") {
      if (typeof value !== "string") fail("validation");
      const escaped = value.replace(/[\\%_]/g, "\\$&");
      const ci = op === "icontains" || op === "istartsWith";
      return (
        c +
        (ci ? " ILIKE " : " LIKE ") +
        s.param((op === "contains" || op === "icontains" ? "%" : "") + escaped + "%") +
        " ESCAPE E'\\\\'"
      );
    }
    if (!own(scalarOps, op)) fail("validation");
    return (
      c +
      " " +
      scalarOps[op as keyof typeof scalarOps] +
      " " +
      s.fieldParam(f, value)
    );
  }
  return visit(filter ?? true, 0);
}
export function keyset(
  r: Resource,
  order: Order,
  values: readonly unknown[],
  s: Sql,
): string {
  if (values.length !== order.length) fail("cursor");
  const parts: string[] = [];
  for (let i = 0; i < order.length; i++) {
    const terms: string[] = [];
    for (let j = 0; j < i; j++)
      terms.push(
        col(r, order[j][0]) +
          (values[j] === null
            ? " IS NULL"
            : " = " + s.fieldParam(r.fields[order[j][0]], values[j])),
      );
    const [k, d] = order[i],
      c = col(r, k),
      v = values[i];
    terms.push(
      v === null
        ? "FALSE"
        : `(${c} ${d === "asc" ? ">" : "<"} ${s.fieldParam(r.fields[k], v)} OR ${c} IS NULL)`,
    );
    parts.push("(" + terms.join(" AND ") + ")");
  }
  return "(" + parts.join(" OR ") + ")";
}
