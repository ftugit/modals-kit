import { s } from "./schema";
import { fail } from "./errors";
import type { StandardSchema } from "./types";
import type {
  DataContext,
  Field,
  Fields,
  Grant,
  Operator,
  Resource,
  Relations,
  Row,
} from "./types";
/** Policy/grant callback не может разрешать доступ через truthy non-boolean. */
export function policyBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    // Ошибочно async callback не должен породить unhandled rejection.
    void Promise.resolve(value).catch(() => {});
    fail("forbidden");
  }
  return value;
}
export function grants(grant: Grant | undefined, ctx: DataContext): boolean {
  return typeof grant === "function"
    ? policyBoolean(grant(ctx))
    : !!grant?.some((r) => ctx.principal.roles.includes(r));
}
export function own(o: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(o, key);
}
export function isRecord(v: unknown): v is Row {
  return (
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype ||
      Object.getPrototypeOf(v) === null)
  );
}
export function inputRecord(v: unknown, maxKeys: number): Row {
  if (!isRecord(v) || Object.keys(v).length > maxKeys) fail("validation");
  for (const k of Object.keys(v))
    if (["__proto__", "constructor", "prototype"].includes(k))
      fail("validation");
  return { ...v };
}
export function context(ctx: DataContext): DataContext {
  if (
    !ctx?.principal ||
    !Array.isArray(ctx.principal.roles) ||
    ctx.principal.roles.some((r) => typeof r !== "string") ||
    (ctx.principal.id !== undefined && typeof ctx.principal.id !== "string") ||
    (ctx.signal !== undefined && !(ctx.signal instanceof AbortSignal))
  )
    fail("forbidden");
  return Object.freeze({
    principal: Object.freeze({
      id: ctx.principal.id,
      roles: Object.freeze([...ctx.principal.roles]),
    }),
    requestId: ctx.requestId,
    // AbortSignal — чужой объект: не копируем и не замороживаем, только читаем.
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  });
}
export function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
/** JSON/array protection перед schema, без мутации исходного входа. */
function budget(value: unknown, depth = 0, state = { n: 0 }): void {
  if (
    value === undefined ||
    ["function", "symbol", "bigint"].includes(typeof value)
  )
    fail("validation");
  if (depth > 24 || ++state.n > 10000) fail("validation");
  if (typeof value === "number" && !Number.isFinite(value)) fail("validation");
  if (typeof value === "string" && value.length > 1_000_000) fail("validation");
  if (value && typeof value === "object") {
    if (!Array.isArray(value) && !isRecord(value)) fail("validation");
    if (Array.isArray(value)) {
      if (value.length > 10000) fail("validation");
      for (let i = 0; i < value.length; i++)
        if (!own(value, String(i))) fail("validation");
    }
    // JSON.stringify вызывает даже non-enumerable toJSON. Не допускаем
    // скрытые методы/accessors, которые могли бы подделать snapshot/driver value.
    for (const key of Reflect.ownKeys(value)) {
      if (Array.isArray(value) && key === "length") continue;
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        fail("validation");
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor))
        fail("validation");
      budget(descriptor.value, depth + 1, state);
    }
  }
}
export async function validateField(
  field: Field,
  value: unknown,
  key: string,
  normalize = true,
): Promise<unknown> {
  if (value === undefined) fail("validation", key);
  let v = normalize && field.normalize ? field.normalize(value) : value;
  if (v === null) {
    if (field.nullable) return null;
    fail("validation", key);
  }
  budget(v);
  const parsed = await field.schema["~standard"].validate(v);
  if (parsed.issues)
    fail(
      "validation",
      key,
      parsed.issues.map((i) => String(i.message)),
    );
  v = parsed.value;
  budget(v);
  if (v === null && !field.nullable) fail("validation", key);
  if (v === undefined) fail("validation", key);
  return v;
}
export async function draftInput(
  r: Resource,
  ctx: DataContext,
  input: unknown,
  op: "insert" | "update",
  maxKeys: number,
): Promise<Row> {
  const draft = inputRecord(input, maxKeys);
  if (op === "update" && !Object.keys(draft).length) fail("validation");
  for (const k of Object.keys(draft)) {
    const f = own(r.fields, k) ? r.fields[k] : undefined;
    if (
      !f ||
      f.generated ||
      f.createValue ||
      k === r.primaryKey ||
      k === r.ownerField ||
      (op === "update" && f.immutable) ||
      !grants(op === "insert" ? f.create : f.update, ctx)
    )
      fail("forbidden");
    draft[k] = await validateField(f, draft[k], k);
  }
  if (op === "insert")
    for (const [k, f] of Object.entries(r.fields)) {
      if (f.createValue)
        draft[k] = await validateField(f, f.createValue(ctx), k);
      else if (f.required && !f.generated && !own(draft, k))
        fail("validation", k);
    }
  return draft;
}
/** После before-hook повторяем schema и запрещаем изменение server-owned полей. */
export async function revalidateDraft(
  r: Resource,
  ctx: DataContext,
  draft: Row,
  op: "insert" | "update",
  protectedValues: Row,
  validatedSnapshot: Record<string, string>,
): Promise<Row> {
  for (const key of Reflect.ownKeys(draft)) {
    const descriptor = Object.getOwnPropertyDescriptor(draft, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !("value" in descriptor)
    )
      fail("validation");
  }
  inputRecord(draft, Object.keys(r.fields).length);
  for (const [k, v] of Object.entries(draft)) {
    budget(v);
    const f = own(r.fields, k) ? r.fields[k] : undefined;
    if (!f) fail("validation");
    if (own(protectedValues, k)) {
      if (JSON.stringify(v) !== JSON.stringify(protectedValues[k]))
        fail("forbidden");
    } else if (
      f.generated ||
      f.createValue ||
      k === r.primaryKey ||
      k === r.ownerField ||
      (op === "update" && f.immutable) ||
      !grants(op === "insert" ? f.create : f.update, ctx)
    )
      fail("forbidden");
    if (
      !own(validatedSnapshot, k) ||
      JSON.stringify(v) !== validatedSnapshot[k]
    )
      draft[k] = await validateField(f, v, k, false);
  }
  for (const [k, v] of Object.entries(protectedValues))
    if (!own(draft, k) || JSON.stringify(draft[k]) !== JSON.stringify(v))
      fail("forbidden");
  if (op === "insert")
    for (const [k, f] of Object.entries(r.fields))
      if (f.required && !f.generated && !own(draft, k)) fail("validation", k);
  if (!Object.keys(draft).length) fail("validation");
  return draft;
}
type Options<T> = Omit<Field<T>, "schema" | "kind">;
type NullableOutput<T, O extends { nullable?: boolean }> =
  | T
  | ("nullable" extends keyof O
      ? true extends O["nullable"]
        ? null
        : never
      : never);
