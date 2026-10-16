import { s } from "./schema";
import { fail, failFields, type FieldError } from "./errors";
import type { StandardSchema } from "./types";
import { provenFor, readProof, type ValidatedProof } from "./proof";
import type {
  DataContext,
  Field,
  Fields,
  Grant,
  Operator,
  LiveCapabilities,
  Resource,
  Relations,
  Row,
  TimestampFields,
  Timestamps,
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
/**
 * Маска поля (`read`/`create`/`update`): нет ключа или `null` — всем, `[]` — никому,
 * список ролей или функция — как `grants`. Строгие права (`readDeleted`, `expose`) — `grants`.
 */
export function allows(mask: Grant | null | undefined, ctx: DataContext): boolean {
  return mask == null || grants(mask, ctx);
}
/**
 * Системное поле: его заполняет модель или база, клиент не передаёт — `primaryKey`,
 * `ownerField`, `generated`, `createValue`, `immutable` при `update`.
 */
export function systemField(r: Resource, k: string, op: "insert" | "update" | "check"): boolean {
  const f = r.fields[k]!;
  return !!(f.generated || f.createValue || k === r.primaryKey || k === r.ownerField || (op === "update" && f.immutable));
}
/** Защита системных полей выключена: `without(['protect'])`. */
export const unprotected = (r: Resource): boolean => !!MODELS.get(r)?.off.includes("protect");
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
/** `{min}` → значение параметра; неизвестная подстановка остаётся как есть. */
function interpolate(text: string, params: Record<string, unknown> | undefined): string {
  return params ? text.replace(/\{(\w+)\}/g, (m, k: string) => (own(params, k) ? String(params[k]) : m)) : text;
}
/**
 * Ошибка поля с учётом `messages` поля: свой текст схемы сильнее, затем текст
 * поля по коду, иначе — текст схемы как есть.
 */
export function fieldError(
  field: Pick<Field, "messages"> | undefined,
  key: string | undefined,
  code: string,
  message: string,
  params?: Record<string, unknown>,
  template?: string,
): FieldError {
  const own_ = template ?? (field?.messages && own(field.messages, code) ? field.messages[code] : undefined);
  return {
    ...(key ? { field: key } : {}),
    code,
    ...(params ? { params } : {}),
    message: own_ !== undefined ? interpolate(own_, params) : message,
    ...(own_ !== undefined ? { template: own_ } : {}),
  };
}
const num = (v: unknown) => (typeof v === "number" || typeof v === "bigint" ? Number(v) : undefined);
/**
 * Коды zod (4 и 3) → коды правил форм, чтобы текст дал словарь, а не английское
 * сообщение zod. Распознаём по виду issue, zod не импортируем. Строгие границы
 * (`gt`/`lt`) не переводим: «не меньше N» для них было бы неправдой.
 */
function zodCode(i: Record<string, unknown>): { code: string; params?: Record<string, unknown> } | undefined {
  const kind = String(i.origin ?? i.type ?? "");
  const inclusive = i.inclusive !== false;
  switch (i.code) {
    case "too_small":
    case "too_big": {
      const small = i.code === "too_small";
      const n = num(small ? i.minimum : i.maximum);
      if (n === undefined || !inclusive) return { code: "invalid" };
      const p = small ? { min: n } : { max: n };
      if (kind === "string") return { code: small ? "minLength" : "maxLength", params: p };
      if (kind === "number" || kind === "int" || kind === "bigint") return { code: small ? "minValue" : "maxValue", params: p };
      if (kind === "array" || kind === "set") return { code: small ? "minCount" : "maxCount", params: p };
      return { code: "invalid" };
    }
    case "invalid_format":
    case "invalid_string": {
      const f = String(i.format ?? i.validation ?? "");
      return { code: f === "email" ? "email" : f === "url" ? "url" : f === "regex" ? "pattern" : "invalid" };
    }
    case "invalid_value":
    case "invalid_enum_value":
      return { code: "oneOf" };
    case "invalid_type":
      return { code: i.expected === "int" || i.expected === "integer" ? "integer" : "invalid" };
    case "not_multiple_of": {
      const n = num(i.divisor ?? i.multipleOf);
      return n === undefined ? { code: "invalid" } : { code: "step", params: { step: n } };
    }
    default:
      return undefined;
  }
}
/**
 * Issue схемы → ошибка поля. Код и параметры — от схемы (`s.*` даёт коды правил
 * форм, коды zod переводятся), иначе `invalid` с текстом схемы. Свой текст zod
 * (`refine(…, 'текст')`, код `custom`) — свой текст поля: он сильнее словарей.
 */
function issueError(field: Field, key: string, issue: unknown): FieldError {
  const i = (issue && typeof issue === "object" ? issue : {}) as Record<string, unknown>;
  const message = String(i.message ?? "Invalid input");
  let code = typeof i.code === "string" && i.code ? i.code : "invalid";
  let params =
    i.params && typeof i.params === "object" && !Array.isArray(i.params)
      ? (i.params as Record<string, unknown>)
      : undefined;
  let template = typeof i.template === "string" ? i.template : undefined;
  const zod = i.template === undefined ? zodCode(i) : undefined;
  if (zod) ({ code, params } = { code: zod.code, params: zod.params });
  else if (code === "custom" && template === undefined && message !== "Invalid input") template = message;
  return fieldError(field, key, code, message, params, template);
}
/**
 * Проверка одного поля без броска на ошибке значения: `{ errors }` — что не так.
 * Бросает только на защите от перегрузки (`budget`): это не ошибка поля.
 */
export async function checkField(
  field: Field,
  value: unknown,
  key: string,
  normalize = true,
  proof?: ValidatedProof,
): Promise<{ value: unknown; errors?: undefined } | { errors: FieldError[] }> {
  const required = () => ({ errors: [fieldError(field, key, "required", "Required")] });
  if (value === undefined) return required();
  let v = normalize && field.normalize ? field.normalize(value) : value;
  if (v === null) return field.nullable ? { value: null } : required();
  budget(v);
  // Метка: это значение (уже после normalize) проверено этой же схемой — второй раз не нужно.
  if (provenFor(proof, key, field.schema, v)) return { value: v };
  const parsed = await field.schema["~standard"].validate(v);
  if (parsed.issues) return { errors: parsed.issues.map((i) => issueError(field, key, i)) };
  v = parsed.value;
  budget(v);
  if ((v === null && !field.nullable) || v === undefined) return required();
  return { value: v };
}
export async function validateField(
  field: Field,
  value: unknown,
  key: string,
  normalize = true,
): Promise<unknown> {
  const r = await checkField(field, value, key, normalize);
  if (r.errors) failFields(r.errors);
  return r.value;
}
export async function draftInput(
  r: Resource,
  ctx: DataContext,
  input: unknown,
  op: "insert" | "update",
  maxKeys: number,
  /** Сюда складываются ключи, заполненные `fill`: дальше они server-owned, как `createValue`. */
  filled?: Set<string>,
): Promise<Row> {
  // метку читаем у исходного объекта: копия (`inputRecord`) её не несёт
  const proof = readProof(input);
  const draft = inputRecord(input, maxKeys);
  if (op === "update" && !Object.keys(draft).length) fail("validation");
  const errors: FieldError[] = [];
  for (const k of Object.keys(draft)) {
    const f = own(r.fields, k) ? r.fields[k] : undefined;
    if (
      !f ||
      (systemField(r, k, op) && !unprotected(r)) ||
      !allows(op === "insert" ? f.create : f.update, ctx)
    )
      fail("forbidden");
    // ошибки значений копим: форма должна увидеть все плохие поля сразу
    const r_ = await checkField(f, draft[k], k, true, proof);
    if (r_.errors) errors.push(...r_.errors);
    else draft[k] = r_.value;
  }
  if (op === "insert")
    for (const [k, f] of Object.entries(r.fields))
      // без защиты (`without(['protect'])`) переданное значение побеждает
      if (f.createValue && !(unprotected(r) && own(draft, k))) draft[k] = await validateField(f, f.createValue(ctx), k);
  // `fill` видит только проверенные значения: при ошибках переданных полей он не
  // вызывается (заголовок с ошибкой не годится для адреса), а его поле не считается
  // пропущенным — человек увидит ошибку там, где она есть.
  const canFill = !errors.length;
  if (canFill)
    for (const [k, f] of Object.entries(r.fields)) {
      if (!f.fill || own(draft, k)) continue;
      const value = await f.fill(freeze(structuredClone(draft)), ctx, op);
      if (value === undefined) continue;
      const one = await checkField(f, value, k, true);
      if (one.errors) errors.push(...one.errors);
      else {
        draft[k] = one.value;
        filled?.add(k);
      }
    }
  if (op === "insert")
    for (const [k, f] of Object.entries(r.fields))
      if (f.required && !f.generated && !own(draft, k) && (canFill || !f.fill))
        errors.push(fieldError(f, k, "required", "Required"));
  if (errors.length) failFields(errors);
  for (const k of Object.keys(draft)) draft[k] = await stored(r.fields[k]!, draft[k], ctx);
  return draft;
}
/** `store` поля: после правил, `null` не трогает. */
export async function stored(f: Field, value: unknown, ctx: DataContext): Promise<unknown> {
  return f.store && value !== null && value !== undefined ? f.store(value, ctx) : value;
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
      (systemField(r, k, op) && !unprotected(r)) ||
      !allows(op === "insert" ? f.create : f.update, ctx)
    )
      fail("forbidden");
    if (
      !own(validatedSnapshot, k) ||
      JSON.stringify(v) !== validatedSnapshot[k]
    )
      // хук положил новое значение: те же правила, затем тот же `store`
      draft[k] = await stored(f, await validateField(f, v, k, false), ctx);
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
 * упадут на первом запросе). Причины идут в `details.issues`: в dev они видны в
 * диагностике `toKitError` и в `toFormFailure`, в production клиенту не уходят.
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
  // `order` обязателен (как в типе `Resource`): без него defineResource падал на
  // `r.order.map` с TypeError (DB-5). Направление и повторы проверяются здесь же —
  // иначе ресурс объявлялся, а каждый select отказывал в orderBy (DB-6).
  if (!Array.isArray(r.order) || r.order.length > 8) push("order: обязателен — массив пар [field, dir] длиной ≤ 8");
  else {
    const seen = new Set<string>();
    for (const pair of r.order) {
      if (
        !Array.isArray(pair) ||
        pair.length !== 2 ||
        !own(r.fields, pair[0]) ||
        !["asc", "desc"].includes(pair[1] as string)
      )
        push("order: каждый элемент — [существующее поле, 'asc'|'desc']");
      else if (!r.fields[pair[0]]!.orderable) push(`order: ${pair[0]} не объявлено orderable`);
      else if (seen.has(pair[0])) push(`order: ${pair[0]} повторяется`);
      else seen.add(pair[0]);
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
    if (r.softDelete.children !== undefined && typeof r.softDelete.children !== "function")
      push("softDelete.children: обязан быть () => [{ resource, field, onDelete }] — функция, чтобы ресурсы могли ссылаться друг на друга");
  }
  if (r.db !== undefined)
    for (const kind of ["indexes", "unique"] as const) {
      const list = r.db[kind];
      if (list === undefined) continue;
      if (!Array.isArray(list)) push(`db.${kind}: обязан быть массивом списков полей`);
      else
        for (const cols of list)
          if (!Array.isArray(cols) || !cols.length || cols.some((k) => !own(r.fields, k)))
            push(`db.${kind}: каждый элемент — непустой список существующих полей`);
    }
  if (
    r.validateFinal !== undefined &&
    (!(r.validateFinal as { "~standard"?: unknown }) ||
      typeof (r.validateFinal as { "~standard"?: unknown })["~standard"] !== "object")
  )
    push("validateFinal: обязан быть Standard Schema (s.* / field()/make()) — иначе проверка результата не выполняется, а запись падает на 500");
  if (r.checks !== undefined && typeof r.checks !== "function")
    push("checks: обязан быть функцией (event) => нарушения — иначе правила данных молча не выполняются");
  if (r.hooks)
    for (const [k, v] of Object.entries(r.hooks))
      if (typeof v !== "function") push(`hooks.${k}: обязан быть функцией`);
  if (r.policy !== undefined && !isRecord(r.policy)) push("policy: объект { select?, insert?, update?, delete?, restore? }");
  else
    for (const [op, v] of Object.entries(r.policy ?? {}))
      if (typeof v !== "function") push(`policy.${op}: обязан быть (ctx) => Filter`);
  for (const [name, f] of Object.entries(r.fields)) {
    if (!f || typeof f !== "object") {
      push(`fields.${name}: отсутствует описание поля`);
      continue;
    }
    if (!f.schema || typeof (f.schema as { "~standard"?: unknown })["~standard"] !== "object")
      push(`fields.${name}.schema: обязан быть Standard Schema (s.* / field(z.*) / make())`);
    for (const mask of ["read", "create", "update"] as const)
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
    for (const fn of ["fill", "store"] as const)
      if (f[fn] !== undefined && typeof f[fn] !== "function") push(`fields.${name}.${fn}: обязан быть функцией`);
    if (f.fill && (f.generated || f.createValue))
      push(`fields.${name}: fill + ${f.generated ? "generated" : "createValue"} — значение поля уже задаёт другой источник`);
    if (f.store && f.generated) push(`fields.${name}: store + generated — поле пишет только БД`);
    // правила описывают вход (пароль), а колонка хранит результат (хэш): тип из правил был бы ложью
    if (f.store && !f.db?.type)
      push(`fields.${name}: store без db.type — колонка хранит результат store, а не то, что описывают правила поля`);
    if (f.db !== undefined) {
      if (!f.db || typeof f.db !== "object") push(`fields.${name}.db: обязан быть объектом { type?, default?, unique?, references? }`);
      else {
        for (const k of ["type", "default"] as const)
          if (f.db[k] !== undefined && (typeof f.db[k] !== "string" || !f.db[k]!.trim()))
            push(`fields.${name}.db.${k}: непустая строка`);
        if (f.db.unique !== undefined && typeof f.db.unique !== "boolean") push(`fields.${name}.db.unique: boolean`);
        const ref = f.db.references;
        if (ref !== undefined) {
          if (!ref || typeof ref !== "object" || typeof ref.resource !== "function")
            push(`fields.${name}.db.references: { resource: () => Resource, field?, onDelete? }`);
          else {
            if (ref.field !== undefined && (typeof ref.field !== "string" || !ref.field)) push(`fields.${name}.db.references.field: непустая строка`);
            if (ref.onDelete !== undefined && !["no action", "restrict", "cascade", "set null"].includes(ref.onDelete))
              push(`fields.${name}.db.references.onDelete: no action | restrict | cascade | set null`);
            if (ref.onDelete === "set null" && !f.nullable) push(`fields.${name}.db.references: onDelete «set null» у поля без nullable`);
          }
        }
      }
    }
    if (f.messages !== undefined) {
      if (!f.messages || typeof f.messages !== "object" || Array.isArray(f.messages))
        push(`fields.${name}.messages: обязан быть объектом { код: текст }`);
      else
        for (const [code, text] of Object.entries(f.messages))
          if (typeof text !== "string" || !text.trim()) push(`fields.${name}.messages.${code}: непустая строка`);
    }
  }
  if (bad.length) fail("validation", undefined, bad);
}

