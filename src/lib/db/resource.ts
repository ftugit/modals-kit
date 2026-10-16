import { policyBoolean } from './validation';
import { DbFailure, fail, failFields, normalizeFailure, type FieldError } from './errors';
import { tableSpec } from './sync/model';
import { allows, checkField, context, draftInput, freeze, grants, inputRecord, isRecord, own } from './validation';
import { fieldError, revalidateDraft, systemField, timestampField, unprotected, validateField } from './validation';
import { readProof } from './proof';
import { behavior, originOf, withoutPaths } from './clone';
import { accessKeys, accessSQL, assignee, checkKeys, filterKeys, insertAllowed, rule, softDeleteAssignment } from './rules';
import { chainPlan } from './chain';
import { rawApi, rawResource } from './raw';
import {
  Sql,
  col,
  expr,
  filterSQL,
  ident,
  keyset,
  orderBy,
  orderSQL,
  projection,
  readable,
  table,
} from './query/sql';
import type {
  CheckEvent,
  CursorInput,
  DataContext,
  Database,
  Fields,
  Filter,
  HookContext,
  Relations,
  ResourceRow,
  ListInput,
  Operation,
  Resource,
  ResourceApi,
  Row,
} from './types';

/**
 * Ограничения, которые `defineSchema` создаёт из модели (уникальные индексы, CHECK):
 * имя → поля. Имена с хешем приложение не знает, поэтому сопоставление здесь, а не
 * в `constraints` ресурса. `null` — модель не описывает таблицу (zod без `db.type`).
 */
const managed = new WeakMap<object, Promise<Map<string, { kind: 'unique' | 'check' | 'reference'; fields: string[] }> | null>>();
function managedConstraints(r: Resource): Promise<Map<string, { kind: 'unique' | 'check' | 'reference'; fields: string[] }> | null> {
  // ограничения строит исходная модель: клон (`without`) таблицу не описывает
  r = originOf(r).origin;
  let p = managed.get(r);
  if (!p) {
    const byColumn = new Map(Object.entries(r.fields).map(([k, f]) => [f.column ?? k, k]));
    p = tableSpec(r)
      .then((spec) => {
        const out = new Map<string, { kind: 'unique' | 'check' | 'reference'; fields: string[] }>();
        for (const o of spec.objects)
          // внешний ключ этой таблицы: нарушение = «связанной записи нет» (код `reference`)
          if (o.kind !== 'index')
            out.set(o.name, { kind: o.kind === 'foreign' ? 'reference' : o.kind, fields: o.columns.map((c) => byColumn.get(c)).filter((k): k is string => !!k) });
        return out;
      })
      .catch(() => null);
    managed.set(r, p);
  }
  return p;
}
const DEFAULT_TEXT: Record<string, string> = {
  unique: 'Value already exists',
  check: 'Value violates a constraint',
  required: 'Required',
  reference: 'Referenced record not found',
  referenced: 'Record is referenced by other records',
};
/**
 * `updatedAt = clock_timestamp()` для `update`/`restore`; нет метки — ничего. Метку передали
 * сами (`without(['protect'])`) — в этой операции она не двигается.
 */
function touchAssignment(x: Resource, draft?: Row): string[] {
  const k = timestampField(x, 'updatedAt');
  return k && !(draft && own(draft, k)) ? [`${assignee(x, k)} = clock_timestamp()`] : [];
}
/**
 * Правила данных ресурса → ошибки полей. Пусто — нарушений нет. Нарушение без своего
 * текста получает текст поля по коду (`messages`), иначе код уходит в словарь формы.
 */
async function runChecks(r: Resource, event: CheckEvent): Promise<FieldError[]> {
  if (!r.checks) return [];
  const found = await r.checks(event);
  if (found === undefined) return [];
  if (!Array.isArray(found)) throw new TypeError(`${r.key}: checks обязан вернуть массив нарушений или ничего`);
  return found.map((i) => {
    if (!i || typeof i.code !== 'string' || !i.code || (i.field !== undefined && !own(r.fields, i.field)))
      throw new TypeError(`${r.key}: нарушение checks — { field?: поле ресурса, code: непустая строка, params?, message? }`);
    return fieldError(
      i.field ? r.fields[i.field] : undefined,
      i.field,
      i.code,
      i.message ?? DEFAULT_TEXT[i.code] ?? i.code,
      i.params,
      i.message,
    );
  });
}
/** Снимок значений для `checks`: правило читает, но не меняет черновик записи. */
const snapshot = (values: Row): Readonly<Row> => freeze(structuredClone(values));
/** Ошибка поля → issue Standard Schema (как `failureIssues`). */
const toIssue = (x: FieldError) => ({
  message: x.message,
  code: x.code,
  ...(x.field ? { path: [x.field] } : {}),
  ...(x.params ? { params: x.params } : {}),
  ...(x.template !== undefined ? { template: x.template } : {}),
});
/**
 * Ошибка PostgreSQL → ошибки полей, если поле известно и этот ctx сам его пишет
 * (значит, значение прислал он и узнать «занято» ему можно). Иначе — без полей,
 * как раньше: общая `conflict`/`validation`.
 */