/**
 * Поле = схема (любая Standard Schema) + права/нормализация/фильтры.
 * В источнике первый параметр был `z.ZodType`; здесь — `StandardSchema<T>`,
 * чтобы ядро не выбирало валидатор за приложение.
 */
export function field<
  T,
  const O extends Omit<Field<T>, "schema">,
>(schema: StandardSchema<T>, options: O): Field<NullableOutput<T, O>> {
  return { ...options, schema };
}
/** Хелперы под частые колонки PostgreSQL — ровно те же имена, что в источнике. */
export const f = {
  text: <const O extends Options<string>>(o: O) => field(s.text(), o),
  uuid: <const O extends Options<string>>(o: O) => field(s.uuid(), o),
  integer: <const O extends Options<number>>(o: O) => field(s.integer(), o),
  bigint: <const O extends Options<string>>(o: O) =>
    field(s.bigint(), { ...o, kind: "bigint" }),
  decimal: <const O extends Options<string>>(o: O) =>
    field(s.decimal(), { ...o, kind: "decimal" }),
  boolean: <const O extends Options<boolean>>(o: O) => field(s.boolean(), o),
  date: <const O extends Options<string>>(o: O) =>
    field(s.date(), { ...o, kind: "date" }),
  timestamp: <const O extends Options<string>>(o: O) =>
    field(s.timestamp(), { ...o, kind: "timestamp" }),
  json: <const O extends Options<unknown>>(o: O) =>
    field(s.json(), { ...o, kind: "json" }),
};

/**
 * Проверки `defineResource`, добавленные в порте. Логика одна: ловить только те
 * конфигурации, которые иначе **молча** работают не так (а не те, что громко
 * упадут на первом запросе). Причины идут в `details.issues`, то есть видны в
 * dev-диагностике `toKitError`, но не нарушают публичный контракт ошибки.
 */
const OP_LIST: Record<Operator, true> = {
  eq: true, ne: true, lt: true, lte: true, gt: true, gte: true,
  in: true, notIn: true, isNull: true, isNotNull: true,
  contains: true, startsWith: true, icontains: true, istartsWith: true,
};
const KNOWN_OPS: ReadonlySet<string> = new Set(Object.keys(OP_LIST));
const isGrantShape = (g: unknown): boolean =>
  Array.isArray(g) || typeof g === "function";