/** Имя поля системной метки: `timestamps` в объектной и строковой форме. */
export function timestampField(
  r: Pick<Resource, "timestamps">,
  kind: keyof Timestamps,
): string | undefined {
  const v = r.timestamps?.[kind];
  const name = typeof v === "string" ? v : v?.field;
  return name || undefined;
}

/** Что ресурс умеет сообщить опросу изменений (см. `LiveCapabilities`). */
export function liveCapabilities(r: Pick<Resource, "timestamps">): LiveCapabilities {
  return {
    inserted: true,
    updated: timestampField(r, "updatedAt") !== undefined,
    deleted: timestampField(r, "deletedAt") !== undefined,
  };
}

const TIMESTAMP_KEYS = ["createdAt", "updatedAt", "deletedAt"] as const;
/** Пустое значение опции — выключено: `undefined`, `null`, `''`. */
const off = (v: unknown): v is undefined | null | "" => v === undefined || v === null || v === "";
/**
 * `timestamps` → системные поля, мягкое удаление и индексы под опрос. Идёт до
 * остальных проверок: порядок, индексы и связи могут ссылаться на эти поля.
 */
function expandTimestamps(r: Resource): Resource {
  const t = r.timestamps as unknown;
  // `null` — выключено, как и отсутствие ключа (так же внутри: `null`, `''`, `{ field: '' }`)
  if (t === undefined || t === null) {
    const { timestamps: _off, ...rest } = r;
    return rest as Resource;
  }
  const issues: string[] = [];
  if (!isRecord(t)) fail("validation", undefined, ["timestamps: объект { createdAt?, updatedAt?, deletedAt? }"]);
  for (const k of Object.keys(t))
    if (!(TIMESTAMP_KEYS as readonly string[]).includes(k))
      issues.push(`timestamps.${k}: неизвестный ключ — есть createdAt, updatedAt, deletedAt`);
  const raw = t.deletedAt;
  const deleted0 = typeof raw === "string" || raw === null ? { field: raw } : raw;
  const deleted = isRecord(deleted0) && off(deleted0.field) ? undefined : deleted0;
  if (deleted !== undefined && (!isRecord(deleted) || typeof deleted.field !== "string"))
    issues.push("timestamps.deletedAt: имя поля или { field, readDeleted?, children? }");
  const names: Partial<Record<(typeof TIMESTAMP_KEYS)[number], string>> = {};
  for (const k of TIMESTAMP_KEYS) {
    const name = k === "deletedAt" ? (isRecord(deleted) ? deleted.field : undefined) : t[k];
    if (off(name)) continue;
    if (typeof name !== "string" || !name) {
      issues.push(`timestamps.${k}: имя поля — непустая строка`);
      continue;
    }
    if (r.fields && own(r.fields, name))
      issues.push(`timestamps.${k}: поле «${name}» объявлено и в fields — системное поле создаёт timestamps`);
    if (Object.values(names).includes(name)) issues.push(`timestamps.${k}: имя «${name}» уже занято другой меткой`);
    names[k] = name;
  }
  if (names.deletedAt && r.softDelete)
    issues.push("timestamps.deletedAt и softDelete вместе: мягкое удаление задаётся чем-то одним");
  if (issues.length) fail("validation", undefined, issues);
  if (!Object.keys(names).length) {
    const { timestamps: _off, ...rest } = r;
    return rest as Resource;
  }
  const system = (nullable: boolean): Field<unknown> => ({
    schema: s.timestamp(),
    kind: "timestamp",
    read: () => true,
    generated: true,
    immutable: true,
    orderable: true,
    filters: ["gt", "gte", "lt", "lte"],
    ...(nullable ? { nullable: true } : { db: { default: "clock_timestamp()" } }),
  });
  const fields: Fields = { ...r.fields };
  if (names.createdAt) fields[names.createdAt] = system(false);
  if (names.updatedAt) fields[names.updatedAt] = system(false);
  if (names.deletedAt) fields[names.deletedAt] = system(true);
  // Опрос спрашивает «изменённые после метки» — индекс по метке и ключу. Индекс под
  // «удалённые после метки» строит `defineSchema` сам: ему нужно своё условие
  // (`IS NOT NULL`), а индексы ресурса с мягким удалением — по живым строкам.
  const indexes = [...(r.db?.indexes ?? [])];
  if (
    names.updatedAt &&
    !indexes.some((x) => x.length === 2 && x[0] === names.updatedAt && x[1] === r.primaryKey)
  )
    indexes.push([names.updatedAt, r.primaryKey]);
  const d = deleted as { field: string; readDeleted?: Grant; children?: () => readonly import("./types").SoftDeleteChild[] } | undefined;
  return {
    ...r,
    fields,
    timestamps: Object.freeze({ ...names }),
    ...(indexes.length ? { db: { ...r.db, indexes } } : {}),
    ...(d
      ? {
          softDelete: {
            field: d.field,
            // Не вызывается: метку ставит база (`clock_timestamp()`), см. resource.ts.
            value: () => undefined,
            readDeleted: d.readDeleted ?? [],
            ...(d.children ? { children: d.children } : {}),
          },
        }
      : {}),
  };
}