async function attachFieldErrors(
  r: Resource, ctx: DataContext, e: DbFailure, op: 'insert' | 'update', draft: Row,
): Promise<void> {
  // значение пришло от этого ctx: поле передано им, а не подставлено сервером
  const serverOwned = (k: string) => !!(r.fields[k].createValue || r.fields[k].generated || k === r.primaryKey || k === r.ownerField);
  const writable = (k: string) =>
    own(r.fields, k) && own(draft, k) && !serverOwned(k) && allows(op === 'insert' ? r.fields[k].create : r.fields[k].update, ctx);
  const state = e.details.sqlstate;
  let errors: FieldError[] = [];
  if (state === '23502' && e.details.column) {
    const k = Object.keys(r.fields).find((key) => (r.fields[key].column ?? key) === e.details.column);
    if (k && !serverOwned(k) && allows(op === 'insert' ? r.fields[k].create : r.fields[k].update, ctx))
      errors = [fieldError(r.fields[k], k, 'required', DEFAULT_TEXT.required)];
  } else if (state === '23503') {
    // Нарушен внешний ключ. Свой ключ модели → ошибка поля «связанной записи нет»
    // (если поле пишет этот ctx). Чужой ключ при вставке — тоже «нет связанной» (вставка
    // нарушает только исходящие ключи), но без поля; при изменении не угадать, чей он, —
    // тогда как раньше, без ошибок полей.
    const c = e.details.constraint ? (await managedConstraints(r))?.get(e.details.constraint) : undefined;
    if (c?.kind === 'reference' && c.fields.length && c.fields.every(writable))
      errors =
        c.fields.length === 1
          ? [fieldError(r.fields[c.fields[0]], c.fields[0], 'reference', DEFAULT_TEXT.reference)]
          : [fieldError(undefined, undefined, 'reference', DEFAULT_TEXT.reference, { fields: [...c.fields] })];
    else if (!c && op === 'insert') errors = [fieldError(undefined, undefined, 'reference', DEFAULT_TEXT.reference)];
  } else if ((state === '23505' || state === '23514') && e.details.constraint) {
    const c = (await managedConstraints(r))?.get(e.details.constraint);
    if (c && c.fields.length && c.fields.every(writable)) {
      const code = c.kind;
      errors =
        c.fields.length === 1
          ? [fieldError(r.fields[c.fields[0]], c.fields[0], code, DEFAULT_TEXT[code])]
          : [fieldError(undefined, undefined, code, DEFAULT_TEXT[code], { fields: [...c.fields] })];
    }
  }
  if (errors.length) e.details.errors = Object.freeze(errors);
}
export function resourceApi<F extends Fields, R extends Relations = {}>(
  db: Database,
  r: Resource<F, R>,
): ResourceApi<F, R> {
  type Out = ResourceRow<F, R>;
  if (originOf(r as unknown as Resource).raw) return rawApi(db, r as unknown as Resource) as unknown as ResourceApi<F, R>;
  /**
   * Отмена: Statement.signal берётся из контекста запроса. Драйвер решает, что
   * с ней делать (pg — обрывает соединение, PGlite — игнорирует, см. adapters).
   * Без signal поведение идентично источнику.
   */
  const withSignal = <T extends { text: string; values?: readonly unknown[] }>(
    statement: T,
    ctx: DataContext,
  ): T => (ctx.signal ? { ...statement, signal: ctx.signal } : statement);
  const output = (row: Row, keys: readonly string[]): Out =>
    Object.fromEntries(keys.filter((k) => own(row, k)).map((k) => [k, row[k]])) as Out;
  function listInput(input: ListInput): ListInput {
    inputRecord(input, db.limits.inputKeys);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            'fields',
            'filter',
            'order',
            'page',
            'limit',
            'includeDeleted',
            'include',
            'after',
          ].includes(k),
      )
    )
      fail('validation');
    if (input.includeDeleted !== undefined && typeof input.includeDeleted !== 'boolean')
      fail('validation');
    return input;
  }
  async function where(
    ctx: DataContext,
    op: Exclude<Operation, 'insert'>,
    s: Sql,
    filter?: Filter,
    includeDeleted = false,
    policyOverride?: { value: Filter },
  ): Promise<string> {
    const policy = await filterSQL(
      r,
      ctx,
      policyOverride ? policyOverride.value : rule(r, op, ctx),
      s,
      db.limits,
      true,
    );
    const client = await filterSQL(r, ctx, filter, s, db.limits);
    // ключи доступа: чтение — переданные в фильтре; изменение и удаление по id — из строки
    let access = 'TRUE';
    if (op === 'select') {
      const keys = filterKeys(r as unknown as Resource, filter);
      if (keys.size) await checkKeys(db, r as unknown as Resource, 'select', ctx, keys);
    } else access = await accessSQL(r as unknown as Resource, op === 'update' ? 'update' : 'delete', ctx, s, db.limits);
    let deleted = 'TRUE';
    if (r.softDelete) {
      if (includeDeleted && !grants(r.softDelete.readDeleted, ctx)) fail('forbidden');
      if (!includeDeleted) deleted = col(r, r.softDelete.field) + ' IS NULL';
    }
    return `(${policy}) AND (${access}) AND (${client}) AND (${deleted})`;
  }
  /**
   * Строка по ключу для изменения. `force` — удаление навсегда: удалённую (мягко) строку оно
   * достаёт только у того, кто видит удалённые (`readDeleted`), иначе — только живую.
   */
  async function idWhere(ctx: DataContext, op: 'update' | 'delete' | 'restore', s: Sql, id: unknown, force = false) {
    const v = await validateField(r.fields[r.primaryKey], id, r.primaryKey);
    if (op === 'restore') {
      // Восстановить = увидеть удалённую: право `readDeleted` (where проверит его при
      // includeDeleted) и политика `restore`, а без неё — та же, что у `delete`.
      const predicate = await where(ctx, 'delete', s, undefined, true, { value: rule(r, 'restore', ctx) });
      return `(${predicate}) AND ${col(r, r.softDelete!.field)} IS NOT NULL AND ${col(r, r.primaryKey)} = ${s.param(v)}`;
    }
    const withDeleted = force && !!r.softDelete && grants(r.softDelete.readDeleted, ctx);
    return `(${await where(ctx, op, s, undefined, withDeleted)}) AND ${col(r, r.primaryKey)} = ${s.param(v)}`;
  }
  async function includes(ctx: DataContext, names: readonly string[] | undefined, s: Sql) {
    if (names === undefined) return { joins: '', select: '', keys: [] as string[] };
    if (!Array.isArray(names) || names.length > 8 || new Set(names).size !== names.length)
      fail('validation');
    const joins: string[] = [],
      select: string[] = [],
      keys: string[] = [];
    for (const name of names) {
      if (
        typeof name !== 'string' ||
        !r.relations ||
        !own(r.relations, name) ||
        own(r.fields, name)
      )
        fail('forbidden');
      const rel = r.relations[name],
        target = rel.resource;
      if (
        target.table === r.table ||
        rel.foreignField !== target.primaryKey ||
        !own(r.fields, rel.localField) ||
        !allows(r.fields[rel.localField].read, ctx)
      )
        fail('unsupported');
      const fields = readable(target, ctx),
        alias = ident('_db_include_' + keys.length);
      const policy = await filterSQL(target, ctx, rule(target, 'select', ctx), s, db.limits, true);
      const deleted = target.softDelete
        ? ' AND ' + col(target, target.softDelete.field) + ' IS NULL'
        : '';
      const object =
        'jsonb_build_object(' +
        fields.map((k) => s.param(k) + '::text, ' + expr(target, k)).join(', ') +
        ')';
      joins.push(
        ` LEFT JOIN LATERAL (SELECT ${object} AS payload FROM ${table(target)} WHERE ${col(target, rel.foreignField)} = ${col(r, rel.localField)} AND (${policy})${deleted} LIMIT 1) ${alias} ON TRUE`,
      );
      select.push(`${alias}.payload AS ${ident(name)}`);
      keys.push(name);
    }
    return {
      joins: joins.join(''),
      select: select.length ? ', ' + select.join(', ') : '',
      keys,
    };
  }
  async function read(ctx0: DataContext, input0: ListInput | CursorInput = {}, cursor = false) {
    const ctx = context(ctx0),
      input = listInput(input0),
      s = new Sql();
    const keys = readable(r, ctx, input.fields),
      order = orderBy(r, ctx, input.order);
    const limit = input.limit ?? db.limits.pageSize,
      page = input.page ?? 1;
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > db.limits.maxPageSize ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > db.limits.maxPage ||
      (cursor && own(input, 'page')) ||
      (!cursor && own(input, 'after'))
    )
      fail('validation');
    const policy = rule(r, 'select', ctx);
    let predicate = await where(ctx, 'select', s, input.filter, input.includeDeleted, {
      value: policy,
    });
    const scope = {
      resource: r.key,
      principal: ctx.principal,
      policy,
      fields: keys,
      filter: input.filter ?? true,
      order,
      include: input.include ?? [],
      deleted: input.includeDeleted ?? false,
    };
    if (cursor && !db.cursorCodec) fail('unsupported');
    const after = (input as CursorInput).after;
    // `null` — первая страница: цикл `after = page.nextCursor` проходит типы (DB-3)
    if (cursor && after != null) {
      const values = await db.cursorCodec!.decode(after, scope);
      if (values.length !== order.length) fail('cursor');
      for (let i = 0; i < values.length; i++)
        try {
          await validateField(r.fields[order[i][0]], values[i], order[i][0], false);
        } catch {
          fail('cursor');
        }
      predicate += ' AND ' + keyset(r, order, values, s);
    }
    const inc = await includes(ctx, input.include, s);
    const selected = [...new Set([...keys, ...(cursor ? order.map(([k]) => k) : [])])];
    const statement = withSignal(
      s.statement(
        `SELECT ${projection(r, selected)}${inc.select} FROM ${table(r)}${inc.joins} WHERE ${predicate} ORDER BY ${orderSQL(r, order)} LIMIT ${s.param(limit + (cursor ? 1 : 0))}` +
          (!cursor ? ' OFFSET ' + s.param((page - 1) * limit) : ''),
      ),
      ctx,
    );
    const rows = (await db.query(statement)).rows;
    let nextCursor: string | null = null;
    if (cursor && rows.length > limit) {
      rows.pop();
      nextCursor = await db.cursorCodec!.encode(
        scope,
        order.map(([k]) => rows[rows.length - 1][k]),
      );
    }
    const items = rows.map((row) => output(row, [...keys, ...inc.keys]));
    await r.hooks?.afterRead?.({
      ctx,
      rows: freeze(items.map((x) => ({ ...x }))),
    });
    return { items, nextCursor };
  }
  /**
   * Ключи доступа при записи. Вставка — все ключи обязательны и проходят все; изменение —
   * новое значение ключа проверяется как при вставке (перенести строку туда, куда нельзя
   * писать, нельзя).
   */
  async function writeKeys(dbx: Database, ctx: DataContext, op: 'insert' | 'update', draft: Row) {
    const values = new Map<string, unknown[]>();
    for (const [k] of accessKeys(r as unknown as Resource)) {
      if (op === 'insert' && (!own(draft, k) || draft[k] == null)) fail('forbidden', k);
      if (own(draft, k)) values.set(k, [draft[k]]);
    }
    if (values.size) await checkKeys(dbx, r as unknown as Resource, 'insert', ctx, values);
  }
  async function write(
    dbx: Database,
    ctx: DataContext,
    op: 'insert' | 'update' | 'delete' | 'restore',
    id: unknown,
    input: unknown,
    force = false,
  ): Promise<Out> {
    const keys = readable(r, ctx),
      s = new Sql();
    if (op === 'insert' && !insertAllowed(r, ctx)) fail('forbidden');
    let draft: Row | undefined;
    const filled = new Set<string>();
    if (op === 'insert' || op === 'update') draft = await draftInput(r, ctx, input, op, db.limits.inputKeys, filled);
    let before: Row | undefined;
    if (op !== 'insert' && (r.hooks?.beforeWrite || r.hooks?.afterWrite || r.validateFinal || (op === 'update' && r.checks))) {
      const pre = new Sql(),
        predicate = await idWhere(ctx, op, pre, id, force);
      before = (
        await dbx.query(
          withSignal(
            pre.statement(
              `SELECT ${projection(r, Object.keys(r.fields))} FROM ${table(r)} WHERE ${predicate} FOR UPDATE`,
            ),
            ctx,
          ),
        )
      ).rows[0];
      if (!before) fail('not_found');
    }
    // server-owned: `createValue` и то, что заполнил `fill`, — хук их не меняет
    const protectedValues = draft
      ? Object.fromEntries(
          Object.keys(r.fields)
            .filter((k) => (op === 'insert' && r.fields[k].createValue) || filled.has(k))
            .map((k) => [k, JSON.parse(JSON.stringify(draft![k]))]),
        )
      : {};
    const validatedSnapshot = Object.fromEntries(
      Object.entries(draft ?? {}).map(([k, v]) => [k, JSON.stringify(v)]),
    );
    const event: HookContext = {
      ctx,
      // Для хуков восстановление — изменение строки.
      operation: op === 'restore' ? 'update' : op,
      db: dbx,
      before: before ? freeze({ ...before }) : undefined,
      draft,
    };
    await r.hooks?.beforeWrite?.(event);
    if (draft) {
      await revalidateDraft(
        r,
        ctx,
        draft,
        op as 'insert' | 'update',
        protectedValues,
        validatedSnapshot,
      );
      // правила данных — после полей и хука, в транзакции записи: что они прочли, то и запишется
      if (r.checks) {
        const errors = await runChecks(r, {
          ctx,
          operation: op as 'insert' | 'update',
          db: dbx,
          values: snapshot(draft),
          ...(event.before ? { before: event.before } : {}),
        });
        if (errors.length) failFields(errors);
      }
    }
    if (draft) await writeKeys(dbx, ctx, op as 'insert' | 'update', draft);
    let sql: string;
    if (op === 'insert') {
      const entries = Object.entries(draft!);
      sql = entries.length
        ? `INSERT INTO ${table(r)} (${entries.map(([k]) => ident(r.fields[k].column ?? k)).join(',')}) VALUES (${entries.map(([k, v]) => s.fieldParam(r.fields[k], v)).join(',')})`
        : `INSERT INTO ${table(r)} DEFAULT VALUES`;
    } else {
      const predicate = await idWhere(ctx, op, s, id, force);
      if (op === 'delete' && (!r.softDelete || force)) sql = `DELETE FROM ${table(r)} WHERE ${predicate}`;
      else {
        const sets =
          op === 'delete'
            ? [await softDeleteAssignment(r as unknown as Resource, s, ctx)]
            : op === 'restore'
              ? [`${assignee(r as unknown as Resource, r.softDelete!.field)} = NULL`, ...touchAssignment(r as unknown as Resource)]
              : [
                  ...Object.entries(draft!).map(([k, v]) => assignee(r as unknown as Resource, k) + ' = ' + s.fieldParam(r.fields[k], v)),
                  ...touchAssignment(r as unknown as Resource, draft),
                ];
        sql = `UPDATE ${table(r)} SET ${sets.join(',')} WHERE ${predicate}`;
      }
    }
    let row: Row | undefined;
    try {
      row = (
        await dbx.query(
          withSignal(
            s.statement(
              sql +
                ' RETURNING ' +
                projection(r, r.validateFinal && op !== 'delete' ? Object.keys(r.fields) : keys),
            ),
            ctx,
          ),
        )
      ).rows[0];
    } catch (error) {
      const e = normalizeFailure(error),
        name = e.details.constraint;
      const registered =
        name && r.constraints && own(r.constraints, name) ? r.constraints[name] : undefined;
      if (
        registered &&
        e.details.sqlstate === registered.sqlstate &&
        grants(registered.expose, ctx) &&
        registered.fields.every((k) => own(r.fields, k) && allows(r.fields[k].read, ctx))
      ) {
        e.details.publicFields = Object.freeze([...registered.fields]);
      } else if ((op === 'insert' || op === 'update') && draft) await attachFieldErrors(r, ctx, e, op, draft);
      else if (op === 'delete' && (e.details.sqlstate === '23503' || e.details.sqlstate === '23001'))
        // удаление нарушает только входящие ключи: на строку ссылаются другие записи
        e.details.errors = Object.freeze([fieldError(undefined, undefined, 'referenced', DEFAULT_TEXT.referenced)]);
      throw e;
    }
    if (!row) fail('not_found');
    if (op !== 'delete' && r.validateFinal) {
      const checked = await r.validateFinal['~standard'].validate(row);
      if (checked.issues) fail('validation');
    }
    const result = output(row, keys),
      after: HookContext = {
        ...event,
        draft: undefined,
        row: freeze({ ...result }),
      };
    await r.hooks?.afterWrite?.(after);
    if (r.hooks?.afterCommit) {
      const { db: _db, draft: _draft, ...notice } = after;
      await dbx.afterCommit(() => r.hooks!.afterCommit!(notice));
    }
    return result;
  }
  async function estimate(
    ctx0: DataContext,
    input: { filter?: Filter; includeDeleted?: boolean } = {},
  ) {
    const ctx = context(ctx0);
    // Те же проверки, что у `count`: право читать ресурс и только известные ключи ввода.
    readable(r, ctx);
    listInput(input as ListInput);
    if (Object.keys(input).some((k) => !['filter', 'includeDeleted'].includes(k)))
      fail('validation');
    // Предикат строится ДО выбора метода: так политика, права на поля фильтра и
    // `readDeleted` проверяются всегда, а не только когда фильтр задан (DB-4).
    const policy = rule(r, 'select', ctx);
    const s2 = new Sql();
    const predicate = await where(ctx, 'select', s2, input.filter, input.includeDeleted ?? false, {
      value: policy,
    });
    // Статистика планировщика описывает ВСЮ таблицу. Она годится, только когда
    // пользователю видна вся таблица: нет фильтра, политика без условий, удалённые
    // строки не скрываются. Только для реальных таблиц — у вьюхи reltuples = 0, и это
    // было бы «0 строк» вместо правдоподобной оценки.
    const wholeTable =
      !input.filter && policy === true && (!r.softDelete || input.includeDeleted === true);
    if (wholeTable) {
      const parts = r.table.split('.');
      const name = parts[parts.length - 1]!;
      const schema = parts.length > 1 ? parts[0]! : 'public';
      const s = new Sql();
      const res = await db.query(
        withSignal(
          s.statement(
            `SELECT GREATEST(0, c.reltuples)::bigint AS n FROM pg_catalog.pg_class c
              JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
             WHERE ns.nspname = ${s.param(schema)} AND c.relname = ${s.param(name)}
               AND c.relkind IN ('r', 'p', 'm')`,
          ),
          ctx,
        ),
      );
      const raw = res.rows[0]?.n;
      const n = raw === undefined || raw === null ? -1 : Number(raw);
      if (n >= 0) return { rows: n, exact: false, method: 'reltuples' as const };
    }
    if (wholeTable) {
      // Статистики нет (вьюха, таблица без ANALYZE) — честный count.
      const c = await db.query(
        withSignal(s2.statement(`SELECT count(*)::bigint AS n FROM ${table(r)} WHERE ${predicate}`), ctx),
      );
      return { rows: Number(c.rows[0]!.n), exact: true, method: 'count' as const };
    }
    try {
      const e = await db.query(
        withSignal(
          s2.statement(`EXPLAIN (FORMAT JSON) SELECT 1 FROM ${table(r)} WHERE ${predicate}`),
          ctx,
        ),
      );
      const cell = Object.values(e.rows[0] ?? {})[0];
      const plan = typeof cell === 'string' ? JSON.parse(cell) : cell;
      const first = Array.isArray(plan) ? plan[0] : plan;
      const rows = Number((first as { Plan?: { 'Plan Rows'?: number } })?.Plan?.['Plan Rows']);
      if (Number.isFinite(rows) && rows >= 0)
        return { rows: Math.round(rows), exact: false, method: 'explain' as const };
    } catch {
      // Транспорт без EXPLAIN или старый pg: считаем точно, а не возвращаем мусор.
    }
    const c = await db.query(
      withSignal(s2.statement(`SELECT count(*)::bigint AS n FROM ${table(r)} WHERE ${predicate}`), ctx),
    );
    return { rows: Number(c.rows[0]!.n), exact: true, method: 'count' as const };
  }
  async function insertMany(
    ctx0: DataContext,
    rows: readonly unknown[],
    opts: { onConflictIgnore?: boolean; chunkSize?: number; atomic?: boolean } = {},
  ): Promise<Out[]> {
    const ctx = context(ctx0);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5000)
      fail('validation', undefined, ['insertMany: массив от 1 до 5000 строк']);
    if (r.hooks?.beforeWrite || r.hooks?.afterWrite || r.validateFinal || r.checks)
      fail('unsupported', undefined, [
        'insertMany недоступен с beforeWrite/afterWrite/validateFinal/checks: им нужен построчный контроль в транзакции',
      ]);
    if (!insertAllowed(r, ctx)) fail('forbidden');
    const drafts: Row[] = [];
    for (const row of rows) drafts.push(await draftInput(r, ctx, row, 'insert', db.limits.inputKeys));
    const keys = Object.keys(drafts[0]!);
    if (accessKeys(r as unknown as Resource).length) {
      const values = new Map<string, unknown[]>();
      for (const d of drafts)
        for (const [k] of accessKeys(r as unknown as Resource)) {
          if (!own(d, k) || d[k] == null) fail('forbidden', k);
          values.set(k, [...(values.get(k) ?? []), d[k]]);
        }
      await checkKeys(db, r as unknown as Resource, 'insert', ctx, values);
    }
    for (const d of drafts)
      if (Object.keys(d).length !== keys.length || !keys.every((k) => own(d, k)))
        fail('validation', undefined, [
          'insertMany: у всех строк обязан быть одинаковый набор полей — иначе часть строк получает DEFAULT, и RETURNING вводит в заблуждение',
        ]);
    const cols = Math.max(1, keys.length);
    const chunk = Math.max(1, Math.min(opts.chunkSize ?? 100, 500, Math.floor(30000 / (cols + 1))));
    const out: Out[] = [];
    const run = async (dbx: Database, items: Row[]) => {
      const s = new Sql();
      const valueTuples = items
        .map((d) => '(' + keys.map((k) => s.fieldParam(r.fields[k]!, d[k])).join(',') + ')')
        .join(',');
      const sql =
        `INSERT INTO ${table(r)} (${keys.map((k) => ident(r.fields[k]!.column ?? k)).join(',')}) VALUES ${valueTuples}` +
        (opts.onConflictIgnore ? ' ON CONFLICT DO NOTHING' : '') +
        ' RETURNING ' +
        projection(r, keys);
      let res: Awaited<ReturnType<Database['query']>>;
      try {
        res = await dbx.query(withSignal(s.statement(sql), ctx));
      } catch (error) {
        // у всех строк один набор полей — привязка к полю та же, что у insert;
        // какая именно строка, PostgreSQL сообщает только текстом, его не разбираем
        const e = normalizeFailure(error);
        await attachFieldErrors(r, ctx, e, 'insert', items[0]!);
        throw e;
      }
      // Короткий RETURNING без ON CONFLICT DO NOTHING означает, что часть строк не
      // вошла, а ошибка потерялась (триггер,Rules, strange driver) → кричим, а не
      // возвращаем «успех» с недобором.
      if (!opts.onConflictIgnore && res.rows.length !== items.length)
        fail('database', undefined, [
          `insertMany: вставлено ${res.rows.length} из ${items.length} — RETURNING не совпал, а ON CONFLICT DO NOTHING не запрашивался`,
        ]);
      for (const row of res.rows) out.push(output(row, keys) as Out);
    };
    if (drafts.length <= chunk) await run(db, drafts);
    else if (db.driver.capabilities.transactions)
      // Больше одного round-trip → атомарно либо ничего: без транзакции половина
      // пачки могла бы записаться, и повтор импорта удвоил бы данные.
      await db.transaction(async (tx) => {
        for (let i = 0; i < drafts.length; i += chunk) await run(tx, drafts.slice(i, i + chunk));
      });
    else if (opts.atomic)
      fail('unsupported', undefined, [
        'insertMany({ atomic: true }) требует транзакции: транспорт её не даёт, а часть пачки уже могла бы записаться',
      ]);
    else
      for (let i = 0; i < drafts.length; i += chunk) await run(db, drafts.slice(i, i + chunk));
    return out;
  }
  const mutate = (
    ctx0: DataContext,
    op: 'insert' | 'update' | 'delete' | 'restore',
    id: unknown,
    input: unknown,
    force = false,
  ) =>
    db.guard(async () => {
      const ctx = context(ctx0);
      const needsTransaction = !!(
        r.hooks?.beforeWrite ||
        r.hooks?.afterWrite ||
        r.validateFinal ||
        ((op === 'insert' || op === 'update') && r.checks)
      );
      if (needsTransaction) {
        // На HTTP это отказывает ДО запроса/мутации, а не эмулирует atomic hooks.
        if (!db.driver.capabilities.transactions) throw new DbFailure('unsupported');
        return db.transaction((tx) => write(tx, ctx, op, id, input, force));
      }
      return write(db, ctx, op, id, input, force);
    });
  /**
   * Какие из строк этот ctx может удалить — без удаления: правило `delete`, только живые.
   * `soft` — как модель удаляет по умолчанию.
   */
  async function canDelete(ctx0: DataContext, ids: readonly unknown[]) {
    const ctx = context(ctx0);
    if (!Array.isArray(ids) || !ids.length || ids.length > db.limits.inValues)
      fail('validation', undefined, [`canDelete: от 1 до ${db.limits.inValues} ключей`]);
    const pk = r.fields[r.primaryKey];
    const values = await Promise.all(ids.map((id) => validateField(pk, id, r.primaryKey)));
    const s = new Sql();
    const predicate = await where(ctx, 'delete', s);
    const rows = (
      await db.query(
        withSignal(
          s.statement(
            `SELECT ${projection(r, [r.primaryKey])} FROM ${table(r)} WHERE (${predicate}) AND ${col(r, r.primaryKey)} IN (${values.map((v) => s.fieldParam(pk, v)).join(',')})`,
          ),
          ctx,
        ),
      )
    ).rows;
    const found = new Set(rows.map((x) => JSON.stringify(x[r.primaryKey])));
    return { allowed: values.filter((v, i) => found.has(JSON.stringify(v)) && values.indexOf(v) === i), soft: !!r.softDelete };
  }
  /** Проверка без записи (`validator`): поля из входа + правила данных. */
  async function check(ctx0: DataContext, operation: 'insert' | 'update' | 'check', input: unknown) {
    const ctx = context(ctx0);
    if (operation === 'insert' && !insertAllowed(r, ctx)) fail('forbidden');
    if (!isRecord(input)) return { issues: [{ message: 'Invalid input', code: 'invalid' }] };
    const proof = readProof(input);
    const raw = inputRecord(input, db.limits.inputKeys);
    const values: Row = {};
    const errors: FieldError[] = [];
    for (const k of Object.keys(raw)) {
      // ключ не из ресурса — поле самой формы («запомнить меня»): не наше дело
      if (!own(r.fields, k)) continue;
      const f = r.fields[k];
      if (
        operation !== 'check' &&
        ((systemField(r as unknown as Resource, k, operation) && !unprotected(r as unknown as Resource)) ||
          !allows(operation === 'insert' ? f.create : f.update, ctx))
      )
        fail('forbidden');
      const one = await checkField(f, raw[k], k, true, proof);
      if (one.errors) errors.push(...one.errors);
      else values[k] = one.value;
    }
    if (operation === 'insert')
      for (const [k, f] of Object.entries(r.fields))
        if (f.required && !f.generated && !f.createValue && !f.fill && !own(raw, k))
          errors.push(fieldError(f, k, 'required', DEFAULT_TEXT.required));
    if (!errors.length) errors.push(...(await runChecks(r, { ctx, operation, db, values: snapshot(values) })));
    return errors.length ? { issues: errors.map(toIssue) } : { value: values };
  }
  return {
    validator: (ctx, operation) => {
      if (!['insert', 'update', 'check'].includes(operation))
        fail('validation', undefined, ['validator: операция insert | update | check']);
      return Object.freeze({
        '~standard': Object.freeze({
          version: 1 as const,
          vendor: 'modals-kit/db',
          validate: (input: unknown) => db.guard(() => check(ctx, operation, input)),
        }),
      });
    },
    select: (ctx, input) => db.guard(async () => (await read(ctx, input)).items),
    cursor: (ctx, input) => db.guard(() => read(ctx, input, true)),
    get: (ctx, id, input = {}) =>
      db.guard(async () => {
        const value = id; // Единственная normalizer/schema проверка — в filter compiler.
        // PK должен быть разрешён для eq в descriptor, как и остальные клиентские фильтры.
        const row = (
          await read(ctx, {
            ...input,
            filter: { field: r.primaryKey, op: 'eq', value },
            limit: 1,
          })
        ).items[0];
        if (!row) fail('not_found');
        return row;
      }),
    count: (ctx0, input = {}) =>
      db.guard(async () => {
        const ctx = context(ctx0);
        readable(r, ctx);
        listInput(input);
        if (Object.keys(input).some((k) => !['filter', 'includeDeleted'].includes(k)))
          fail('validation');
        const s = new Sql(),
          predicate = await where(ctx, 'select', s, input.filter, input.includeDeleted);
        const n = Number(
          (
            await db.query(
              withSignal(
                s.statement(`SELECT count(*)::text AS n FROM ${table(r)} WHERE ${predicate}`),
                ctx,
              ),
            )
          ).rows[0].n,
        );
        if (!Number.isSafeInteger(n)) fail('database');
        return n;
      }),
    insert: (ctx, input) => mutate(ctx, 'insert', undefined, input),
    update: (ctx, id, input) => mutate(ctx, 'update', id, input),
    delete: (ctx, id, options) => {
      if (options !== undefined && (!isRecord(options) || Object.keys(options).some((k) => k !== 'force') || (options.force !== undefined && typeof options.force !== 'boolean')))
        return Promise.reject(new DbFailure('validation', { issues: ['delete: опции { force?: boolean }'] }));
      return mutate(ctx, 'delete', id, undefined, options?.force === true);
    },
    canDelete: (ctx, ids) => db.guard(() => canDelete(ctx, ids)),
    chain: (ctx, id) => db.guard(() => chainPlan(db, r as unknown as Resource, context(ctx), id)),
    restore: (ctx, id) => {
      if (!r.softDelete) return Promise.reject(new DbFailure('unsupported'));
      return mutate(ctx, 'restore', id, undefined);
    },
    insertMany: (ctx, rows, opts) => db.guard(() => insertMany(ctx, rows, opts)),
    without: (paths, fn) => db.guard(async () => fn(resourceApi(db, withoutPaths(r as unknown as Resource, paths) as unknown as Resource<F, R>))),
    behavior: () => behavior(r as unknown as Resource),
    raw: (fn) => db.guard(async () => fn(resourceApi(db, rawResource(r as unknown as Resource) as unknown as Resource<F, R>))),
    estimate: (ctx, input) => db.guard(() => estimate(ctx, input ?? {})),
  };
}