function checkShape(r: Resource): void {
  const bad: string[] = [];
  const push = (msg: string) => bad.push(msg);
  if (r.order !== undefined) {
    if (!Array.isArray(r.order) || r.order.length > 8) push("order: массив пар [field, dir] длиной ≤ 8");
    else
      for (const pair of r.order) {
        if (!Array.isArray(pair) || pair.length !== 2 || !own(r.fields, pair[0]))
          push("order: каждый элемент — [существующее поле, 'asc'|'desc']");
        else if (!r.fields[pair[0]]!.orderable) push(`order: ${pair[0]} не объявлено orderable`);
      }
  }
  // orderBy дописывает primaryKey в каждую сортировку (tie-breaker) и требует, чтобы
  // он был orderable + читаем: иначе 403 возникает на первом же select.
  if (!r.fields[r.primaryKey]?.orderable)
    push(`order: primaryKey ${r.primaryKey} обязан быть orderable — он дописывается в сортировку как tie-breaker`);
  if (r.relations)
    for (const [name, rel] of Object.entries(r.relations)) {
      if (!rel || typeof rel !== "object") {
        push(`relations.${name}: отсутствует объект связи`);
        continue;
      }
      if (!own(r.fields, rel.localField)) push(`relations.${name}.localField: нет поля ${rel.localField}`);
      const target = rel.resource as { fields?: Record<string, unknown> } | undefined;
      if (!target || typeof target !== "object" || !target.fields)
        push(`relations.${name}.resource: должен быть Resource (см. defineResource)`);
      else if (!own(target.fields, rel.foreignField))
        push(`relations.${name}.foreignField: нет поля ${rel.foreignField} в связанном ресурсе`);
      if (own(r.fields, name)) push(`relations.${name}: имя связи совпадает с полем`);
    }
  if (r.softDelete) {
    if (typeof r.softDelete.value !== "function")
      push('softDelete.value: обязан быть (ctx) => значение — иначе метка удаляется как undefined');
    if (!isGrantShape(r.softDelete.readDeleted))
      push("softDelete.readDeleted: обязан быть Grant (иначе includeDeleted всегда запрещён)");
  }
  if (
    r.validateFinal !== undefined &&
    (!(r.validateFinal as { "~standard"?: unknown }) ||
      typeof (r.validateFinal as { "~standard"?: unknown })["~standard"] !== "object")
  )
    push("validateFinal: обязан быть Standard Schema (s.* / field()/make()) — иначе проверка результата не выполняется, а запись падает на 500");
  if (r.hooks)
    for (const [k, v] of Object.entries(r.hooks))
      if (typeof v !== "function") push(`hooks.${k}: обязан быть функцией`);
  for (const [op, v] of Object.entries(r.policy))
    if (typeof v !== "function") push(`policy.${op}: обязан быть (ctx) => Filter`);
  for (const [name, f] of Object.entries(r.fields)) {
    if (!f || typeof f !== "object") {
      push(`fields.${name}: отсутствует описание поля`);
      continue;
    }
    if (!f.schema || typeof (f.schema as { "~standard"?: unknown })["~standard"] !== "object")
      push(`fields.${name}.schema: обязан быть Standard Schema (s.* / field(z.*) / make())`);
    if (!isGrantShape(f.read)) push(`fields.${name}.read: обязан быть Grant`);
    for (const mask of ["create", "update"] as const)
      if (f[mask] !== undefined && !isGrantShape(f[mask])) push(`fields.${name}.${mask}: обязан быть Grant`);
    if (f.filters !== undefined) {
      if (!Array.isArray(f.filters)) push(`fields.${name}.filters: обязан быть массивом операторов`);
      else
        for (const op of f.filters)
          if (!KNOWN_OPS.has(op)) push(`fields.${name}.filters: неизвестный оператор ${String(op)}`);
    }
    // поля, которые пишет только БД, нельзя «разрешить к записи» — значение молча потеряется
    if (f.generated && (f.create !== undefined || f.update !== undefined))
      push(`fields.${name}: generated + create/update — write-маска не имеет смысла`);
    if (f.generated && f.required) push(`fields.${name}: generated + required — поле никогда не придёт от клиента`);
    if (f.immutable && f.update !== undefined) push(`fields.${name}: immutable + update-маска`);
  }
  if (bad.length) fail("validation", undefined, bad);
}

export function defineResource<F extends Fields, R extends Relations = {}>(
  r: Resource<F, R>,
): Resource<F, R> {
  if (!r.key || !r.policy || !r.fields || !own(r.fields, r.primaryKey))
    fail("validation", undefined, ["key/policy/fields/primaryKey обязательны"]);
  checkShape(r as unknown as Resource);
  const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (
    !r.table.split(".").every((s) => identifier.test(s)) ||
    r.table.split(".").length > 2
  )
    fail("validation");
  const columns = new Set<string>();
  for (const [k, v] of Object.entries(r.fields)) {
    if (
      !identifier.test(k) ||
      !identifier.test(v.column ?? k) ||
      columns.has(v.column ?? k)
    )
      fail("validation");
    columns.add(v.column ?? k);
  }
  for (const k of [
    r.primaryKey,
    ...(r.ownerField ? [r.ownerField] : []),
    ...(r.mandatoryRead ?? []),
  ])
    if (!own(r.fields, k)) fail("validation");
  if (r.softDelete && !own(r.fields, r.softDelete.field))
    fail("validation", r.softDelete.field, ["softDelete.field: нет такой колонки"]);
  return Object.freeze({
    ...r,
    fields: Object.freeze(
      Object.fromEntries(
        Object.entries(r.fields).map(([k, v]) => [k, Object.freeze({ ...v })]),
      ),
    ) as F,
    order: Object.freeze(r.order.map((x) => Object.freeze([...x]) as typeof x)),
  });
}