/** Необязательные опции модели и поля, у которых `null` значит «нет»: дальше их просто нет. */
const OPTIONAL_KEYS = ["ownerField", "mandatoryRead", "policy", "hooks", "checks", "relations", "constraints", "validateFinal", "softDelete", "db"] as const;
const dropNull = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null)) as T;
/**
 * `null` в опции — опции нет (маска «всем», правила нет, хука нет). Объекты верхнего
 * уровня (`policy`, `hooks`) и опции полей чистятся так же.
 */
function withoutEmpty(r: Resource): Resource {
  const out = { ...r } as Record<string, unknown>;
  for (const k of OPTIONAL_KEYS) if (out[k] === null) delete out[k];
  for (const k of ["policy", "hooks"] as const) if (isRecord(out[k])) out[k] = dropNull(out[k] as object);
  out.fields = Object.fromEntries(
    Object.entries(r.fields).map(([k, f]) => [k, f && typeof f === "object" ? dropNull(f) : f]),
  );
  return out as unknown as Resource;
}

export function defineResource<
  F extends Fields,
  R extends Relations = {},
  const T extends Timestamps | null | undefined = undefined,
>(
  input: Omit<Resource<F, R>, "timestamps"> & { timestamps?: T },
): Resource<F & TimestampFields<T>, R> {
  if (!input || !input.key || !isRecord(input.fields))
    fail("validation", undefined, ["key/fields/primaryKey обязательны"]);
  const r = expandTimestamps(withoutEmpty(input as unknown as Resource)) as unknown as Resource<F & TimestampFields<T>, R>;
  if (!own(r.fields, r.primaryKey))
    fail("validation", undefined, ["key/fields/primaryKey обязательны"]);
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
  const done = Object.freeze({
    ...r,
    fields: Object.freeze(
      Object.fromEntries(
        Object.entries(r.fields).map(([k, v]) => [k, Object.freeze({ ...v })]),
      ),
    ) as F & TimestampFields<T>,
    order: Object.freeze(r.order.map((x) => Object.freeze([...x]) as typeof x)),
  });
  MODELS.set(done, { source: input as unknown as Resource, origin: done, off: [], raw: false });
  return done;
}
/**
 * Откуда модель: исходное описание (до разворота `timestamps`), исходная модель и что
 * выключено (`without`), признак `raw`. У обычной модели `origin` — она сама.
 */
export interface ModelOrigin {
  readonly source: Resource;
  readonly origin: Resource;
  readonly off: readonly string[];
  readonly raw: boolean;
}
export const MODELS = new WeakMap<object, ModelOrigin>();
